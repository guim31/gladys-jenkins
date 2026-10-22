// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Run a Jenkins job": queues a build of a followed job, with optional
// parameters. Off unless "Allow scenes to run jobs" is on in the
// configuration. The build goes on in Jenkins: the "Build finished" trigger
// reports its end.
//
// "Read a Jenkins job": the state of a followed job as outputs, for the next
// actions of the scene (a message, a condition). Read again when the last
// reading is older than 30 seconds.
// -----------------------------------------------------------------------------

import { buildsOf, durationSeconds, statusOf } from './devices.js';
import { parseParameters } from './hub.js';
import { RESULTS } from './jenkins/client.js';
import { STATUS_TEXT, pick } from './texts.js';

export const SCENE_ACTIONS = {
  async run_job(hub, { fields = {} }) {
    const language = hub.config.language;
    // Checked first: no request to Jenkins when running is off.
    if (!hub.config.allowBuild) {
      return hub.build(null, null, language);
    }
    const parameters = parseParameters(fields.parameters, language);
    const job = await hub.jobOf(fields.job, language);
    const { queueId } = await hub.build(job, parameters, language);
    return {
      job_name: job.fullName,
      queued: queueId !== null,
      queue_id: queueId ?? 0,
    };
  },

  async get_job(hub, { fields = {} }) {
    const language = hub.config.language;
    const job = await hub.jobOf(fields.job, language);
    const { last, finished } = buildsOf(job);
    return {
      job_name: job.fullName,
      status: pick(STATUS_TEXT[statusOf(job)], language),
      result: finished?.result ?? '',
      passing: finished?.result === RESULTS.SUCCESS,
      building: last?.building === true,
      build_number: last?.number ?? 0,
      duration: durationSeconds(finished) ?? 0,
      url: last?.url || job.url,
    };
  },
};
