# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project is in beta
(`0.0.x`) and does not yet follow semantic versioning: every release is a patch bump, and workflow
inputs, secrets, and label names may change between releases. Pin to a tag.

Entries below 0.0.19 were backfilled from the
[GitHub releases](https://github.com/datarobot-oss/github-actions/releases) and are summarized rather
than exhaustive.

## [Unreleased]

### Added

- `CHANGELOG.md`, plus a CI check that requires every pull request to update it.

### Changed

- Rewrote `README.md` for external consumers: quick start with a copy-pasteable command, a table of
  the four example workflows with their triggers and secrets, and a secrets reference. Contributor
  instructions moved to their own section.
- `.github/CODEOWNERS` now names `@datarobot-oss/buzok`. The previous entries pointed at teams in
  other orgs, which GitHub resolves to nothing, so code-owner review was enforcing no owner.
- Examples now pin `@0.0.18` instead of `@0.0.16`.

### Fixed

- Filled in the Apache 2.0 copyright placeholder in `LICENSE`.
- Documentation links that broke when `TESTING.md` and `BACKPORT.md` moved into `docs/`. The link
  posted into consumers' backport PRs is now an absolute URL, since a relative path cannot resolve
  in another repository.

## [0.0.18] - 2026-07-06

### Fixed

- Label colors now match DataRobot standards. ([#19])

## [0.0.17] - 2026-07-06

### Fixed

- `ensure-labels` no longer fails when an existing label differs only by case. ([#18])

## [0.0.16] - 2026-07-01

### Changed

- Narrowed workflow permissions to the minimum each job needs. ([#17])

## [0.0.15] - 2026-07-01

### Changed

- Reworked `ensure-labels` and unified label naming across the workflows. ([#16])

## [0.0.14] - 2026-07-01

### Changed

- Consolidated the workflows, added the manual backport path, and fixed the examples. ([#15])

## [0.0.13] - 2026-07-01

### Fixed

- Broken label definitions. ([#14])

## [0.0.12] - 2026-06-30

### Fixed

- Bug fixes in the backport workflows. ([#13])

## [0.0.11] - 2026-06-30

### Added

- Backport workflows, plus documentation of the labels they require. ([#11])

## [0.0.10] - 2026-06-30

### Added

- Self-test harness that lints every workflow and unit-tests the bash and `github-script` bodies
  embedded in them, so changes are validated on the PR before a release tag is cut. ([#12])

## [0.0.9] - 2026-06-04

### Changed

- Slack notifications now carry more useful information. ([#10])

## [0.0.8] - 2026-05-28

### Fixed

- `HAS_APPROVAL` was not always set correctly during Slack scans. ([#9])

## [0.0.7] - 2026-05-28

### Security

- Hardened `add-jira-link` against injection via pull-request-controlled input. ([#8])

## [0.0.6] - 2026-05-28

### Security

- Hardened the workflows against shell injection through pull-request-controlled inputs, and
  declared least-privilege `permissions:` on the reusable workflows and examples. ([#7])

  **Releases `0.0.1` through `0.0.5` are affected and should not be used.** In those versions a
  crafted pull request title could break out of a shell assignment in `mark-pr-to-review` and
  `add-jira-link`, reaching secrets in the job environment. Upgrade to `0.0.6` or later.

## [0.0.5] - 2026-04-01

### Added

- `add-jira-link` handles multiple Jira ticket IDs in a pull request title. ([#5])

## [0.0.4] - 2026-02-13

### Added

- Example workflows under `examples/`. ([#4])

## [0.0.3] - 2026-02-13

### Changed

- Workflow naming. ([#3])

## [0.0.2] - 2026-02-13

### Added

- Release workflows. ([#2])

### Changed

- Renamed the initial workflows. ([#2])

## [0.0.1] - 2026-02-13

### Added

- Initial set of reusable GitHub Actions workflows. ([#1])

[Unreleased]: https://github.com/datarobot-oss/github-actions/compare/0.0.18...HEAD
[0.0.18]: https://github.com/datarobot-oss/github-actions/compare/0.0.17...0.0.18
[0.0.17]: https://github.com/datarobot-oss/github-actions/compare/0.0.16...0.0.17
[0.0.16]: https://github.com/datarobot-oss/github-actions/compare/0.0.15...0.0.16
[0.0.15]: https://github.com/datarobot-oss/github-actions/compare/0.0.14...0.0.15
[0.0.14]: https://github.com/datarobot-oss/github-actions/compare/0.0.13...0.0.14
[0.0.13]: https://github.com/datarobot-oss/github-actions/compare/0.0.12...0.0.13
[0.0.12]: https://github.com/datarobot-oss/github-actions/compare/0.0.11...0.0.12
[0.0.11]: https://github.com/datarobot-oss/github-actions/compare/0.0.10...0.0.11
[0.0.10]: https://github.com/datarobot-oss/github-actions/compare/0.0.9...0.0.10
[0.0.9]: https://github.com/datarobot-oss/github-actions/compare/0.0.8...0.0.9
[0.0.8]: https://github.com/datarobot-oss/github-actions/compare/0.0.7...0.0.8
[0.0.7]: https://github.com/datarobot-oss/github-actions/compare/0.0.6...0.0.7
[0.0.6]: https://github.com/datarobot-oss/github-actions/compare/0.0.5...0.0.6
[0.0.5]: https://github.com/datarobot-oss/github-actions/compare/0.0.4...0.0.5
[0.0.4]: https://github.com/datarobot-oss/github-actions/compare/0.0.3...0.0.4
[0.0.3]: https://github.com/datarobot-oss/github-actions/compare/0.0.2...0.0.3
[0.0.2]: https://github.com/datarobot-oss/github-actions/compare/0.0.1...0.0.2
[0.0.1]: https://github.com/datarobot-oss/github-actions/commits/0.0.1
[#1]: https://github.com/datarobot-oss/github-actions/pull/1
[#2]: https://github.com/datarobot-oss/github-actions/pull/2
[#3]: https://github.com/datarobot-oss/github-actions/pull/3
[#4]: https://github.com/datarobot-oss/github-actions/pull/4
[#5]: https://github.com/datarobot-oss/github-actions/pull/5
[#7]: https://github.com/datarobot-oss/github-actions/pull/7
[#8]: https://github.com/datarobot-oss/github-actions/pull/8
[#9]: https://github.com/datarobot-oss/github-actions/pull/9
[#10]: https://github.com/datarobot-oss/github-actions/pull/10
[#11]: https://github.com/datarobot-oss/github-actions/pull/11
[#12]: https://github.com/datarobot-oss/github-actions/pull/12
[#13]: https://github.com/datarobot-oss/github-actions/pull/13
[#14]: https://github.com/datarobot-oss/github-actions/pull/14
[#15]: https://github.com/datarobot-oss/github-actions/pull/15
[#16]: https://github.com/datarobot-oss/github-actions/pull/16
[#17]: https://github.com/datarobot-oss/github-actions/pull/17
[#18]: https://github.com/datarobot-oss/github-actions/pull/18
[#19]: https://github.com/datarobot-oss/github-actions/pull/19
