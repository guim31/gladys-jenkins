# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device per followed Jenkins job: status (success, failed, unstable,
  aborted, running, never built), last build passed, building, last build
  number and duration; jobs in folders and multibranch projects included.
- A Jenkins device: build queue, offline agents, failing jobs, running jobs.
- Scene triggers: Jenkins build finished (filter on the job and the result),
  Jenkins job failing or back to green, Jenkins agent offline.
- Scene actions: run a Jenkins job, with optional parameters (off unless
  "Allow scenes to run jobs" is on), and read a Jenkins job.
- The "Jenkins jobs" dashboard widget: every job at a glance, failing first,
  with the queue and the offline agents, and a Refresh button.
- "Test the connection": Jenkins, its version, the jobs followed, failing or
  queued, the offline agents, the listed jobs Jenkins does not know.
- Texts and documentation in English, French, German and Spanish.
