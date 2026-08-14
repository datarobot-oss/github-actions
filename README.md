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

**What it does:** ships four drop-in workflows you copy into your own repo, each of which calls a
versioned reusable workflow hosted here. They cover the mechanics most repos rebuild by hand: pinging
Slack when a PR is ready for review, labelling approved PRs, linking Jira tickets, cherry-picking a
merged PR onto release branches, and cutting a tagged release on merge. Nothing here is
DataRobot-specific to run, and no DataRobot service is required.

# Table of contents

- [Quick start](#quick-start)
- [Available workflows](#available-workflows)
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
  https://raw.githubusercontent.com/datarobot-oss/github-actions/0.0.18/examples/workflow-pr-automation.yaml
```

Then run [`workflow-ensure-labels.yaml`](examples/workflow-ensure-labels.yaml) once from the Actions
tab. It creates the labels the other workflows depend on, and it is idempotent, so re-running it is
safe. Add any [secrets](#secrets) the workflow you chose needs.

To upgrade later, bump the `@0.0.18` ref in the `uses:` lines to a newer
[tag](https://github.com/datarobot-oss/github-actions/tags), and read the
[changelog](CHANGELOG.md) first.

> [!TIP]
> A git tag is a movable reference, so `@0.0.18` is a convenience, not a guarantee.
> If you want the ref to be immutable, pin the commit SHA instead and keep the
> version in a comment, the same way this repo pins its own dependencies:
>
> ```yaml
> uses: datarobot-oss/github-actions/.github/workflows/backport.yaml@<full-sha>  # 0.0.18
> ```

# Available workflows

| Workflow | What it does | Trigger | Secrets |
|---|---|---|---|
| [`workflow-pr-automation.yaml`](examples/workflow-pr-automation.yaml) | Labels approved PRs as reviewed, pings Slack when a PR is marked ready for review, comments Jira links, and posts a 30-minute digest of open PRs | approving review; PR labeled, opened, or edited; 30-minute cron; manual | `SLACK_WEBHOOK_URL` |
| [`workflow-backport.yaml`](examples/workflow-backport.yaml) | Cherry-picks a merged PR onto one or more release branches, opening a PR per branch | `backport <branch>` label on a merged PR, or manual dispatch | `BACKPORT_APP_ID`, `BACKPORT_APP_PRIVATE_KEY` (both optional) |
| [`workflow-ensure-labels.yaml`](examples/workflow-ensure-labels.yaml) | Creates the labels the other workflows require. Idempotent; run once at setup | manual dispatch | none |
| [`workflow-create-release-on-merge.yaml`](examples/workflow-create-release-on-merge.yaml) | Tags the next patch version and cuts a GitHub release | push to `main` | none |

The PR-automation and backport workflows depend on labels that
[`workflow-ensure-labels.yaml`](examples/workflow-ensure-labels.yaml) creates. A missing label
hard-fails the job on purpose, so a setup problem shows up as a red X rather than silently doing
nothing.

# Configuration

Every workflow runs unmodified, but a few inputs decide whether the output makes sense outside
DataRobot. Each one is set in your copy of the example, not in the reusable workflow, so upgrading
never overwrites your choice.

Inputs marked "needs a newer pin" below postdate the `@0.0.18` release the examples pin, so they
appear commented out in the example. Passing an input the pinned version does not declare fails the
run, so bump the `uses:` refs to a release that declares them before uncommenting.

| Input | Workflow | Default | Set it when |
|---|---|---|---|
| `jira_base_url` | `add-jira-link.yaml` | DataRobot's Jira tenant | You have your own Jira. Otherwise the PR comment links to a tenant your readers cannot open. Set it to `''` to drop the Jira comment entirely. (Needs a newer pin.) |
| `slack_mention` | `mark-pr-to-review.yaml` | empty (no mention) | You want reviewers pinged rather than relying on them watching the channel. Use a user group that exists in your workspace; Slack renders an unresolvable handle as plain text. (Needs a newer pin.) |
| `status_icon_success` / `_failure` / `_pending` | `notify-slack.yaml` | `:white_check_mark:` / `:x:` / `:hourglass_flowing_sand:` | You want the digest's CI-status column to use custom emoji. Defaults are Slack built-ins, which exist in every workspace; a custom emoji name that is not installed renders as literal `:name:` text. (Needs a newer pin.) |
| `header_icon` | `notify-slack.yaml` | `clipboard` | You want a different emoji at the head of the digest. |

# Secrets

| Secret | Needed by | Notes |
|---|---|---|
| `SLACK_WEBHOOK_URL` | `workflow-pr-automation.yaml` | Incoming-webhook URL for the channel that receives PR notifications. Without it the Slack steps skip rather than fail. |
| `BACKPORT_APP_ID` | `workflow-backport.yaml` | Optional. GitHub App ID. |
| `BACKPORT_APP_PRIVATE_KEY` | `workflow-backport.yaml` | Optional. The App's private key. Together with `BACKPORT_APP_ID` this makes CI run automatically on backport PRs; without them the workflow falls back to `GITHUB_TOKEN` and CI must be kicked by hand. See [docs/BACKPORT.md](docs/BACKPORT.md). |

# Documentation

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
