# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- The Jenkins user and its API token, typed in the Gladys configuration (a
  secret field): sent only to the Jenkins address of the configuration, in an
  HTTP basic `Authorization` header, never logged. Redirects are not followed,
  so the token never goes to another address. A dedicated user with only
  `Overall/Read` and `Job/Read` (and `Job/Build` if scenes run jobs) limits
  what a leaked token allows.
- Running jobs is off by default; when on, only the followed jobs can be run,
  with the parameters their definition declares.
- `/data/jenkins-state.json`: the build numbers seen per job, whether each job
  was failing, which agents were offline, and the scene events waiting to be
  sent. No secret.
- Network: HTTP(S) requests to the configured Jenkins only.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.
