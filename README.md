# Jenkins for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows the jobs of a [Jenkins](https://www.jenkins.io/) server: build
status, failure alerts, offline agents, as devices, scene triggers and a
dashboard widget, and runs a job from a scene when you allow it.

- **One device per followed job**: status (success, failed, unstable, aborted,
  running), last build passed, building, last build number and duration.
- **A Jenkins device**: build queue, offline agents, failing jobs, running jobs.
- **Scene triggers**: build finished (filter on the result), job failing or
  back to green, agent offline.
- **Scene actions**: run a job, with optional parameters (an option, off by
  default); read a job, its state as variables for the next actions.
- **Dashboard widget**: every job at a glance, failing first, with the queue
  and the offline agents.
- Folders and multibranch projects (three levels), user + API token or
  anonymous access, local or remote Jenkins.
- Texts in English, French, German and Spanish.

Tested against a real Jenkins 2.580.1 LTS in Docker (freestyle jobs that pass,
fail, are unstable or take parameters, builds running and queued, an offline
agent, bad tokens, missing permissions, CSRF crumbs). Not tested yet on a real
Gladys instance: feedback welcome on
[the issues](https://github.com/guim31/gladys-jenkins/issues).

## Requirements

- Gladys Assistant **5.1.0** or later.
- A Jenkins reachable from Gladys.
- A Jenkins user and its API token, with `Overall/Read` and `Job/Read`
  (`Job/Build` too to run jobs from scenes).

## Installation

In Gladys: **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-jenkins`. Then open its configuration: the
Jenkins address, the user and its API token, the jobs to follow (empty: all),
and click **Test the connection**. Add the devices from the **Discovery** tab.

The user documentation: [English](docs/en.md), [français](docs/fr.md),
[Deutsch](docs/de.md), [español](docs/es.md).

## How it works

Every minute by default (1 to 15 minutes), the container makes three requests
to the JSON API of Jenkins: the job tree with the ten newest builds of each
job, the queue and the nodes. Finished builds, failures, returns to green and
agents going offline become scene events; what was seen is kept in `/data`, so
a restart neither misses nor repeats an event. Running a job posts to
`/build` or `/buildWithParameters` (with a CSRF crumb if Jenkins asks for one),
only when **Allow scenes to run jobs** is on.

## Limits

- Running a job is the only command, off by default; builds cannot be stopped.
- 50 jobs at most, three folder levels; an event arrives up to one refresh
  interval late; more than ten builds of a job between two readings: the
  oldest are not announced.
- A job is known by its full name: renamed or moved, it is a new device.
- A self-signed certificate is refused: use the `http://` address on the local
  network.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests never touch the network: `test/helpers/fakeJenkins.js` answers like
Jenkins, and `test/fixtures/jenkins` holds real answers recorded on Jenkins
2.580.1 LTS (anonymized).

## Credits

- [Jenkins](https://www.jenkins.io/) (MIT), whose remote access API this
  integration reads. The cover uses the Jenkins logo by Charles Lowell and
  Frontside, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
  ([jenkins.io artwork](https://www.jenkins.io/artwork/)).

This project is not affiliated with the Jenkins project, CloudBees or the
Linux Foundation.

## License

[Apache-2.0](LICENSE)
