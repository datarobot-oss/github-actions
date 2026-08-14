# Changelog

What changed in each release, so a consumer pinned to a tag can tell whether a bump is safe.

This project is in beta (`0.0.x`) and does not yet follow semantic versioning: every release is a
patch bump, and workflow inputs, secrets, and label names may change between releases. Pin to a tag.

The format is deliberately plain: one flat list of bullets per release, no Added / Changed / Fixed
subsections. Every pull request adds a bullet under "Unreleased" saying what changed and why a
consumer would care, and those bullets get a version heading when the release is cut.

Entries below 0.0.19 were backfilled from the
[GitHub releases](https://github.com/datarobot-oss/github-actions/releases) and are summarized rather
than exhaustive.

## Unreleased

## 0.0.19 - 2026-08-14

- Every action reference is pinned to a full commit SHA with the version in a trailing comment, and
  the actionlint container is pinned by digest in both CI and `Taskfile.yml`. Previously
  `korthout/backport-action@v3` and `softprops/action-gh-release@v2` sat on mutable third-party tags
  while holding write tokens, and the release action runs unattended on every push to `main`. Pins
  resolve to the same versions those tags pointed at, so behaviour is unchanged.
- The backport workflow now refuses pull requests whose head branch lives in a fork
  (`head.repo.full_name == github.repository`), and its `prepare` job declares
  `permissions: contents: read` instead of inheriting the caller's default token.
  `pull_request_target` grants write access and secrets, and the previous justification for it
  assumed an internal repo. Both the reusable wrapper and `examples/workflow-backport.yaml` carry the
  guard and the reasoning, so the warning now travels with every copy.
- `notify-slack` passes `header_icon` through the step environment instead of interpolating it into
  the shell, and `ensure-labels` does the same for `delete_confusable`. Both were the last remaining
  cases of a caller-supplied value reaching a script body directly.
- `.github/CODEOWNERS` now names `@datarobot-oss/buzok`. The previous entries pointed at teams in
  other orgs, which GitHub resolves to nothing, so code-owner review was enforcing no owner.
- Rewrote `README.md` for external consumers: quick start with a copy-pasteable command, a table of
  the four example workflows with their triggers and secrets, and a secrets reference. Contributor
  instructions moved to their own section. Documented SHA-pinning for consumers who want an immutable
  reference, since a git tag is movable.
- Added this `CHANGELOG.md`, plus a `Changelog updated` CI check
  (`.github/workflows/changelog.yaml`) that requires every pull request to update it. Bot pull
  requests and pull requests labelled `skip-changelog` are exempt.
- Added `.github/dependabot.yml` covering `github-actions` and `npm`. The `github-actions` ecosystem
  is the one that matters here: every action is now SHA-pinned, so without Dependabot a pinned SHA
  would never be bumped for a security fix.
- Added a `Secret scan` CI job running gitleaks on every pull request, as a second line behind
  GitHub's native secret scanning and push protection.
- Added `.pre-commit-config.yaml` with gitleaks and `detect-private-key`, mirroring the CI job so a
  local pass and a CI pass mean the same thing.
- Added `task` targets for the hooks: `task setup` (fresh clone: dependencies plus hooks),
  `task hooks` (install the git hooks), and `task precommit` (run every hook against the whole tree).
  pre-commit is a Python tool and this repo is otherwise Node-only, so it runs through `uvx` when it
  is not already on your PATH rather than becoming a project dependency.
- Added `task secret-scan`, running the same digest-pinned gitleaks container as CI. `task ci` now
  covers lint, tests, and the secret scan, so it still mirrors what CI runs.
- Added `.github/workflows/trivy-scan.yaml` for dependency CVEs and workflow misconfiguration, on
  relevant pull requests and weekly.
- Examples now pin `@0.0.18` instead of `@0.0.16`.
- Filled in the Apache 2.0 copyright placeholder in `LICENSE`.
- Fixed documentation links that broke when `TESTING.md` and `BACKPORT.md` moved into `docs/`. The
  link posted into consumers' backport pull requests is now an absolute URL, since a relative path
  cannot resolve in another repository.
- Added the missing trailing newline in `.github/PULL_REQUEST_TEMPLATE.md` (caught by the new hooks).

## 0.0.18 - 2026-07-06

- Fixed label colors to match DataRobot standards.
  ([#19](https://github.com/datarobot-oss/github-actions/pull/19))

## 0.0.17 - 2026-07-06

- `ensure-labels` no longer fails when an existing label differs only by case.
  ([#18](https://github.com/datarobot-oss/github-actions/pull/18))

## 0.0.16 - 2026-07-01

- Narrowed workflow permissions to the minimum each job needs.
  ([#17](https://github.com/datarobot-oss/github-actions/pull/17))

## 0.0.15 - 2026-07-01

- Reworked `ensure-labels` and unified label naming across the workflows.
  ([#16](https://github.com/datarobot-oss/github-actions/pull/16))

## 0.0.14 - 2026-07-01

- Consolidated the workflows, added the manual backport path, and fixed the examples.
  ([#15](https://github.com/datarobot-oss/github-actions/pull/15))

## 0.0.13 - 2026-07-01

- Fixed broken label definitions. ([#14](https://github.com/datarobot-oss/github-actions/pull/14))

## 0.0.12 - 2026-06-30

- Bug fixes in the backport workflows.
  ([#13](https://github.com/datarobot-oss/github-actions/pull/13))

## 0.0.11 - 2026-06-30

- Added the backport workflows, plus documentation of the labels they require.
  ([#11](https://github.com/datarobot-oss/github-actions/pull/11))

## 0.0.10 - 2026-06-30

- Added the self-test harness that lints every workflow and unit-tests the bash and `github-script`
  bodies embedded in them, so changes are validated on the pull request before a release tag is cut.
  ([#12](https://github.com/datarobot-oss/github-actions/pull/12))

## 0.0.9 - 2026-06-04

- Slack notifications now carry more useful information.
  ([#10](https://github.com/datarobot-oss/github-actions/pull/10))

## 0.0.8 - 2026-05-28

- Fixed `HAS_APPROVAL` not always being set correctly during Slack scans.
  ([#9](https://github.com/datarobot-oss/github-actions/pull/9))

## 0.0.7 - 2026-05-28

- Hardened `add-jira-link` against injection via pull-request-controlled input.
  ([#8](https://github.com/datarobot-oss/github-actions/pull/8))

## 0.0.6 - 2026-05-28

- Hardened the workflows against shell injection through pull-request-controlled inputs, and declared
  least-privilege `permissions:` on the reusable workflows and examples.
  ([#7](https://github.com/datarobot-oss/github-actions/pull/7))

  **Releases `0.0.1` through `0.0.5` are affected and should not be used.** In those versions a
  crafted pull request title could break out of a shell assignment in `mark-pr-to-review` and
  `add-jira-link`, reaching secrets in the job environment. Upgrade to `0.0.6` or later.

## 0.0.5 - 2026-04-01

- `add-jira-link` handles multiple Jira ticket IDs in a pull request title.
  ([#5](https://github.com/datarobot-oss/github-actions/pull/5))

## 0.0.4 - 2026-02-13

- Added the example workflows under `examples/`.
  ([#4](https://github.com/datarobot-oss/github-actions/pull/4))

## 0.0.3 - 2026-02-13

- Renamed the workflows. ([#3](https://github.com/datarobot-oss/github-actions/pull/3))

## 0.0.2 - 2026-02-13

- Added the release workflows, and renamed the initial workflows.
  ([#2](https://github.com/datarobot-oss/github-actions/pull/2))

## 0.0.1 - 2026-02-13

- Initial set of reusable GitHub Actions workflows.
  ([#1](https://github.com/datarobot-oss/github-actions/pull/1))
