<p align="center">
  <a href="https://github.com/datarobot-oss/github-actions">
    <img src=".github/img/datarobot_logo.avif" width="600px" alt="DataRobot Logo"/>
  </a>
</p>
<h3 align="center">DataRobot Github Actions</h3>

<p align="center">
  <a href="https://datarobot.com">Homepage</a>
  ·
  <a href="https://docs.datarobot.com/en/docs/">DataRobot Documentation</a>
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
</p>

A collection of github actions tools for use in open source projects.

# Using this Repo
Copy example workflows from the `examples` directory to your `.github/workflows` folder in your repo. You can bump the `@VERSION` field to upgrade
to new revisions. The examples should be drop in and go. You make need to add the appropriate `SECRET` keys to your repo such as:
- `SLACK_WEBHOOK_URL` (receive slack notifications in the specified channel)

If you use the PR-automation workflow, also copy `examples/workflow-ensure-labels.yaml` and run it once from the Actions tab. It creates the labels
the automation depends on (`00 - Ready for Review`, `00 - Reviewed`); after that the helper jobs assume those labels exist. It has an optional
destructive mode that cleans up confusable label variants (e.g. `Ready for Review` without the `00 - ` prefix), migrating any open PRs to the
canonical label first.


# Contributing & testing

The reusable workflows are linted and unit-tested so changes can be validated on
the PR before a release tag is cut. Run `task ci` (lint + tests) before opening
a PR. See [TESTING.md](TESTING.md) for details and how to add tests for a new
workflow.

# Get help

If you encounter issues or have questions, try the following:

- [Contact DataRobot](https://docs.datarobot.com/en/docs/get-started/troubleshooting/general-help.html) for support.
- Open an issue on the [GitHub repository](https://github.com/datarobot-oss/github-actions).
