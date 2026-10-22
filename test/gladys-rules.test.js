// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of Jenkins 2.580.1 LTS (test/fixtures/jenkins: a job that passes, one
// that fails, one unstable, a parameterized one, a build running, an agent
// offline), in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const fixture = (name) =>
  readFile(new URL(`./fixtures/jenkins/${name}.json`, import.meta.url), 'utf8');

/** The recorded answers of Jenkins, by request. */
function recorded(jobs) {
  return async (url) => {
    const { pathname } = new URL(url);
    const name = {
      '/api/json': jobs,
      '/queue/api/json': 'queue',
      '/computer/api/json': 'computer',
    }[pathname];
    if (!name) {
      return { status: 404, body: '', headers: {} };
    }
    return { status: 200, body: await fixture(name), headers: { 'x-jenkins': '2.580.1' } };
  };
}

async function discover(language, jobs) {
  const gladys = createFakeGladys({
    config: { url: 'http://192.0.2.20:8080', username: 'gladys', token: 'x'.repeat(34), language },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-jenkins-rules-'))),
    timers: false,
    request: recorded(jobs),
  });
  await gladys.connect();
  await app.ready;
  // The states, too: added devices, every value checked by the fake Gladys.
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await app.stop();
  return gladys.fake;
}

const scenarios = [
  { label: 'builds finished, English names', language: 'en', jobs: 'jobs' },
  { label: 'a build running, French names', language: 'fr', jobs: 'jobs-running' },
  { label: 'builds finished, German names', language: 'de', jobs: 'jobs' },
  { label: 'a build running, Spanish names', language: 'es', jobs: 'jobs-running' },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const fake = await discover(scenario.language, scenario.jobs);
    const devices = fake.discoveredDevices;
    assert.equal(devices.length, 5, 'the server and the four jobs of the fixture');
    assert.ok(fake.states.length >= 20, 'states accepted by the fake Gladys');
    assert.ok(
      fake.states.every((state) => state.text === undefined || state.text.length > 0),
      'no empty text',
    );
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
