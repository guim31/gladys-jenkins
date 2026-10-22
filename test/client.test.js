// The Jenkins client against the answers recorded on a real Jenkins 2.580.1
// LTS (test/fixtures/jenkins), and against the failures it can meet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ERROR_KINDS,
  JOBS_TREE,
  JenkinsClient,
  flattenJobs,
  jobPath,
} from '../src/jenkins/client.js';
import { BASE, FakeJenkins, TOKEN, USER } from './helpers/fakeJenkins.js';

const fixture = async (name) =>
  readFile(new URL(`./fixtures/jenkins/${name}.json`, import.meta.url), 'utf8');

function recorded(answers) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, ...options });
    const { pathname } = new URL(url);
    const answer = answers[pathname] ?? { status: 404, body: '' };
    return {
      headers: { 'x-jenkins': '2.580.1' },
      ...answer,
      body: answer.fixture ? await fixture(answer.fixture) : answer.body,
    };
  };
  return { calls, request };
}

const client = (request, extra = {}) =>
  new JenkinsClient({ url: BASE, username: USER, token: TOKEN, request, ...extra });

test('jobs, queue and nodes from the recorded answers', async () => {
  const { calls, request } = recorded({
    '/api/json': { status: 200, fixture: 'jobs' },
    '/queue/api/json': { status: 200, fixture: 'queue' },
    '/computer/api/json': { status: 200, fixture: 'computer' },
  });
  const jenkins = client(request);
  const { version, jobs } = await jenkins.jobs();
  assert.equal(version, '2.580.1');
  assert.deepEqual(
    jobs.map((job) => [job.fullName, job.builds[0]?.result]),
    [
      ['backup-ok', 'success'],
      ['deploy', 'success'],
      ['flaky', 'unstable'],
      ['tests-broken', 'failure'],
    ],
  );
  assert.deepEqual(jobs[0].builds[0], {
    number: 2,
    building: false,
    result: 'success',
    timestamp: 1792684849319,
    durationMs: 2027,
    url: 'http://192.0.2.20:8080/job/backup-ok/2/',
  });
  const queue = await jenkins.queue();
  assert.equal(queue.length, 3);
  assert.deepEqual(queue[0], {
    id: 8,
    job: 'deploy',
    stuck: false,
    blocked: false,
    since: 1792684885197,
  });
  const nodes = await jenkins.computers();
  assert.deepEqual(
    nodes.map((node) => [node.name, node.offline]),
    [
      ['Built-In Node', false],
      ['builder-1', true],
    ],
  );
  // Basic authentication, the tree parameter escaped.
  assert.equal(
    calls[0].headers.authorization,
    `Basic ${Buffer.from(`${USER}:${TOKEN}`).toString('base64')}`,
  );
  assert.equal(new URL(calls[0].url).searchParams.get('tree'), JOBS_TREE);
});

test('a running build: no result, no duration', async () => {
  const { request } = recorded({ '/api/json': { status: 200, fixture: 'jobs-running' } });
  const { jobs } = await client(request).jobs();
  const deploy = jobs.find((job) => job.fullName === 'deploy');
  assert.equal(deploy.color, 'blue_anime');
  assert.deepEqual(
    [deploy.builds[0].building, deploy.builds[0].result, deploy.builds[0].durationMs],
    [true, null, null],
  );
});

test('folders, multibranch projects and their branches are walked through', () => {
  const jobs = flattenJobs([
    {
      _class: 'com.cloudbees.hudson.plugins.folder.Folder',
      name: 'infra',
      jobs: [
        {
          _class: 'org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject',
          name: 'site',
          fullName: 'infra/site',
          jobs: [
            {
              _class: 'org.jenkinsci.plugins.workflow.job.WorkflowJob',
              name: 'main',
              fullName: 'infra/site/main',
              color: 'red',
              builds: [{ number: 3, result: 'FAILURE', building: false, duration: 10 }],
            },
          ],
        },
      ],
    },
    { name: 'plain', fullName: 'plain', color: 'disabled', buildable: false, builds: [] },
  ]);
  assert.deepEqual(
    jobs.map((job) => [job.fullName, job.disabled]),
    [
      ['infra/site/main', false],
      ['plain', true],
    ],
  );
  assert.equal(jobPath('infra/site/main'), '/job/infra/job/site/job/main');
  assert.equal(jobPath('my job/feature%2Fx'), '/job/my%20job/job/feature%252Fx');
});

test('every HTTP and network failure has its kind', async () => {
  const cases = [
    [{ status: 401, body: '' }, ERROR_KINDS.AUTH],
    [{ status: 403, body: '' }, ERROR_KINDS.FORBIDDEN],
    [{ status: 302, body: '' }, ERROR_KINDS.REDIRECT],
    [{ status: 404, body: '' }, ERROR_KINDS.NOT_JENKINS],
    [{ status: 500, body: '' }, ERROR_KINDS.HTTP],
    [{ status: 200, body: '<html>a login page</html>' }, ERROR_KINDS.NOT_JENKINS],
    [{ status: 200, body: '{"nope":1}' }, ERROR_KINDS.NOT_JENKINS],
  ];
  for (const [answer, kind] of cases) {
    const jenkins = client(async () => ({ headers: {}, ...answer }));
    await assert.rejects(jenkins.jobs(), (err) => err.kind === kind, `${answer.status}`);
  }
  const failures = [
    [
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
      'unreachable',
    ],
    [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), 'timeout'],
    [Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } }), 'tls'],
  ];
  for (const [error, kind] of failures) {
    const jenkins = client(async () => {
      throw error;
    });
    await assert.rejects(
      jenkins.jobs(),
      (err) => err.kind === kind && !err.message.includes(TOKEN),
    );
  }
});

test('anonymous: no authorization header', async () => {
  const { calls, request } = recorded({ '/api/json': { status: 200, fixture: 'jobs' } });
  await new JenkinsClient({ url: BASE, request }).jobs();
  assert.equal(calls[0].headers.authorization, undefined);
});

test('the recorded job definitions: parameters, buildable', async () => {
  const { request } = recorded({
    '/job/deploy/api/json': { status: 200, fixture: 'job-deploy' },
    '/job/backup-ok/api/json': { status: 200, fixture: 'job-backup' },
  });
  assert.deepEqual(await client(request).jobDefinition('deploy'), {
    buildable: true,
    parameters: ['TARGET'],
  });
  assert.deepEqual(await client(request).jobDefinition('backup-ok'), {
    buildable: true,
    parameters: [],
  });
  await assert.rejects(
    client(request).jobDefinition('gone'),
    (err) => err.kind === ERROR_KINDS.NOT_FOUND,
  );
});

test('build: /build or /buildWithParameters, the queue item, the crumb when asked', async () => {
  const jenkins = new FakeJenkins().addJob('backup').addJob('infra/deploy', {
    parameters: ['TARGET'],
  });
  const api = client(jenkins.request);
  assert.deepEqual(await api.build('backup', null), { queueId: 1 });
  assert.deepEqual(
    await api.build('infra/deploy', { TARGET: 'prod & co' }, { parameterized: true }),
    { queueId: 2 },
  );
  assert.deepEqual(await api.build('infra/deploy', null, { parameterized: true }), {
    queueId: 3,
  });
  const posts = jenkins.requests.filter((r) => r.method === 'POST');
  assert.deepEqual(
    posts.map((r) => new URL(r.url).pathname),
    [
      '/job/backup/build',
      '/job/infra/job/deploy/buildWithParameters',
      '/job/infra/job/deploy/buildWithParameters',
    ],
  );
  assert.deepEqual(jenkins.queue[1].parameters, { TARGET: 'prod & co' });

  jenkins.requireCrumb = true;
  assert.deepEqual(await api.build('backup', null), { queueId: 4 });
  const retried = jenkins.requests.at(-1);
  assert.equal(retried.headers['Jenkins-Crumb'], 'c0ffee');
  assert.equal(retried.headers.cookie, 'JSESSIONID.abc=node01');

  // 303: Jenkins merged the request with an identical one waiting.
  const merged = client(async () => ({ status: 303, body: '', headers: {} }));
  assert.deepEqual(await merged.build('backup', null), { queueId: null });
});
