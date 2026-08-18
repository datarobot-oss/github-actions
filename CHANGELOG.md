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

## 0.0.23 - 2026-08-18
- `create-release-on-merge.yaml` takes an optional `version` input. Left unset it behaves exactly as
  before: take the highest existing semver tag and bump its patch. Pass one and that exact string is
  tagged instead. This is for a repo where the version already lives in the tree, which is most Python
  packages: `pyproject.toml` is what goes into the wheel, so it is what the installed tool reports for
  `--version`, and a tag computed independently of it can silently disagree with the artifact it names.
  Passing the version means the tag, the wheel, and `--version` stay identical by construction.
- The same workflow now has `version` and `released` outputs. In the new mode a merge no longer always
  cuts a release: a pull request that did not bump the version leaves the tag already present, so the
  job exits with a notice rather than a red X on the default branch. Gate any follow-on publish job on
  `released == 'true'` rather than on the release job succeeding, or it will run on merges that
  published nothing. The tag-collision check applies in the original mode too: a computed version that
  the semver tag scan somehow missed is now skipped with a notice instead of failing the merge.
- New `actions/read-pyproject-version` composite action, the first entry in a new `actions/` directory.
  It reads `[project].version` out of a `pyproject.toml` and exposes it as a step output, for handing
  to `create-release-on-merge.yaml`. It parses with `tomllib` rather than grepping: `version` also
  appears under `[build-system]` and inside dependency specs, so a regex over the whole file picks the
  wrong one as soon as the layout changes. Needs Python 3.11+ on the runner, which every current
  GitHub-hosted image has. It ships as an action rather than a reusable workflow so the version is a
  step output inside a job you already have, usable by everything after it.
- New `check-changelog.yaml` reusable workflow. It fails a pull request that did not update
  `CHANGELOG.md`, and when passed a `version` it additionally requires a heading naming that version,
  so a consumer landing on a tag has something to read. Inputs: `version`, `changelog_path`,
  `skip_label`, `skip_bot_authors`.
- This repo's own changelog check is now a caller of that workflow instead of an inline job, which is
  how it gets tested before it is tagged. **This renames the status check** from `Changelog updated` to
  `Changelog / Changelog updated`, because GitHub prefixes a reusable workflow's job with the caller's.
  Branch protection has to be repointed at the new name.
- The bot exemption on that check is now any author whose login ends in `[bot]`, rather than a
  hardcoded list of `dependabot[bot]` and `github-actions[bot]`. A repo using Renovate or its own App
  got no exemption before and had to label every automated pull request.
- Three new examples: `workflow-create-release-from-pyproject.yaml`, `workflow-check-changelog.yaml`,
  and `workflow-check-changelog-versioned.yaml`. They pin `@0.0.22` rather than `@0.0.20` like the
  older examples, because `0.0.22` is the first release that contains any of this. New docs at
  [docs/RELEASE.md](docs/RELEASE.md) explain which release model to pick and why the choice follows
  from where your version already lives.
- The test harness grew `loadAction` for composite actions and a `cwd` option on `runBash` for steps
  that read repo files. The `git` stub answers `rev-parse --verify` and `diff --name-only`, and the
  `date` stub handles `%Y-%m-%d`.


## 0.0.21 - 2026-08-17
- Examples now pin `@0.0.20` instead of `@0.0.18`, and the README quick start matches. `0.0.20` is the
  first release that declares `slack_mention`, `jira_base_url`, and the `status_icon_*` set, so those
  inputs are no longer commented out in `examples/workflow-pr-automation.yaml`. Every input each
  example passes is verified against the reusable workflow at the pinned tag, because passing an input
  the pinned release does not declare is a hard error rather than a warning.
- `backport.yaml` now passes `repositories:` to `actions/create-github-app-token`, scoping the token to
  the repo being backported. Without it the token inherits every repo the App is installed on, so a
  broadly-installed App handed the job write access far beyond the repo in question. The setup doc no
  longer suggests installing the App on "All repositories" either.
- The internal Jira key `BUZZOK` is gone from workflow comments and test fixtures, replaced with
  `PROJ`. The ticket regex is generic (`[A-Z]+-[0-9]+`), so this is a documentation change with no
  behaviour change. Historical `CHANGELOG` and commit-message references are left alone.
- `release/12.0` is no longer the worked example in docs and input descriptions. It named an unreleased
  version; the examples now use `release/X.Y`, which reads as a placeholder.
- `docs/TESTING.md` no longer quantifies how many downstream repos consume this one, and
  `docs/BACKPORT.md` no longer references an internal Jenkins job. Both explained the *why* by pointing
  at internal context a reader outside DataRobot cannot see; they now explain it directly.
- `.github/CONTRIBUTING.md` names `@datarobot-oss/buzok` as the maintaining team alongside the
  individual maintainer, matching CODEOWNERS, so a contributor knows where a review request goes.

## 0.0.20 - 2026-08-14
- `add-jira-link` takes a `jira_base_url` input. The DataRobot Jira host used to be hardcoded in the
  middle of the comment-building script, so every consumer posted links only DataRobot staff could
  open while the generic `[ABC-1234]` ticket regex made the workflow look portable. The input still
  defaults to the DataRobot tenant, so nothing changes for existing consumers, but it is now a
  documented knob set in your copy of the example. Set it to `''` to skip the Jira comment entirely.
- `mark-pr-to-review` takes an optional `slack_mention` input, default empty. The Slack handle
  `@buzok-team` was hardcoded into the message body, which meant every consuming repo broadcast a
  DataRobot team handle into its own Slack channel. This repo's own caller now sets it; everyone else
  gets a clean message with no mention unless they ask for one.
- `notify-slack` takes `status_icon_success`, `status_icon_failure`, and `status_icon_pending` inputs.
  The digest's CI-status column used three emoji that only exist in DataRobot's Slack workspace, so in
  any other workspace every status line rendered as literal `:yellow_pending:` text. The defaults are
  now Slack built-ins that exist everywhere, and this repo's caller opts back into the custom set.
- The three inputs above ship commented out in `examples/workflow-pr-automation.yaml`, because the
  examples pin `@0.0.18` and that release does not declare them. Passing a reusable workflow an input
  its pinned version does not declare fails the run, so a copy-pasted example would have red-X'd on
  every PR open, edit, and cron tick. Each is shown at its default, so bumping the `uses:` refs to a
  release that declares them and uncommenting changes no behavior on its own.
- Renamed two reusable workflows that shared the display name
  `Notify GenAI team on "Ready for review" PRs`, which is the string rendered in every consuming
  repo's Actions tab. They are now `Notify Slack: PR ready for review` and
  `Notify Slack: open PR digest`, which say what they do and name no internal team. The
  `ensure-labels` trigger wrapper and its example are now `Ensure Labels`, so they no longer collide
  with the reusable workflow they call.
- `docs/BACKPORT.md` no longer ends on a `TODO` admitting the recommended GitHub App credentials were
  never set up in this repo, twenty lines after telling adopters to set them up. The gap is real and
  needs org-admin access, so it is now tracked in
  [issue #24](https://github.com/datarobot-oss/github-actions/issues/24) and the doc explains that
  both paths work.
- Added a `Configuration` section to `README.md` covering the inputs above: what each defaults to and
  when a consumer needs to change it.

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
