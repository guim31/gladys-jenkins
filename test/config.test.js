import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  isFollowed,
  normalizeConfig,
  parseJobs,
  parseServerUrl,
} from '../src/config.js';

test('the Jenkins address: host:port, copied URL, sub-path', () => {
  assert.equal(parseServerUrl('192.168.1.2:8080'), 'http://192.168.1.2:8080');
  assert.equal(parseServerUrl('ci.example.com'), 'https://ci.example.com');
  assert.equal(
    parseServerUrl('http://192.168.1.2:8080/job/backup/lastBuild/'),
    'http://192.168.1.2:8080',
  );
  assert.equal(
    parseServerUrl('https://example.com/jenkins/view/all/'),
    'https://example.com/jenkins',
  );
  assert.equal(parseServerUrl('https://example.com/jenkins/'), 'https://example.com/jenkins');
  assert.equal(parseServerUrl('http://user:secret@192.168.1.2:8080'), null);
  assert.equal(parseServerUrl('ftp://192.168.1.2'), null);
  assert.equal(parseServerUrl('  '), null);
});

test('the jobs: names with spaces, folders, links; duplicates dropped', () => {
  assert.deepEqual(
    parseJobs(
      'backup, My nightly job;infra/deploy\nhttp://ci:8080/job/infra/job/site/job/feature%252Fx/, backup',
    ),
    ['backup', 'My nightly job', 'infra/deploy', 'infra/site/feature%2Fx'],
  );
  assert.deepEqual(parseJobs(''), []);
  assert.ok(isFollowed('infra/deploy', ['infra']));
  assert.ok(isFollowed('anything', []));
  assert.ok(!isFollowed('infrastructure', ['infra']));
});

test('normalized defaults', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config, {
    url: null,
    urlTyped: false,
    username: '',
    token: '',
    jobs: [],
    allowBuild: false,
    pollIntervalMs: 60_000,
    language: 'fr',
  });
  assert.equal(DEFAULT_CONFIG.allow_build, false);
  assert.equal(normalizeConfig({ allow_build: true }).allowBuild, true);
  assert.equal(normalizeConfig({ allow_build: 'true' }).allowBuild, true);
  assert.equal(normalizeConfig({ poll_interval: '5', token: ' abc \n' }).pollIntervalMs, 300_000);
  assert.equal(normalizeConfig({ token: ' abc \n' }).token, 'abc');
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});
