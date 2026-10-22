// -----------------------------------------------------------------------------
// An in-memory Jenkins answering like the real one (Jenkins 2.580 LTS, see
// test/fixtures/jenkins): the job tree with folders, the queue, the nodes, the
// job definitions, builds queued by POST, HTTP basic authentication, an
// optional CSRF crumb. It replaces `httpRequest` (src/jenkins/client.js).
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.20:8080';
export const USER = 'gladys';
export const TOKEN = '11aa22bb33cc44dd55ee66ff77aa88bb99';

const START = Date.UTC(2026, 9, 20, 9, 0, 0);
const COLORS = {
  SUCCESS: 'blue',
  FAILURE: 'red',
  UNSTABLE: 'yellow',
  ABORTED: 'aborted',
  NOT_BUILT: 'notbuilt',
};

const json = (status, data, headers = {}) => ({
  status,
  body: JSON.stringify(data),
  headers: { 'x-jenkins': '2.580.1', ...headers },
});

export class FakeJenkins {
  constructor() {
    /** @type {Map<string, { fullName, builds, parameters, disabled }>} */
    this.jobs = new Map();
    this.queue = [];
    this.computers = [{ displayName: 'Built-In Node', offline: false, offlineCauseReason: '' }];
    this.down = false;
    this.requireCrumb = false;
    this.nextQueueId = 1;
    this.requests = [];
    this.request = this.handle.bind(this);
  }

  addJob(fullName, { parameters = [], disabled = false } = {}) {
    this.jobs.set(fullName, { fullName, builds: [], parameters, disabled });
    return this;
  }

  /** A build that starts now (building). */
  start(fullName) {
    const job = this.jobs.get(fullName);
    const number = (job.builds[0]?.number ?? 0) + 1;
    job.builds.unshift({
      number,
      building: true,
      result: null,
      duration: 0,
      timestamp: START + number * 60_000,
    });
    return number;
  }

  /** The running build ends, or a new one runs and ends. */
  finish(fullName, result, { duration = 42_000 } = {}) {
    const job = this.jobs.get(fullName);
    if (!job.builds[0]?.building) {
      this.start(fullName);
    }
    Object.assign(job.builds[0], { building: false, result, duration });
    return job.builds[0].number;
  }

  addAgent(name, offline = false) {
    this.computers.push({ displayName: name, offline, offlineCauseReason: '' });
    return this;
  }

  setOffline(name, offline, reason = '') {
    const computer = this.computers.find((c) => c.displayName === name);
    computer.offline = offline;
    computer.offlineCauseReason = reason;
  }

  jobJson(job) {
    const last = job.builds[0];
    const finished = job.builds.find((b) => !b.building);
    const color = job.disabled
      ? 'disabled'
      : `${finished ? COLORS[finished.result] : 'notbuilt'}${last?.building ? '_anime' : ''}`;
    const name = job.fullName.split('/').pop();
    return {
      _class: 'hudson.model.FreeStyleProject',
      name,
      fullName: job.fullName,
      url: `${BASE}/${job.fullName
        .split('/')
        .map((part) => `job/${encodeURIComponent(part)}/`)
        .join('')}`,
      buildable: !job.disabled,
      builds: job.builds.slice(0, 5).map((b) => ({
        _class: 'hudson.model.FreeStyleBuild',
        ...b,
        url: `${BASE}/job/${encodeURIComponent(name)}/${b.number}/`,
      })),
      color,
    };
  }

  /** The job tree, folders built from the full names. */
  tree() {
    const root = [];
    const folders = new Map();
    const folderOf = (path) => {
      if (!path) {
        return root;
      }
      if (!folders.has(path)) {
        const folder = {
          _class: 'com.cloudbees.hudson.plugins.folder.Folder',
          name: path.split('/').pop(),
          fullName: path,
          jobs: [],
        };
        folders.set(path, folder);
        folderOf(path.split('/').slice(0, -1).join('/')).push(folder);
      }
      return folders.get(path).jobs;
    };
    for (const job of this.jobs.values()) {
      folderOf(job.fullName.split('/').slice(0, -1).join('/')).push(this.jobJson(job));
    }
    return root;
  }

  jobAt(pathname) {
    const parts = [...pathname.matchAll(/\/job\/([^/]+)/g)].map((m) => decodeURIComponent(m[1]));
    return this.jobs.get(parts.join('/'));
  }

  async handle(url, { method = 'GET', headers = {}, body } = {}) {
    this.requests.push({ method, url, headers, body });
    if (this.down) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    const { pathname, searchParams } = new URL(url);
    const expected = `Basic ${Buffer.from(`${USER}:${TOKEN}`).toString('base64')}`;
    if (!headers.authorization) {
      return { status: 403, body: '<html>Authentication required</html>', headers: {} };
    }
    if (headers.authorization !== expected) {
      return { status: 401, body: '<html>Unauthorized</html>', headers: {} };
    }
    if (method === 'GET' && pathname === '/api/json') {
      return json(200, { _class: 'hudson.model.Hudson', jobs: this.tree() });
    }
    if (method === 'GET' && pathname === '/queue/api/json') {
      return json(200, {
        _class: 'hudson.model.Queue',
        items: this.queue.map((item) => ({
          _class: 'hudson.model.Queue$WaitingItem',
          blocked: false,
          id: item.id,
          inQueueSince: START,
          stuck: false,
          task: { _class: 'hudson.model.FreeStyleProject', name: item.job },
          why: 'Finished waiting',
        })),
      });
    }
    if (method === 'GET' && pathname === '/computer/api/json') {
      return json(200, {
        _class: 'hudson.model.ComputerSet',
        computer: this.computers.map((c) => ({ _class: 'hudson.slaves.SlaveComputer', ...c })),
      });
    }
    if (method === 'GET' && pathname === '/crumbIssuer/api/json') {
      return json(
        200,
        {
          _class: 'hudson.security.csrf.DefaultCrumbIssuer',
          crumb: 'c0ffee',
          crumbRequestField: 'Jenkins-Crumb',
        },
        { 'set-cookie': 'JSESSIONID.abc=node01; Path=/; HttpOnly' },
      );
    }
    const job = this.jobAt(pathname);
    if (!job) {
      return { status: 404, body: '<html>Not Found</html>', headers: {} };
    }
    if (method === 'GET' && pathname.endsWith('/api/json') && searchParams.has('tree')) {
      const property = job.parameters.length
        ? [
            {
              _class: 'hudson.model.ParametersDefinitionProperty',
              parameterDefinitions: job.parameters.map((name) => ({
                _class: 'hudson.model.StringParameterDefinition',
                name,
              })),
            },
          ]
        : [];
      return json(200, {
        _class: 'hudson.model.FreeStyleProject',
        buildable: !job.disabled,
        property,
      });
    }
    if (method === 'POST' && /\/(build|buildWithParameters)$/.test(pathname)) {
      if (this.requireCrumb && headers['Jenkins-Crumb'] !== 'c0ffee') {
        return { status: 403, body: 'No valid crumb was included in the request', headers: {} };
      }
      const withParameters = pathname.endsWith('/buildWithParameters');
      // What Jenkins answers (checked on 2.580.1): 400 for /build on a
      // parameterized job, and for /buildWithParameters on a plain one.
      if (withParameters !== job.parameters.length > 0) {
        return { status: 400, body: '<html>Bad Request</html>', headers: {} };
      }
      const id = this.nextQueueId++;
      this.queue.push({
        id,
        job: job.fullName.split('/').pop(),
        parameters: Object.fromEntries(new URLSearchParams(body ?? '')),
      });
      return { status: 201, body: '', headers: { location: `${BASE}/queue/item/${id}/` } };
    }
    return { status: 404, body: '<html>Not Found</html>', headers: {} };
  }
}

/** The Jenkins of most tests: three jobs, one in a folder, and an agent. */
export function sampleJenkins() {
  const jenkins = new FakeJenkins()
    .addJob('backup')
    .addJob('tests')
    .addJob('infra/deploy', { parameters: ['TARGET'] })
    .addAgent('builder-1');
  jenkins.finish('backup', 'SUCCESS');
  jenkins.finish('tests', 'SUCCESS');
  jenkins.finish('infra/deploy', 'SUCCESS');
  return jenkins;
}
