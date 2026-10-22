import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDGET_KEY } from '../src/hub.js';
import { MAX_ROWS } from '../src/widgets.js';
import { CONFIG, createDevices, createWorld, idsOf, sampleJenkins } from './helpers/world.js';

const BUILD = { ...CONFIG, allow_build: true };

const widget = async (world, settings = {}, language = 'en') => {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

test('the widget: failing first, then running, queue and offline agents, Refresh', async (t) => {
  const jenkins = sampleJenkins().addAgent('arm', true);
  jenkins.finish('tests', 'FAILURE');
  jenkins.start('backup');
  jenkins.queue.push({ id: 7, job: 'deploy' });
  const world = await createWorld({ jenkins });
  t.after(() => world.app.stop());
  const content = await widget(world, {}, 'fr');
  const [note, list, button] = content.components;
  assert.equal(note.text, 'En attente : 1 · Agents hors ligne : 1');
  assert.deepEqual(
    list.items.map((item) => [item.label, item.value, item.icon]),
    [
      ['tests', 'En échec · #2', 'x-circle'],
      ['backup', 'En cours · #2', 'clock'],
      ['infra/deploy', 'Réussie · #1', 'check-circle'],
    ],
  );
  assert.equal(button.action.key, 'refresh');
  assert.equal(content.ttl_seconds, 60, 'a build runs: sooner');

  const ack = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {});
  assert.equal(ack.success, true, ack.error);
});

test('the widget shows the chosen jobs, says why it is empty, and when Jenkins is down', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const chosen = await widget(world, { jobs: [idsOf(world, 'tests').device] });
  assert.deepEqual(
    chosen.components.find((c) => c.type === 'status').items.map((item) => item.label),
    ['tests'],
  );
  world.jenkins.down = true;
  await world.hub.pollNow();
  const down = await widget(world);
  assert.equal(down.components[0].text, 'Jenkins does not answer');

  const empty = await createWorld({ config: { ...CONFIG, jobs: 'nothing-here' } });
  t.after(() => empty.app.stop());
  assert.match((await widget(empty)).components[0].text, /No job in Jenkins/);
});

test('many jobs: the widget keeps ten rows', async (t) => {
  const jenkins = sampleJenkins();
  for (let i = 0; i < 15; i += 1) {
    jenkins.addJob(`job-${String(i).padStart(2, '0')}`);
  }
  const world = await createWorld({ jenkins });
  t.after(() => world.app.stop());
  const list = (await widget(world)).components.find((c) => c.type === 'status');
  assert.equal(list.items.length, MAX_ROWS);
  assert.equal(list.items.at(-1).value, '+9');
});

test('"Read a Jenkins job" gives its state', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.jenkins.finish('tests', 'UNSTABLE', { duration: 61_200 });
  world.jenkins.start('tests');
  // Read again: the last reading is older than 30 seconds.
  world.clock.advance(30_000);
  const ack = await world.fake.sceneAction('get_job', { job: idsOf(world, 'tests').device });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    job_name: 'tests',
    status: 'Running',
    result: 'unstable',
    passing: false,
    building: true,
    build_number: 3,
    duration: 61,
    url: 'http://192.0.2.20:8080/job/tests/3/',
  });
  const unknown = await world.fake.sceneAction('get_job', { job: 'ext:other:job:x' });
  assert.equal(unknown.success, false);
});

test('"Run a Jenkins job": off by default, then with parameters', async (t) => {
  const off = await createWorld();
  t.after(() => off.app.stop());
  const refused = await off.fake.sceneAction('run_job', { job: idsOf(off, 'backup').device });
  assert.equal(refused.success, false);
  assert.match(refused.error, /Running jobs is off/);
  assert.equal(off.jenkins.requests.filter((r) => r.method === 'POST').length, 0);

  const world = await createWorld({ config: BUILD });
  t.after(() => world.app.stop());
  const deploy = idsOf(world, 'infra/deploy').device;
  let ack = await world.fake.sceneAction('run_job', { job: deploy, parameters: 'TARGET=prod' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { job_name: 'infra/deploy', queued: true, queue_id: 1 });
  assert.deepEqual(world.jenkins.queue[0].parameters, { TARGET: 'prod' });
  // Without parameters: the default values of the job.
  ack = await world.fake.sceneAction('run_job', { job: deploy });
  assert.equal(ack.success, true, ack.error);

  ack = await world.fake.sceneAction('run_job', { job: deploy, parameters: 'TARGTE=prod' });
  assert.match(ack.error, /Unknown parameters for this job: TARGTE/);
  ack = await world.fake.sceneAction('run_job', {
    job: idsOf(world, 'backup').device,
    parameters: 'X=1',
  });
  assert.match(ack.error, /Unknown parameters for this job: X/);
  ack = await world.fake.sceneAction('run_job', { job: idsOf(world, 'backup').device });
  assert.equal(ack.success, true, ack.error);

  world.jenkins.jobs.get('tests').disabled = true;
  world.clock.advance(60_000);
  ack = await world.fake.sceneAction('run_job', { job: idsOf(world, 'tests').device });
  assert.match(ack.error, /disabled in Jenkins/);
});

test('"Run a Jenkins job" only runs followed jobs', async (t) => {
  const world = await createWorld({ config: { ...BUILD, jobs: 'backup' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('run_job', { job: idsOf(world, 'tests').device });
  assert.match(ack.error, /not followed/);
  assert.equal(world.jenkins.requests.filter((r) => r.method === 'POST').length, 0);
});
