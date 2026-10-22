// -----------------------------------------------------------------------------
// The Jenkins hub: the jobs, the queue and the nodes read on a timer of the
// container (three requests, every minute by default), the states published
// when they change, the scene events fired when a build ends, a job breaks or
// gets back to green, or an agent goes offline, and the builds run from
// scenes (an option, off by default).
//
// Gladys never polls these devices (should_poll: false): an event must fire
// for a job added to Gladys or not, and the interval goes beyond the fixed
// list of the core scheduler.
//
// What was seen is kept in /data (src/store.js): the finished builds of each
// job, whether it was broken, which agents were offline, so that a restart
// neither misses an event nor announces it twice. The first reading of a job
// or an agent only sets what is known: no event for the past.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildJobDevice,
  buildServerDevice,
  buildsOf,
  durationSeconds,
  jobIds,
  jobValues,
  parseJobName,
  serverIds,
  serverValues,
  statusOf,
  STATUSES,
} from './devices.js';
import { ERROR_KINDS, JenkinsClient, JenkinsError, RESULTS, isBroken } from './jenkins/client.js';
import { MAX_JOBS, hostOf, isFollowed, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  STATUS_TEXT,
  SUMMARY_TEXT,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'jenkins-hub' });

export const WIDGET_KEY = 'jobs';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  FINISHED: 'build_finished',
  STATUS: 'job_status_changed',
  AGENT_OFFLINE: 'agent_offline',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A command reads Jenkins again when the last read is older.
  freshMs: 30_000,
};

// Events fired at most per job and reading (a burst of builds does not flood
// the scenes), build numbers remembered per job, refused events kept.
const MAX_EVENTS = 3;
const SEEN_BUILDS = 20;
const MAX_PENDING = 20;
const MAX_TRANSPORTS_PER_REQUEST = 100;

/**
 * A Jenkins on the local network (private address, `.local`, a name without
 * a dot) shows the "local" badge, any other the "cloud" one.
 */
export function transportOf(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return DEVICE_TRANSPORTS.CLOUD;
  }
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    const local =
      a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    return local || (a === 169 && b === 254) ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
  }
  if (isIP(host) === 6) {
    return /^(::1$|fc|fd|fe80)/.test(host) ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.CLOUD;
  }
  return !host.includes('.') || /\.(local|lan|home|internal|home\.arpa)$/.test(host)
    ? DEVICE_TRANSPORTS.LOCAL
    : DEVICE_TRANSPORTS.CLOUD;
}

/**
 * The parameters typed in the scene: `NAME=value`, one per line or separated
 * by `&`, or a JSON object. Scene variables are already replaced by Gladys.
 * @returns {Record<string, string>|null} null when empty
 * @throws when not understood
 */
export function parseParameters(raw, language) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }
  const text = raw.trim();
  const bad = () => new Error(pick(ACTION_TEXT.badParameters, language));
  if (text.startsWith('{')) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw bad();
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw bad();
    }
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item),
      ]),
    );
  }
  const parameters = {};
  for (const part of text.split(/[\n&]+/)) {
    if (!part.trim()) {
      continue;
    }
    const at = part.indexOf('=');
    const name = at > 0 ? part.slice(0, at).trim() : '';
    if (!name) {
      throw bad();
    }
    parameters[name] = part.slice(at + 1).trim();
  }
  return parameters;
}

export class JenkinsHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/jenkins/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    this.resetRead();
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = emptySaved();
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle: one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  resetRead() {
    /** @type {Map<string, object>} followed jobs, by full name, in Jenkins order */
    this.jobs = new Map();
    this.totalJobs = 0;
    this.missing = [];
    this.tooMany = false;
    this.queue = null;
    this.computers = null;
    this.version = null;
    this.readAt = 0;
    this.error = null;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) =>
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    this.saved = {
      url: typeof saved.url === 'string' ? saved.url : null,
      jobs: object(saved.jobs),
      agents: object(saved.agents),
      pending: Array.isArray(saved.pending) ? saved.pending : [],
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (previous.language !== config.language) {
      // New names for the Discovery tab, texts in the new language.
      this.discovered = null;
      this.gladys.forgetPublishedStates?.();
    }
    // A read under way was made for the previous configuration.
    await this.polling?.catch(() => {});
    const signature = JSON.stringify([config.url, config.username, config.token]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client = config.url
        ? new JenkinsClient({
            url: config.url,
            username: config.username,
            token: config.token,
            request: this.request,
          })
        : null;
      this.resetRead();
      this.polling = null;
      // Another Jenkins: what was learnt about the previous one is worthless.
      if (config.url && this.saved.url && this.saved.url !== config.url) {
        this.saved = emptySaved();
      }
      if (config.url) {
        this.saved.url = config.url;
      }
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Jenkins works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading Jenkins ---------------------------------------------------------

  /** Read Jenkins now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs`. */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read Jenkins and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    // The queue and the nodes are extras: a user who may read the jobs but
    // not the nodes still gets the jobs.
    const extra = (promise, label) =>
      promise.catch((err) => {
        if (!(err instanceof JenkinsError) || isGlobal(err)) {
          throw err;
        }
        logger.debug(`${label} unreadable: ${err.message}`);
        return null;
      });
    let result;
    try {
      const [jobs, queue, computers] = await Promise.all([
        client.jobs(),
        extra(client.queue(), 'Queue'),
        extra(client.computers(), 'Nodes'),
      ]);
      result = { ...jobs, queue, computers };
    } catch (err) {
      if (!(err instanceof JenkinsError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess(result);
  }

  async applySuccess({ version, jobs, queue, computers }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    const recovering = this.error !== null;
    if (this.error) {
      logger.info('Jenkins answers again');
    }
    if (version !== this.version) {
      logger.info(`Connected to Jenkins ${version || '(version unknown)'}`);
      this.version = version;
    }
    this.error = null;
    this.readAt = this.now();

    const followed = jobs.filter((job) => isFollowed(job.fullName, this.config.jobs));
    this.totalJobs = jobs.length;
    this.tooMany = followed.length > MAX_JOBS;
    const missing = this.config.jobs.filter(
      (name) => !jobs.some((job) => isFollowed(job.fullName, [name])),
    );
    if (missing.length > 0) {
      this.problems.fail('missing', `Jobs not found in Jenkins: ${missing.join(', ')}`);
    } else {
      this.problems.recover('missing', 'Every listed job is found');
    }
    this.missing = missing;

    const next = new Map(followed.slice(0, MAX_JOBS).map((job) => [job.fullName, job]));
    if (
      JSON.stringify(viewOf(this.jobs, this.queue, this.computers)) !==
      JSON.stringify(viewOf(next, queue, computers))
    ) {
      widgetChanged = true;
    }
    this.jobs = next;
    this.queue = queue;
    this.computers = computers;

    let dirty = false;
    const events = [];
    for (const job of next.values()) {
      const { saved, found } = this.compareJob(job);
      events.push(...found);
      if (JSON.stringify(this.saved.jobs[job.fullName]) !== JSON.stringify(saved)) {
        this.saved.jobs[job.fullName] = saved;
        dirty = true;
      }
    }
    // Jobs no longer followed are forgotten.
    for (const name of Object.keys(this.saved.jobs)) {
      if (!next.has(name)) {
        delete this.saved.jobs[name];
        dirty = true;
      }
    }
    if (computers) {
      const { agents, found } = this.compareAgents(computers);
      // Right after Jenkins was unreachable (a restart), its agents are still
      // reconnecting: their states are learnt, without events.
      if (!recovering) {
        events.push(...found);
      }
      if (JSON.stringify(agents) !== JSON.stringify(this.saved.agents)) {
        this.saved.agents = agents;
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    // Saved before the events: a crash in between never announces one twice.
    if (dirty) {
      await this.store.save(this.saved);
    }
    await this.publishStates();
    await this.sendEvents(events);
    return widgetChanged;
  }

  /**
   * What is new in a job since the last reading: the builds that finished,
   * and whether it broke or got back to green.
   */
  compareJob(job) {
    const before = this.saved.jobs[job.fullName];
    const known = Boolean(before) && Array.isArray(before.seen);
    const seen = known ? before.seen : [];
    let broken = known && typeof before.broken === 'boolean' ? before.broken : null;
    // The newest build that decided the status: an older build of a
    // concurrent job ending later does not flip it back.
    let decided = known && Number.isInteger(before.decided) ? before.decided : 0;
    const finished = job.builds
      .filter((build) => !build.building)
      .sort((a, b) => a.number - b.number);
    const fresh = finished.filter((build) => !seen.includes(build.number));
    const current = finished.map((build) => build.number).sort((a, b) => b - a);
    if (current.length > 0 && current[0] < decided) {
      decided = 0; // the numbers restarted: the job was recreated
    }
    const found = [];
    const device = jobIds(this.gladys, job.fullName).device;
    const language = this.config.language;
    const summary = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
    const common = { job: device, job_name: job.fullName };

    for (const build of fresh) {
      const decisive = build.result === RESULTS.SUCCESS || isBroken(build.result);
      if (!known) {
        // First reading: what is known, no event for the past.
        if (decisive) {
          broken = isBroken(build.result);
          decided = build.number;
        }
        continue;
      }
      const result = build.result ?? RESULTS.NOT_BUILT;
      const status = pick(STATUS_TEXT[result], language);
      const announce = fresh.length - fresh.indexOf(build) <= MAX_EVENTS;
      if (announce) {
        found.push({
          key: TRIGGERS.FINISHED,
          data: {
            ...common,
            number: build.number,
            result,
            status,
            duration: durationSeconds(build) ?? 0,
            url: build.url,
            summary: summary.finished(job.fullName, build.number, status),
          },
        });
      }
      if (decisive && build.number > decided) {
        decided = build.number;
        const nowBroken = isBroken(build.result);
        // The first failure of a job counts; a success only after a failure.
        const turned = nowBroken ? broken !== true : broken === true;
        if (turned) {
          const state = nowBroken ? 'failure' : 'success';
          found.push({
            key: TRIGGERS.STATUS,
            data: {
              ...common,
              state,
              result,
              number: build.number,
              url: build.url,
              summary: summary[state](job.fullName, build.number),
            },
          });
        }
        broken = nowBroken;
      }
    }
    // The numbers of the current window are always kept, even lower than the
    // ones remembered (numbers restarting after a job is recreated): a build
    // dropped from the list would be announced again at every reading.
    const numbers = [...current, ...seen.filter((number) => !current.includes(number))].slice(
      0,
      SEEN_BUILDS,
    );
    return { saved: { seen: numbers, broken, decided }, found };
  }

  /** The agents that went offline since the last reading. */
  compareAgents(computers) {
    const agents = {};
    const found = [];
    const summary = SUMMARY_TEXT[this.config.language] ?? SUMMARY_TEXT.en;
    for (const computer of computers) {
      agents[computer.name] = computer.offline;
      if (this.saved.agents[computer.name] === false && computer.offline) {
        found.push({
          key: TRIGGERS.AGENT_OFFLINE,
          data: {
            agent_name: computer.name,
            reason: computer.reason,
            summary: summary.offline(computer.name),
          },
        });
      }
    }
    return { agents, found };
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Jenkins: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  /**
   * Send the events refused before, then the new ones. One refused (Gladys
   * restarting) is kept in /data and sent again at the next reading.
   */
  async sendEvents(events) {
    const queue = [...this.saved.pending, ...events];
    if (queue.length === 0) {
      return;
    }
    const refused = [];
    for (const event of queue) {
      if (refused.length > 0 || !(await this.fire(event.key, event.data))) {
        refused.push(event);
      }
    }
    if (refused.length > 0 || this.saved.pending.length > 0) {
      this.saved.pending = refused.slice(-MAX_PENDING);
      await this.store.save(this.saved);
    }
  }

  async fire(eventKey, data) {
    try {
      await this.gladys.publishSceneEvent(eventKey, data);
      logger.debug(`${data.job_name ?? data.agent_name}: ${eventKey}`);
      this.problems.recover('events', 'Scene events accepted again');
      return true;
    } catch (err) {
      this.problems.fail('events', `Scene event ${eventKey} refused: ${err.message}`);
      return false;
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** The figures of the server device and the widget. */
  summary() {
    const jobs = [...this.jobs.values()];
    return {
      queue: this.queue ? this.queue.length : null,
      offlineAgents: this.computers
        ? this.computers.filter((computer) => computer.offline).length
        : null,
      failingJobs: jobs.filter((job) => isBroken(buildsOf(job).finished?.result)).length,
      runningJobs: jobs.filter((job) => statusOf(job) === STATUSES.RUNNING).length,
    };
  }

  discoveredDevices() {
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    const language = this.config.language;
    return [
      buildServerDevice(this.gladys, { url: this.config.url, version: this.version }, language),
      ...[...this.jobs.values()].map((job) => buildJobDevice(this.gladys, job, language)),
    ];
  }

  /** Publish the Discovery list when it changed (a job added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const signature = JSON.stringify(devices);
    if (!force && signature === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = signature;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Jenkins, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys (the SDK forgets them: they go again).
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.refreshIfStale();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const states = [];
    if (this.isCreated(serverIds(this.gladys).device)) {
      states.push(...serverValues(this.gladys, this.summary()));
    }
    for (const job of this.jobs.values()) {
      if (this.isCreated(jobIds(this.gladys, job.fullName).device)) {
        states.push(...jobValues(this.gladys, job, this.config.language));
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local or cloud, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : transportOf(this.config.url);
    const ids = [
      serverIds(this.gladys).device,
      ...[...this.jobs.keys()].map((name) => jobIds(this.gladys, name).device),
    ];
    const entries = ids
      .filter((id) => this.isCreated(id) && this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const signature = JSON.stringify(status);
    if (signature === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = signature;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands (scene actions, widget, report) --------------------------------

  /** Throws the reason Jenkins cannot answer, if any. */
  assertReadable(language = this.config.language) {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, language));
    }
  }

  /** A followed job, by device external id, read again when the last read is old. */
  async jobOf(externalId, language = this.config.language) {
    const name = parseJobName(this.gladys, externalId);
    if (!name || !isFollowed(name, this.config.jobs)) {
      throw new Error(pick(ACTION_TEXT.notFollowed, language));
    }
    await this.refreshIfStale();
    this.assertReadable(language);
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(pick(ACTION_TEXT.notFollowed, language));
    }
    return job;
  }

  /**
   * Queue a build of a followed job, when the configuration allows it.
   * @returns {Promise<{ queueId: number|null }>}
   */
  async build(job, parameters, language = this.config.language) {
    if (!this.config.allowBuild) {
      throw new Error(pick(ACTION_TEXT.buildDisabled, language));
    }
    const explain = (err) => {
      if (!(err instanceof JenkinsError)) {
        return err;
      }
      const text =
        err.kind === ERROR_KINDS.FORBIDDEN ? ACTION_TEXT.buildForbidden : ERROR_TEXT[err.kind];
      return new Error(`${job.fullName}: ${pick(text, language)}`);
    };
    let definition;
    try {
      definition = await this.client.jobDefinition(job.fullName);
    } catch (err) {
      throw explain(err);
    }
    if (!definition.buildable) {
      throw new Error(pick(ACTION_TEXT.notBuildable, language));
    }
    const unknown = Object.keys(parameters ?? {}).filter(
      (name) => !definition.parameters.includes(name),
    );
    if (unknown.length > 0) {
      throw new Error(pick(ACTION_TEXT.unknownParameters, language)(unknown.join(', ')));
    }
    try {
      const queued = await this.client.build(job.fullName, parameters, {
        parameterized: definition.parameters.length > 0,
      });
      logger.info(`${job.fullName}: build requested`);
      return queued;
    } catch (err) {
      throw explain(err);
    }
  }

  /** "Test the connection": Jenkins, its version, the jobs followed. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const status = this.connectionStatus();
    if (!status.connected) {
      return status.message;
    }
    const summary = this.summary();
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const head = [`${text.ok} (${hostOf(this.config.url)}, Jenkins ${this.version || '?'})`];
      if (!this.config.username || !this.config.token) {
        head.push(text.anonymous);
      }
      const figures = [
        text.jobs(this.jobs.size, this.totalJobs),
        text.failing(summary.failingJobs),
      ];
      if (summary.queue !== null) {
        figures.push(text.queue(summary.queue));
      }
      if (summary.offlineAgents !== null) {
        figures.push(text.offline(summary.offlineAgents));
      }
      const lines = [head.join(' — '), figures.join(' · '), text.build(this.config.allowBuild)];
      if (this.missing.length > 0) {
        lines.push(text.missing(this.missing.join(', ')));
      }
      if (this.tooMany) {
        lines.push(text.tooMany(MAX_JOBS));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }
}

function emptySaved() {
  // jobs: full name → { seen: [finished build numbers], broken: bool|null };
  // agents: name → offline; pending: scene events Gladys refused (it
  // restarts), sent again at the next reading.
  return { url: null, jobs: {}, agents: {}, pending: [] };
}

// The whole Jenkins is concerned, not one part of the reading.
const isGlobal = (err) =>
  [
    ERROR_KINDS.UNREACHABLE,
    ERROR_KINDS.TIMEOUT,
    ERROR_KINDS.TLS,
    ERROR_KINDS.AUTH,
    ERROR_KINDS.REDIRECT,
  ].includes(err.kind);

/** What the widget shows: a change refreshes it. */
function viewOf(jobs, queue, computers) {
  return [
    [...jobs.values()].map((job) => [job.fullName, statusOf(job), job.builds[0]?.number]),
    queue?.length,
    computers?.filter((computer) => computer.offline).length,
  ];
}
