// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab.
//
// One per followed job, identified by its full name (`folder/job`): Jenkins
// gives a job no other stable id, so a renamed job is a new device.
//
//   status          text/text               "Success", "Failed", "Unstable",
//                                           "Aborted", "Running", "Never built"
//   passing         input/binary            1 when the last finished build
//                                           succeeded, 0 when it failed or is
//                                           unstable; unchanged otherwise
//   building        input/binary            1 while a build runs
//   build_number    counter-sensor/integer  number of the last build
//   build_duration  duration/integer (s)    duration of the last finished build
//
// One for the server:
//
//   queue           counter-sensor/integer  builds waiting in the queue
//   offline_agents  counter-sensor/integer  nodes offline
//   failing_jobs    counter-sensor/integer  followed jobs failed or unstable
//   running_jobs    counter-sensor/integer  followed jobs building
//
// Read-only: running a job is a scene action. Published with should_poll:
// false, the integration reads Jenkins on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { RESULTS, isBroken } from './jenkins/client.js';
import { STATUS_TEXT, pick } from './texts.js';

export const JOB_TYPE = 'job';
export const SERVER_TYPE = 'server';
// One Jenkins per integration: the server device keeps its id when the
// address changes (a new IP, HTTPS added).
export const SERVER_ID = 'jenkins';

// Suffixes of the feature external ids: permanent once published.
export const JOB_FEATURES = Object.freeze({
  STATUS: 'status',
  PASSING: 'passing',
  BUILDING: 'building',
  BUILD_NUMBER: 'build_number',
  BUILD_DURATION: 'build_duration',
});

export const SERVER_FEATURES = Object.freeze({
  QUEUE: 'queue',
  OFFLINE_AGENTS: 'offline_agents',
  FAILING_JOBS: 'failing_jobs',
  RUNNING_JOBS: 'running_jobs',
});

// Statuses of a job (src/texts.js gives their words).
export const STATUSES = Object.freeze({
  ...RESULTS,
  RUNNING: 'running',
  NEVER: 'never',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [JOB_FEATURES.STATUS]: 'Status',
    [JOB_FEATURES.PASSING]: 'Last build passed',
    [JOB_FEATURES.BUILDING]: 'Building',
    [JOB_FEATURES.BUILD_NUMBER]: 'Last build number',
    [JOB_FEATURES.BUILD_DURATION]: 'Last build duration',
    [SERVER_FEATURES.QUEUE]: 'Build queue',
    [SERVER_FEATURES.OFFLINE_AGENTS]: 'Offline agents',
    [SERVER_FEATURES.FAILING_JOBS]: 'Failing jobs',
    [SERVER_FEATURES.RUNNING_JOBS]: 'Running jobs',
  },
  fr: {
    [JOB_FEATURES.STATUS]: 'État',
    [JOB_FEATURES.PASSING]: 'Dernière exécution réussie',
    [JOB_FEATURES.BUILDING]: 'En cours',
    [JOB_FEATURES.BUILD_NUMBER]: 'Numéro de la dernière exécution',
    [JOB_FEATURES.BUILD_DURATION]: 'Durée de la dernière exécution',
    [SERVER_FEATURES.QUEUE]: "File d'attente",
    [SERVER_FEATURES.OFFLINE_AGENTS]: 'Agents hors ligne',
    [SERVER_FEATURES.FAILING_JOBS]: 'Tâches en échec',
    [SERVER_FEATURES.RUNNING_JOBS]: 'Tâches en cours',
  },
  de: {
    [JOB_FEATURES.STATUS]: 'Status',
    [JOB_FEATURES.PASSING]: 'Letzter Build erfolgreich',
    [JOB_FEATURES.BUILDING]: 'Läuft',
    [JOB_FEATURES.BUILD_NUMBER]: 'Nummer des letzten Builds',
    [JOB_FEATURES.BUILD_DURATION]: 'Dauer des letzten Builds',
    [SERVER_FEATURES.QUEUE]: 'Build-Warteschlange',
    [SERVER_FEATURES.OFFLINE_AGENTS]: 'Agenten offline',
    [SERVER_FEATURES.FAILING_JOBS]: 'Fehlgeschlagene Jobs',
    [SERVER_FEATURES.RUNNING_JOBS]: 'Laufende Jobs',
  },
  es: {
    [JOB_FEATURES.STATUS]: 'Estado',
    [JOB_FEATURES.PASSING]: 'Última ejecución correcta',
    [JOB_FEATURES.BUILDING]: 'En curso',
    [JOB_FEATURES.BUILD_NUMBER]: 'Número de la última ejecución',
    [JOB_FEATURES.BUILD_DURATION]: 'Duración de la última ejecución',
    [SERVER_FEATURES.QUEUE]: 'Cola de ejecución',
    [SERVER_FEATURES.OFFLINE_AGENTS]: 'Agentes desconectados',
    [SERVER_FEATURES.FAILING_JOBS]: 'Tareas fallidas',
    [SERVER_FEATURES.RUNNING_JOBS]: 'Tareas en curso',
  },
};

export const MODEL = 'Jenkins';
// Display bounds (the core never applies them on write).
export const MAX_COUNT = 1_000_000;
export const MAX_DURATION_S = 7 * 24 * 3600;

// The job name, encoded: a job name may hold spaces, and `:` separates the
// parts of an external id.
export const jobIds = (gladys, fullName) =>
  gladys.externalIds(JOB_TYPE, encodeURIComponent(fullName));
export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);

/** The job full name of a device external id, null when it is not one of ours. */
export function parseJobName(gladys, externalId) {
  const prefix = jobIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  try {
    const name = decodeURIComponent(externalId.slice(prefix.length));
    return name || null;
  } catch {
    return null;
  }
}

/** The last build, running or not, and the last finished one. */
export function buildsOf(job) {
  const last = job.builds[0] ?? null;
  const finished = job.builds.find((build) => !build.building) ?? null;
  return { last, finished };
}

/** What a job is now: running, else the result of its last finished build. */
export function statusOf(job) {
  const { last, finished } = buildsOf(job);
  if (last?.building) {
    return STATUSES.RUNNING;
  }
  if (!finished) {
    return STATUSES.NEVER;
  }
  return finished.result ?? STATUSES.NOT_BUILT;
}

export const durationSeconds = (build) =>
  build?.durationMs == null ? null : Math.round(build.durationMs / 1000);

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const counter = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max: MAX_COUNT },
  );

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

/**
 * The discovery payload of a job.
 * @param {object} job normalized (src/jenkins/client.js)
 */
export function buildJobDevice(gladys, job, language = 'en') {
  const ids = jobIds(gladys, job.fullName);
  const names = NAMES[language] ?? NAMES.en;
  const feature = (key) => ids.feature(key);
  const params = [{ name: 'JOB', value: job.fullName }];
  if (job.url) {
    params.push({ name: 'URL', value: job.url });
  }
  return {
    name: job.fullName,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features: [
      sensor(
        names[JOB_FEATURES.STATUS],
        feature(JOB_FEATURES.STATUS),
        DEVICE_FEATURE_CATEGORIES.TEXT,
        DEVICE_FEATURE_TYPES.TEXT.TEXT,
        { keep_history: false, min: 0, max: 0 },
      ),
      binary(names[JOB_FEATURES.PASSING], feature(JOB_FEATURES.PASSING)),
      binary(names[JOB_FEATURES.BUILDING], feature(JOB_FEATURES.BUILDING)),
      counter(names[JOB_FEATURES.BUILD_NUMBER], feature(JOB_FEATURES.BUILD_NUMBER)),
      sensor(
        names[JOB_FEATURES.BUILD_DURATION],
        feature(JOB_FEATURES.BUILD_DURATION),
        DEVICE_FEATURE_CATEGORIES.DURATION,
        DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        { keep_history: true, min: 0, max: MAX_DURATION_S, unit: DEVICE_FEATURE_UNITS.SECONDS },
      ),
    ],
  };
}

/** The discovery payload of the server. */
export function buildServerDevice(gladys, { url, version }, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  const params = [{ name: 'URL', value: url }];
  if (version) {
    params.push({ name: 'VERSION', value: version });
  }
  return {
    name: 'Jenkins',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features: Object.values(SERVER_FEATURES).map((key) => counter(names[key], ids.feature(key))),
  };
}

/** The values of the features of a job: `{ device_feature_external_id, state|text }`. */
export function jobValues(gladys, job, language) {
  const ids = jobIds(gladys, job.fullName);
  const { last, finished } = buildsOf(job);
  const values = [
    { key: JOB_FEATURES.STATUS, text: pick(STATUS_TEXT[statusOf(job)], language) },
    { key: JOB_FEATURES.BUILDING, state: last?.building ? 1 : 0 },
  ];
  if (finished && (finished.result === RESULTS.SUCCESS || isBroken(finished.result))) {
    values.push({ key: JOB_FEATURES.PASSING, state: finished.result === RESULTS.SUCCESS ? 1 : 0 });
  }
  if (last) {
    values.push({ key: JOB_FEATURES.BUILD_NUMBER, state: Math.min(last.number, MAX_COUNT) });
  }
  const duration = durationSeconds(finished);
  if (duration !== null) {
    values.push({ key: JOB_FEATURES.BUILD_DURATION, state: Math.min(duration, MAX_DURATION_S) });
  }
  return values.map(({ key, ...value }) => ({
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

/** The values of the server features. */
export function serverValues(gladys, summary) {
  const ids = serverIds(gladys);
  const cap = (value) => Math.min(value, MAX_COUNT);
  return [
    [SERVER_FEATURES.QUEUE, summary.queue],
    [SERVER_FEATURES.OFFLINE_AGENTS, summary.offlineAgents],
    [SERVER_FEATURES.FAILING_JOBS, summary.failingJobs],
    [SERVER_FEATURES.RUNNING_JOBS, summary.runningJobs],
  ]
    .filter(([, value]) => Number.isInteger(value))
    .map(([key, value]) => ({ device_feature_external_id: ids.feature(key), state: cap(value) }));
}
