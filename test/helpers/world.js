// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Jenkins, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs unless asked: the tests read Jenkins with
// `world.hub.pollNow()`. (From guim31/gladys-n8n.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { jobIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { BASE, FakeJenkins, TOKEN, USER, sampleJenkins } from './fakeJenkins.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 20, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const CONFIG = {
  url: BASE,
  username: USER,
  token: TOKEN,
  jobs: '',
  allow_build: false,
  language: 'en',
};

export async function createWorld({
  clock = createClock(),
  jenkins = sampleJenkins(),
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-jenkins-')),
  timings,
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: jenkins.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, jenkins, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a job, by full name. */
export const idsOf = (world, fullName) => jobIds(world.gladys, fullName);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { BASE, FakeJenkins, TOKEN, USER, sampleJenkins };
