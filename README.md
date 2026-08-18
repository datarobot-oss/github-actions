<p align="center">
  <a href="https://github.com/datarobot-oss/github-actions">
    <img src="https://af.datarobot.com/img/datarobot_logo.avif" width="600px" alt="DataRobot Logo"/>
  </a>
</p>
<p align="center">
    <span style="font-size: 1.5em; font-weight: bold; display: block;">DataRobot GitHub Actions</span>
</p>

<p align="center">
  <a href="https://datarobot.com">Homepage</a>
  ·
  <a href="https://docs.datarobot.com/en/docs/">Documentation</a>
  ·
  <a href="https://docs.datarobot.com/en/docs/get-started/troubleshooting/general-help.html">Support</a>
</p>

<p align="center">
  <a href="https://github.com/datarobot-oss/github-actions/actions/workflows/self-test.yaml">
    <img src="https://github.com/datarobot-oss/github-actions/actions/workflows/self-test.yaml/badge.svg" alt="Tests">
  </a>
  <a href="https://github.com/datarobot-oss/github-actions/tags">
    <img src="https://img.shields.io/github/v/tag/datarobot-oss/github-actions?label=version" alt="Latest Release">
  </a>
  <a href="/LICENSE">
    <img src="https://img.shields.io/github/license/datarobot-oss/github-actions" alt="License">
  </a>
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Beta">
</p>

> [!NOTE]
> This project is in **beta** (`0.0.x`). Workflow inputs, secrets, and label names may change
> between releases. Pin to a tag and read the release notes before bumping.

Reusable GitHub Actions workflows for pull-request automation, backporting, and releases.

**What it does:** ships drop-in workflows you copy into your own repo, each of which calls a
versioned reusable workflow hosted here. They cover the mechanics most repos rebuild by hand: pinging
Slack when a PR is ready for review, labelling approved PRs, linking Jira tickets, cherry-picking a
merged PR onto release branches, requiring a changelog entry, and cutting a tagged release on merge.
Nothing here is DataRobot-specific to run, and no DataRobot service is required.

# Table of contents

- [Quick start](#quick-start)
- [Available workflows](#available-workflows)
- [Available actions](#available-actions)
- [Configuration](#configuration)
- [Secrets](#secrets)
- [Documentation](#documentation)
- [Contributing, support, and legal](#contributing-support-and-legal)

# Quick start

Copy the workflow you want from [`examples/`](examples) into your repo's `.github/workflows/`
directory. Each example is a thin trigger wrapper that pins a released version of the reusable
workflow, so it works unmodified:

```bash
curl -o .github/workflows/pr-automation.yaml \
  https://raw.githubusercontent.com/datarobot-oss/github-actions/0.0.20/examples/workflow-pr-automation.yaml
```

Then run [`workflow-ensure-labels.yaml`](examples/workflow-ensure-labels.yaml) once from the Actions
tab. It creates the labels the other workflows depend on, and it is idempotent, so re-running it is
safe. Add any [secrets](#secrets) the workflow you chose needs.

To upgrade later, bump the `@0.0.20` ref in the `uses:` lines to a newer
[tag](https://github.com/datarobot-oss/github-actions/tags), and read the
[changelog](CHANGELOG.md) first.

> [!TIP]
> A git tag is a movable reference, so `@0.0.20` is a convenience, not a guarantee.
> If you want the ref to be immutable, pin the commit SHA instead and keep the
> version in a comment, the same way this repo pins its own dependencies:
>
> ```yaml
> uses: datarobot-oss/github-actions/.github/workflows/backport.yaml@<full-sha>  # 0.0.20
> ```

# Available workflows

| Workflow | What it does | Trigger | Secrets |
|---|---|---|---|
| [`workflow-pr-automation.yaml`](examples/workflow-pr-automation.yaml) | Labels approved PRs as reviewed, pings Slack when a PR is marked ready for review, comments Jira links, and posts a 30-minute digest of open PRs | approving review; PR labeled, opened, or edited; 30-minute cron; manual | `SLACK_WEBHOOK_URL` |
| [`workflow-backport.yaml`](examples/workflow-backport.yaml) | Cherry-picks a merged PR onto one or more release branches, opening a PR per branch | `backport <branch>` label on a merged PR, or manual dispatch | `BACKPORT_APP_ID`, `BACKPORT_APP_PRIVATE_KEY` (both optional) |
| [`workflow-ensure-labels.yaml`](examples/workflow-ensure-labels.yaml) | Creates the labels the other workflows require. Idempotent; run once at setup | manual dispatch | none |
| [`workflow-create-release-on-merge.yaml`](examples/workflow-create-release-on-merge.yaml) | Tags the next patch version and cuts a GitHub release | push to `main` | none |
| [`workflow-create-release-from-pyproject.yaml`](examples/workflow-create-release-from-pyproject.yaml) | Tags the version `pyproject.toml` declares and cuts a GitHub release. No-ops when the version was not bumped | push to `main` | none |
| [`workflow-check-changelog.yaml`](examples/workflow-check-changelog.yaml) | Fails a PR that did not update `CHANGELOG.md`. Waivable with a label | pull request | none |
| [`workflow-check-changelog-versioned.yaml`](examples/workflow-check-changelog-versioned.yaml) | The same, but also requires a heading for the version `pyproject.toml` declares | pull request | none |

The last three are the release story, and [docs/RELEASE.md](docs/RELEASE.md) explains which pair to
pick: it comes down to whether a version string already exists inside your repo, or lives only in
your git tags.

The PR-automation and backport workflows depend on labels that
[`workflow-ensure-labels.yaml`](examples/workflow-ensure-labels.yaml) creates. A missing label
hard-fails the job on purpose, so a setup problem shows up as a red X rather than silently doing
nothing.

# Available actions

Reusable workflows are whole jobs. An action is a step, so it runs inside a job you already have and
its outputs are available to everything after it.

| Action | What it does |
|---|---|
| [`actions/read-pyproject-version`](actions/read-pyproject-version) | Reads `[project].version` out of a `pyproject.toml` and exposes it as a step output, for handing to `create-release-on-merge.yaml` or `check-changelog.yaml` |

```yaml
- uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0
- id: version
  uses: datarobot-oss/github-actions/actions/read-pyproject-version@0.0.22
- run: echo "${{ steps.version.outputs.version }}"
```

It reads the file with `tomllib` rather than a `grep`, because `version` also appears under
`[build-system]` and inside dependency specs. That needs Python 3.11+ on the runner, which every
current GitHub-hosted image has.

# Configuration

Every workflow runs unmodified, but a few inputs decide whether the output makes sense outside
DataRobot. Each one is set in your copy of the example, not in the reusable workflow, so upgrading
never overwrites your choice.

| Input | Workflow | Default | Set it when |
|---|---|---|---|
| `jira_base_url` | `add-jira-link.yaml` | DataRobot's Jira tenant | You have your own Jira. Otherwise the PR comment links to a tenant your readers cannot open. Set it to `''` to drop the Jira comment entirely. |
| `slack_mention` | `mark-pr-to-review.yaml` | empty (no mention) | You want reviewers pinged rather than relying on them watching the channel. Use a user group that exists in your workspace; Slack renders an unresolvable handle as plain text. |
| `status_icon_success` / `_failure` / `_pending` | `notify-slack.yaml` | `:white_check_mark:` / `:x:` / `:hourglass_flowing_sand:` | You want the digest's CI-status column to use custom emoji. Defaults are Slack built-ins, which exist in every workspace; a custom emoji name that is not installed renders as literal `:name:` text. |
| `header_icon` | `notify-slack.yaml` | `clipboard` | You want a different emoji at the head of the digest. |
| `version` | `create-release-on-merge.yaml` | empty (bump the latest tag's patch) | Your version already lives in the repo. Pass it and that exact string is tagged, so the tag and the packaged artifact cannot drift. Requires `0.0.22`. |
| `version` | `check-changelog.yaml` | empty (only check the file moved) | You know the version while the PR is open, so the entry can be filed under it. The check then also requires a heading naming that version. Requires `0.0.22`. |
| `changelog_path` | `check-changelog.yaml` | `CHANGELOG.md` | Your changelog is somewhere else. Requires `0.0.22`. |
| `skip_label` | `check-changelog.yaml` | `skip-changelog` | You already have a label for this. It does not need to exist until someone applies it. Requires `0.0.22`. |
| `skip_bot_authors` | `check-changelog.yaml` | `true` | Set it to `false` to hold bot-authored PRs to the same rule. Leaving it on means Dependabot bumps do not each need a label. Requires `0.0.22`. |

The `create-release-on-merge.yaml` workflow also has outputs at `0.0.22` and newer: `version` and
`released`. Gate a follow-on publish job on `released == 'true'` rather than on the release job
succeeding, because a merge that did not bump the version succeeds without publishing anything.

Most of these require a pin of `0.0.20` or newer, and the ones marked above require `0.0.22`. If you pin an older release, remove the inputs it does
not declare: passing an undeclared input to a reusable workflow is a hard error, not a warning.

# Secrets

| Secret | Needed by | Notes |
|---|---|---|
| `SLACK_WEBHOOK_URL` | `workflow-pr-automation.yaml` | Incoming-webhook URL for the channel that receives PR notifications. Without it the Slack steps skip rather than fail. |
| `BACKPORT_APP_ID` | `workflow-backport.yaml` | Optional. GitHub App ID. |
| `BACKPORT_APP_PRIVATE_KEY` | `workflow-backport.yaml` | Optional. The App's private key. Together with `BACKPORT_APP_ID` this makes CI run automatically on backport PRs; without them the workflow falls back to `GITHUB_TOKEN` and CI must be kicked by hand. See [docs/BACKPORT.md](docs/BACKPORT.md). |

# Documentation

- [docs/RELEASE.md](docs/RELEASE.md) covers the two release models, the changelog gate, and how the
  version reader ties them together. Read it before picking a release workflow.
- [docs/BACKPORT.md](docs/BACKPORT.md) covers the backport flow in depth: label conventions, the
  manual dispatch path, conflict handling, and the one-time GitHub App setup.
- [docs/TESTING.md](docs/TESTING.md) covers how the workflows are tested and how to add tests for a
  new one.

# Contributing, support, and legal

See [AUTHORS](AUTHORS) and [LICENSE](LICENSE) for authorship and licensing information.

To contribute, fork the repository, make your changes on a branch, and open a pull request. Run
`task setup` once on a fresh clone to install the test dependencies and the git pre-commit hooks, then
`task ci` (lint, unit tests, secret scan) before submitting. See
[CONTRIBUTING.md](.github/CONTRIBUTING.md) for additional guidelines and
[docs/TESTING.md](docs/TESTING.md) for how the test harness works.

For support, [contact DataRobot](https://docs.datarobot.com/en/docs/get-started/troubleshooting/general-help.html)
or open an issue on the [GitHub repository](https://github.com/datarobot-oss/github-actions/issues).
