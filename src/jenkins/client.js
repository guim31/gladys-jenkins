// -----------------------------------------------------------------------------
// Jenkins client: the JSON remote access API, authenticated by a user name and
// an API token (HTTP basic). One reading is three requests:
//
//   GET /api/json?tree=jobs[…builds[…]{0,5}…]   every job, folders included
//                                               (three levels), with its five
//                                               newest builds; the X-Jenkins
//                                               header gives the version
//   GET /queue/api/json?tree=items[…]           the build queue
//   GET /computer/api/json?tree=computer[…]     the nodes, online or not
//
// Running a job (an option of the configuration, off by default):
//
//   GET  /job/<a>/job/<b>/api/json?tree=…       buildable? parameters?
//   POST /job/<a>/job/<b>/build                 201 + Location: queue item
//   POST /job/<a>/job/<b>/buildWithParameters   same, with form parameters
//
// A request authenticated by an API token needs no CSRF crumb (Jenkins 2.96+);
// a 403 on a POST asks for one anyway (an old Jenkins, a proxy), then retries.
// Redirects are not followed: the credentials would go wherever the address
// points (an http:// address redirected to https:// is reported instead).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TIMEOUT: 'timeout', // no answer in time
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // user or API token refused (401)
  FORBIDDEN: 'forbidden', // the user may not read (403): Overall/Read missing
  NOT_JENKINS: 'not_jenkins', // something answers, not the Jenkins API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  NOT_FOUND: 'not_found', // the job does not exist (renamed, deleted)
  HTTP: 'http', // any other HTTP error
});

export class JenkinsError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'JenkinsError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// The job list of a big Jenkins (hundreds of jobs, five builds each) stays
// far below this, and so does the 256 MB of the sandbox.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

async function readCapped(response, max) {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > max) {
    await response.body?.cancel();
    throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
  }
  if (!response.body) {
    return '';
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > max) {
      throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Jenkins
 * (test/helpers/fakeJenkins.js).
 * @returns {Promise<{ status: number, body: string, headers: Record<string, string> }>}
 */
export async function httpRequest(
  url,
  { method = 'GET', headers = {}, body, timeoutMs = 15_000, maxBytes = MAX_BODY_BYTES } = {},
) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const wanted = {};
  for (const name of ['x-jenkins', 'location', 'set-cookie']) {
    const value = response.headers.get(name);
    if (value) {
      wanted[name] = value;
    }
  }
  return {
    status: response.status,
    body: await readCapped(response, maxBytes),
    headers: wanted,
  };
}

// The result of a build, as the integration names it (keys of the scene
// filters: permanent once published).
export const RESULTS = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
  UNSTABLE: 'unstable',
  ABORTED: 'aborted',
  NOT_BUILT: 'not_built',
});

const RESULT_OF = {
  SUCCESS: RESULTS.SUCCESS,
  FAILURE: RESULTS.FAILURE,
  UNSTABLE: RESULTS.UNSTABLE,
  ABORTED: RESULTS.ABORTED,
  NOT_BUILT: RESULTS.NOT_BUILT,
};

/** A build that "breaks" a job: red (failure) or yellow (unstable: tests failed). */
export const isBroken = (result) => result === RESULTS.FAILURE || result === RESULTS.UNSTABLE;

const positive = (value) => (Number.isInteger(value) && value > 0 ? value : null);
const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);
const textOf = (value, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** A build. Null when it has no number. */
export function normalizeBuild(raw) {
  const number = positive(raw?.number);
  if (!number) {
    return null;
  }
  const building = raw.building === true;
  return {
    number,
    building,
    // null while it runs (Jenkins sends null), and for an unknown result.
    result: building ? null : (RESULT_OF[raw.result] ?? null),
    timestamp: positive(raw.timestamp),
    durationMs: building ? null : count(raw.duration),
    url: textOf(raw.url, 500),
  };
}

/** A buildable job (not a folder). Null for anything else. */
export function normalizeJob(raw) {
  const fullName = textOf(raw?.fullName, 500) || textOf(raw?.name, 500);
  // A folder (or a multibranch project, an organization) has `jobs` and no color.
  if (!fullName || typeof raw.color !== 'string') {
    return null;
  }
  const builds = (Array.isArray(raw.builds) ? raw.builds : [])
    .map(normalizeBuild)
    .filter(Boolean)
    .sort((a, b) => b.number - a.number);
  return {
    fullName,
    url: textOf(raw.url, 500),
    color: raw.color,
    disabled: raw.color === 'disabled' || raw.buildable === false,
    builds,
  };
}

/** Every job of the tree, folders walked through, in the order Jenkins lists them. */
export function flattenJobs(list, out = []) {
  for (const raw of Array.isArray(list) ? list : []) {
    const job = normalizeJob(raw);
    if (job) {
      out.push(job);
    }
    if (Array.isArray(raw?.jobs)) {
      flattenJobs(raw.jobs, out);
    }
  }
  return out;
}

export function normalizeQueue(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  return items
    .map((item) => ({
      id: positive(item?.id),
      job: textOf(item?.task?.name),
      stuck: item?.stuck === true,
      blocked: item?.blocked === true,
      since: positive(item?.inQueueSince),
    }))
    .filter((item) => item.id);
}

export function normalizeComputers(raw) {
  const computers = Array.isArray(raw?.computer) ? raw.computer : [];
  return computers
    .map((computer) => ({
      name: textOf(computer?.displayName),
      offline: computer?.offline === true,
      temporarily: computer?.temporarilyOffline === true,
      reason: textOf(computer?.offlineCauseReason, 500),
    }))
    .filter((computer) => computer.name);
}

const BUILD_FIELDS = 'number,result,timestamp,duration,building,url';
const JOB_FIELDS = `name,fullName,url,color,buildable,builds[${BUILD_FIELDS}]{0,5}`;
// Three levels: a folder, a multibranch project in it, its branches.
export const JOBS_TREE = `jobs[${JOB_FIELDS},jobs[${JOB_FIELDS},jobs[${JOB_FIELDS}]]]`;
const QUEUE_TREE = 'items[id,why,stuck,blocked,inQueueSince,task[name]]';
const COMPUTER_TREE = 'computer[displayName,offline,temporarilyOffline,offlineCauseReason]';

/** `folder/job` → `/job/folder/job/job`. */
export const jobPath = (fullName) =>
  fullName
    .split('/')
    .map((part) => `/job/${encodeURIComponent(part)}`)
    .join('');

const parse = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

export class JenkinsClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.username]
   * @param {string} [options.token] API token (or password); anonymous when empty
   * @param {Function} [options.request] test seam (httpRequest)
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, username = '', token = '', request = httpRequest, timeoutMs = 15_000 }) {
    this.url = url;
    this.authorization =
      username && token ? `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}` : null;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async call(path, { method = 'GET', headers = {}, body } = {}) {
    const all = { accept: 'application/json', ...headers };
    if (this.authorization) {
      all.authorization = this.authorization;
    }
    try {
      return await this.request(`${this.url}${path}`, {
        method,
        headers: all,
        body,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new JenkinsError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      if (err.name === 'TimeoutError' || code === 23) {
        throw new JenkinsError(ERROR_KINDS.TIMEOUT, 'No answer in time');
      }
      throw new JenkinsError(ERROR_KINDS.UNREACHABLE, String(code ?? err.name ?? err.message));
    }
  }

  /** Throws the error of a status that is not a success. */
  check(status, { job = false } = {}) {
    if (status === 401) {
      throw new JenkinsError(ERROR_KINDS.AUTH, 'User or API token refused (HTTP 401)', { status });
    }
    if (status === 403) {
      throw new JenkinsError(ERROR_KINDS.FORBIDDEN, 'Permission denied (HTTP 403)', { status });
    }
    if (status >= 300 && status < 400) {
      throw new JenkinsError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw job
        ? new JenkinsError(ERROR_KINDS.NOT_FOUND, 'Job not found (HTTP 404)', { status })
        : new JenkinsError(ERROR_KINDS.NOT_JENKINS, 'No Jenkins API here (HTTP 404)', { status });
    }
    if (status < 200 || status >= 300) {
      throw new JenkinsError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
  }

  async getJson(path, options) {
    const response = await this.call(path);
    this.check(response.status, options);
    const data = parse(response.body);
    if (!data || typeof data !== 'object') {
      throw new JenkinsError(ERROR_KINDS.NOT_JENKINS, 'The answer is not the Jenkins API');
    }
    return { data, headers: response.headers ?? {} };
  }

  /** Every job, with its newest builds, and the version of Jenkins. */
  async jobs() {
    const { data, headers } = await this.getJson(`/api/json?tree=${encodeURIComponent(JOBS_TREE)}`);
    if (!Array.isArray(data.jobs)) {
      throw new JenkinsError(ERROR_KINDS.NOT_JENKINS, 'The answer is not the Jenkins API');
    }
    return { version: textOf(headers['x-jenkins'], 40), jobs: flattenJobs(data.jobs) };
  }

  async queue() {
    const { data } = await this.getJson(`/queue/api/json?tree=${encodeURIComponent(QUEUE_TREE)}`);
    return normalizeQueue(data);
  }

  async computers() {
    const { data } = await this.getJson(
      `/computer/api/json?tree=${encodeURIComponent(COMPUTER_TREE)}`,
    );
    return normalizeComputers(data);
  }

  /** Whether a job can be built, and the names of its parameters. */
  async jobDefinition(fullName) {
    const tree = 'buildable,property[parameterDefinitions[name]]';
    const { data } = await this.getJson(
      `${jobPath(fullName)}/api/json?tree=${encodeURIComponent(tree)}`,
      { job: true },
    );
    const parameters = (Array.isArray(data.property) ? data.property : [])
      .flatMap((property) =>
        Array.isArray(property?.parameterDefinitions) ? property.parameterDefinitions : [],
      )
      .map((definition) => textOf(definition?.name))
      .filter(Boolean);
    return { buildable: data.buildable !== false, parameters };
  }

  /** A CSRF crumb, and the session cookie it is bound to (Jenkins 2.176+). */
  async crumb() {
    const response = await this.call('/crumbIssuer/api/json');
    this.check(response.status);
    const data = parse(response.body);
    if (!data?.crumb || !data?.crumbRequestField) {
      throw new JenkinsError(ERROR_KINDS.FORBIDDEN, 'No CSRF crumb available');
    }
    const headers = { [data.crumbRequestField]: data.crumb };
    const cookie = response.headers?.['set-cookie'];
    if (cookie) {
      headers.cookie = cookie
        .split(/,(?=[^;]+=)/)
        .map((part) => part.split(';')[0].trim())
        .join('; ');
    }
    return headers;
  }

  /**
   * Queue a build. `parameters` (an object) goes to buildWithParameters; a
   * parameterized job without any takes its default values there too.
   * @returns {Promise<{ queueId: number|null }>} null when Jenkins merged the
   *   request with an identical one already waiting
   */
  async build(fullName, parameters, { parameterized = false } = {}) {
    const entries = Object.entries(parameters ?? {});
    const withParameters = parameterized || entries.length > 0;
    const path = `${jobPath(fullName)}/${withParameters ? 'buildWithParameters' : 'build'}`;
    const form = new URLSearchParams(entries.map(([name, value]) => [name, String(value)]));
    const post = (headers = {}) =>
      this.call(path, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: form.toString(),
      });
    let response = await post();
    if (response.status === 403) {
      response = await post(await this.crumb());
    }
    // 303: the same build (same parameters) already waits in the queue.
    if (response.status === 303) {
      return { queueId: null };
    }
    this.check(response.status, { job: true });
    const match = /\/queue\/item\/(\d+)/.exec(response.headers?.location ?? '');
    return { queueId: match ? Number(match[1]) : null };
  }
}
