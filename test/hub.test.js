import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIGGERS, WIDGET_KEY, parseParameters, transportOf } from '../src/hub.js';
import { serverIds } from '../src/devices.js';
import {
  CONFIG,
  TOKEN,
  createClock,
  createDevices,
  createWorld,
  idsOf,
  sampleJenkins,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const state = (world, job, feature) => world.fake.lastState(idsOf(world, job).feature(feature));
const server = (world, feature) => world.fake.lastState(serverIds(world.gladys).feature(feature));

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('the server and one device per job, folders walked, nothing polled, no event at first', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Jenkins', 'backup', 'tests', 'infra/deploy'],
  );
  assert.ok(devices.every((device) => device.should_poll === false));
  assert.equal(devices[3].external_id, idsOf(world, 'infra/deploy').device);
  assert.match(devices[3].external_id, /:job:infra%2Fdeploy$/);
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states of the added devices: status, passing, building, number, duration', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(state(world, 'backup', 'status'), 'Success');
  assert.equal(state(world, 'backup', 'passing'), 1);
  assert.equal(state(world, 'backup', 'building'), 0);
  assert.equal(state(world, 'backup', 'build_number'), 1);
  assert.equal(state(world, 'backup', 'build_duration'), 42);
  assert.equal(server(world, 'queue'), 0);
  assert.equal(server(world, 'offline_agents'), 0);
  assert.equal(server(world, 'failing_jobs'), 0);

  // A build runs: the result of the last finished one stays.
  world.jenkins.start('tests');
  await world.hub.pollNow();
  assert.equal(state(world, 'tests', 'status'), 'Running');
  assert.equal(state(world, 'tests', 'building'), 1);
  assert.equal(state(world, 'tests', 'passing'), 1);
  assert.equal(state(world, 'tests', 'build_number'), 2);
  assert.equal(server(world, 'running_jobs'), 1);

  world.jenkins.finish('tests', 'UNSTABLE', { duration: 125_400 });
  await world.hub.pollNow();
  assert.equal(state(world, 'tests', 'status'), 'Unstable');
  assert.equal(state(world, 'tests', 'passing'), 0);
  assert.equal(state(world, 'tests', 'build_duration'), 125);
  assert.equal(server(world, 'failing_jobs'), 1);

  // Aborted: neither passing nor failing, the last decisive value stays.
  world.jenkins.finish('tests', 'ABORTED');
  await world.hub.pollNow();
  assert.equal(state(world, 'tests', 'status'), 'Aborted');
  assert.equal(state(world, 'tests', 'passing'), 0);
});

test('a job never built says so, and publishes no number', async (t) => {
  const jenkins = sampleJenkins().addJob('new-job');
  const world = await createWorld({ jenkins });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(state(world, 'new-job', 'status'), 'Never built');
  assert.equal(state(world, 'new-job', 'build_number'), undefined);
});

test('every finished build fires "build finished", once, with its result', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.jenkins.finish('backup', 'SUCCESS', { duration: 3_000 });
  world.jenkins.start('tests');
  await world.hub.pollNow();
  let finished = events(world, TRIGGERS.FINISHED);
  assert.equal(finished.length, 1, 'the running build is not finished');
  assert.deepEqual(finished[0].data, {
    job: idsOf(world, 'backup').device,
    job_name: 'backup',
    number: 2,
    result: 'success',
    status: 'Success',
    duration: 3,
    url: 'http://192.0.2.20:8080/job/backup/2/',
    summary: 'backup #2: Success',
  });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FINISHED).length, 1, 'not twice');

  world.jenkins.finish('tests', 'ABORTED');
  await world.hub.pollNow();
  finished = events(world, TRIGGERS.FINISHED);
  assert.equal(finished.at(-1).data.result, 'aborted');
  assert.equal(events(world, TRIGGERS.STATUS).length, 0, 'aborted changes nothing');
});

test('builds that finish out of order, and a burst: three events at most, oldest first', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (let i = 0; i < 5; i += 1) {
    world.jenkins.finish('backup', 'SUCCESS');
  }
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FINISHED).map((event) => event.data.number),
    [4, 5, 6],
  );
  // #7 starts, #8 starts and ends first, then #7 ends.
  const jobs = world.jenkins.jobs.get('backup');
  world.jenkins.start('backup');
  world.jenkins.start('backup');
  Object.assign(jobs.builds[0], { building: false, result: 'SUCCESS', duration: 1000 });
  await world.hub.pollNow();
  Object.assign(jobs.builds[1], { building: false, result: 'FAILURE', duration: 1000 });
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FINISHED).map((event) => event.data.number),
    [4, 5, 6, 8, 7],
  );
});

test('failing, still failing, unstable, back to green: one event per change', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const status = () => events(world, TRIGGERS.STATUS).map((event) => event.data.state);

  world.jenkins.finish('tests', 'FAILURE');
  await world.hub.pollNow();
  assert.deepEqual(status(), ['failure']);
  assert.equal(events(world, TRIGGERS.STATUS)[0].data.summary, 'tests is failing (build #2)');
  assert.equal(events(world, TRIGGERS.STATUS)[0].data.result, 'failure');

  world.jenkins.finish('tests', 'FAILURE');
  await world.hub.pollNow();
  world.jenkins.finish('tests', 'UNSTABLE');
  await world.hub.pollNow();
  assert.deepEqual(status(), ['failure'], 'still broken');

  world.jenkins.finish('tests', 'SUCCESS');
  await world.hub.pollNow();
  assert.deepEqual(status(), ['failure', 'success']);
  assert.equal(events(world, TRIGGERS.STATUS)[1].data.summary, 'tests is back to green (build #5)');
  world.jenkins.finish('tests', 'SUCCESS');
  await world.hub.pollNow();
  assert.deepEqual(status(), ['failure', 'success']);
});

test('an agent going offline fires its trigger once; one offline from the start does not', async (t) => {
  const jenkins = sampleJenkins().addAgent('arm-builder', true);
  const world = await createWorld({ jenkins });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(server(world, 'offline_agents'), 1);
  world.jenkins.setOffline('builder-1', true, 'Disconnected by admin');
  await world.hub.pollNow();
  await world.hub.pollNow();
  const offline = events(world, TRIGGERS.AGENT_OFFLINE);
  assert.equal(offline.length, 1);
  assert.deepEqual(offline[0].data, {
    agent_name: 'builder-1',
    reason: 'Disconnected by admin',
    summary: 'Jenkins agent builder-1 is offline',
  });
  assert.equal(server(world, 'offline_agents'), 2);
  world.jenkins.setOffline('builder-1', false);
  await world.hub.pollNow();
  world.jenkins.setOffline('builder-1', true);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.AGENT_OFFLINE).length, 2, 'again after coming back');
});

test('a restart neither misses an event nor announces one twice', async (t) => {
  const first = await createWorld();
  first.jenkins.finish('backup', 'FAILURE');
  await first.hub.pollNow();
  assert.equal(events(first, TRIGGERS.FINISHED).length, 1);
  await first.app.stop();

  // Meanwhile, while the integration was stopped:
  first.jenkins.finish('backup', 'SUCCESS');
  const second = await createWorld({ jenkins: first.jenkins, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => [event.key, event.data.number]),
    [
      [TRIGGERS.FINISHED, 3],
      [TRIGGERS.STATUS, 3],
    ],
  );
});

test('the list of jobs: names, a folder, links; missing ones reported', async (t) => {
  const world = await createWorld({
    config: { ...CONFIG, jobs: 'backup, infra, http://192.0.2.20:8080/job/gone/' },
  });
  t.after(() => world.app.stop());
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['Jenkins', 'backup', 'infra/deploy'],
  );
  const ack = await world.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /2 jobs followed out of 3/);
  assert.match(ack.data.message.en, /Not found in Jenkins: gone/);
  assert.match(ack.data.message.en, /Running jobs from scenes: off/);
  assert.match(ack.data.message.fr, /Connecté \(192\.0\.2\.20:8080, Jenkins 2\.580\.1\)/);

  // A job removed from the list is forgotten: back in it, it starts silent.
  world.jenkins.finish('tests', 'FAILURE');
  await world.fake.configUpdated({ ...CONFIG, jobs: 'backup' });
  await world.fake.configUpdated({ ...CONFIG, jobs: '' });
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('errors: Jenkins down, token refused, no read permission — one log line each', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.jenkins.down = true;
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.pollNow();
    clock.advance(60_000);
    await world.hub.pollNow();
  });
  assert.equal(lines.length, 1, 'one line for an outage, not one per read');
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.en, 'Jenkins does not answer');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.discoveredDevices.length, 4, 'the list is kept');
  world.jenkins.down = false;
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);
  // 192.0.2.x is a documentation range, not a private one: the cloud badge.
  assert.equal(world.fake.transports.at(-1).transport, 'cloud');

  await world.fake.configUpdated({ ...CONFIG, token: 'wrong' });
  assert.match(world.fake.connectionStatus.message.en, /API token refused/);
  await world.fake.configUpdated({ ...CONFIG, username: '', token: '' });
  assert.match(world.fake.connectionStatus.message.en, /access denied/);
});

test('the configuration is checked before anything is read', async (t) => {
  for (const [config, message] of [
    [{}, /Enter the address of your Jenkins/],
    [{ url: 'ftp://nope' }, /Address not understood/],
  ]) {
    const world = await createWorld({ config: { ...CONFIG, url: '', ...config } });
    t.after(() => world.app.stop());
    assert.equal(world.fake.connectionStatus.connected, false);
    assert.match(world.fake.connectionStatus.message.en, message);
    assert.equal(world.jenkins.requests.length, 0);
  }
});

test('a normal reading cycle writes nothing at the info level, never a token', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const lines = await captureLogs(t, 'info', async () => {
    await world.hub.pollNow();
    world.jenkins.start('backup');
    await world.hub.pollNow();
  });
  assert.deepEqual(lines, []);
  const debug = await captureLogs(t, 'debug', () => world.hub.pollNow());
  assert.equal(debug.join('\n').includes(TOKEN), false);
});

test('the container reads Jenkins by itself, without onPoll', async (t) => {
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.hub.config = { ...world.hub.config, pollIntervalMs: 20 };
  world.hub.schedulePoll();
  world.jenkins.finish('backup', 'FAILURE');
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(state(world, 'backup', 'status'), 'Failed');
});

test('an added device gets its states at once, and the widget a refresh', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const refreshes = world.fake.widgetRefreshes.length;
  const [, backup] = world.fake.discoveredDevices;
  await world.fake.deviceCreated(backup);
  assert.equal(state(world, 'backup', 'status'), 'Success');
  assert.ok(world.fake.widgetRefreshes.length > refreshes);
  assert.equal(world.fake.widgetRefreshes.at(-1), WIDGET_KEY);
});

test('Gladys reconnecting gets every state again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const before = world.fake.states.length;
  await world.hub.resync(world.hub.config);
  assert.ok(world.fake.states.length > before);
});

test('an event Gladys refuses (it restarts) is sent again at the next reading', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  let refuse = true;
  world.gladys.publishSceneEvent = (key, data) =>
    refuse ? Promise.reject(new Error('503')) : publish(key, data);
  world.jenkins.finish('backup', 'FAILURE');
  await world.hub.pollNow();
  assert.equal(world.fake.sceneEvents.length, 0);
  refuse = false;
  await world.hub.pollNow();
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => event.key),
    [TRIGGERS.FINISHED, TRIGGERS.STATUS],
  );
});

test('local or cloud badge', () => {
  assert.equal(transportOf('http://192.168.1.2:8080'), 'local');
  assert.equal(transportOf('http://jenkins:8080'), 'local');
  assert.equal(transportOf('https://ci.home.arpa'), 'local');
  assert.equal(transportOf('https://ci.example.com'), 'cloud');
});

test('scene parameters: NAME=value pairs or a JSON object', () => {
  assert.equal(parseParameters('', 'en'), null);
  assert.deepEqual(parseParameters('TARGET=prod&VERSION=1.2=rc', 'en'), {
    TARGET: 'prod',
    VERSION: '1.2=rc',
  });
  assert.deepEqual(parseParameters('A=1\nB = two words', 'en'), { A: '1', B: 'two words' });
  assert.deepEqual(parseParameters('{"DRY_RUN": true, "N": 3}', 'en'), {
    DRY_RUN: 'true',
    N: '3',
  });
  assert.throws(() => parseParameters('just text', 'en'), /NAME=value/);
  assert.throws(() => parseParameters('{bad', 'fr'), /NOM=valeur/);
  assert.throws(() => parseParameters('[1]', 'en'), /NAME=value/);
});
