// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Jenkins: its address, a user and its API token, the jobs to follow
// (empty: every job), and the option that lets scenes run a job.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in minutes.
export const POLL_INTERVALS = ['1', '2', '5', '10', '15'];

// Jobs followed, at most: as many devices in the Discovery tab.
export const MAX_JOBS = 50;

export const DEFAULT_CONFIG = {
  url: '',
  username: '',
  token: '',
  jobs: '',
  allow_build: false,
  poll_interval: '1',
  language: 'fr',
};

// Pages of the web interface: a URL copied from the browser may point at one.
const INTERFACE_PATH = /\/(job|view|api|manage|computer|queue|login|me|user)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: `host:port` (HTTP), a
 * host alone (HTTPS), or a URL copied from the browser. A sub-path (the
 * `--prefix` of Jenkins, a reverse proxy) is kept.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `${/^[^/]+:\d+/.test(text) ? 'http' : 'https'}://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * The jobs typed by the user: full names (`folder/job` inside a folder) or
 * job URLs copied from the browser, separated by commas, semicolons or new
 * lines (a job name may hold spaces). A folder name follows every job in it.
 * @returns {string[]}
 */
export function parseJobs(raw) {
  const names = [];
  const text = typeof raw === 'string' ? raw : '';
  for (const part of text.split(/[,;\n]+/)) {
    let name = part.trim();
    if (/^https?:\/\//i.test(name)) {
      try {
        // …/job/folder/job/name/ → folder/name
        const segments = new URL(name).pathname.split('/').filter(Boolean);
        const parts = [];
        for (let i = 0; i < segments.length - 1; i += 1) {
          if (segments[i] === 'job') {
            parts.push(decodeURIComponent(segments[i + 1]));
            i += 1;
          }
        }
        name = parts.join('/');
      } catch {
        name = '';
      }
    }
    name = name.replace(/^\/+|\/+$/g, '');
    if (name && !names.includes(name)) {
      names.push(name.slice(0, 500));
    }
  }
  return names;
}

/** Whether a job is followed: listed, or in a listed folder; every job when the list is empty. */
export function isFollowed(fullName, followed) {
  return (
    followed.length === 0 ||
    followed.some((name) => fullName === name || fullName.startsWith(`${name}/`))
  );
}

const truthy = (value) => value === true || value === 'true' || value === 1 || value === '1';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  const typed = text('url');
  return {
    // null: nothing typed, or not understood (see hub.connectionStatus).
    url: typed ? parseServerUrl(typed) : null,
    urlTyped: Boolean(typed),
    username: text('username'),
    // A pasted token often carries a trailing space or new line.
    token: text('token'),
    jobs: parseJobs(source.jobs),
    allowBuild: truthy(source.allow_build),
    pollIntervalMs: Number(pollInterval) * 60_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
