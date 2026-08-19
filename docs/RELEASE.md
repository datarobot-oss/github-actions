# Releases and changelogs

Two ways to decide what a release is numbered, and a changelog gate that fits
either. Pick the model that matches where your version already lives, then copy
the matching pair of files out of [`examples/`](../examples).

## Which model do you have?

The question is not "how do I want to number releases", it is **does a version
string already exist inside your repository?**

| | Version lives only in git tags | Version lives in the tree (`pyproject.toml`) |
| --- | --- | --- |
| Release workflow | [`workflow-create-release-on-merge.yaml`](../examples/workflow-create-release-on-merge.yaml) | [`workflow-create-release-from-pyproject.yaml`](../examples/workflow-create-release-from-pyproject.yaml) |
| Changelog gate | [`workflow-check-changelog.yaml`](../examples/workflow-check-changelog.yaml) | [`workflow-check-changelog-versioned.yaml`](../examples/workflow-check-changelog-versioned.yaml) |
| Every merge cuts a release? | Yes | Only when the version was bumped |
| Version known while the PR is open? | No | Yes |

This repo itself is the first column. A Python package that ships a wheel is
almost always the second.

## Model 1: the tag is the version

`create-release-on-merge.yaml` with no inputs. On every push to `main` it takes
the highest existing `X.Y.Z` tag, adds one to the patch, tags that, and cuts a
release with auto-generated notes.

Nothing in the repo records the version, so there is nothing to keep in sync and
nothing a pull request can forget. The trade-off is that every merge publishes,
including a typo fix.

The changelog gate can only be the naive one here: while a pull request is open,
nobody knows which number the entry will land under. Contributors add bullets
under an `## Unreleased` heading and those get a version heading when the release
is cut.

## Model 2: the tree is the version

`pyproject.toml` is what goes into the wheel, so it is what `yourtool --version`
reports. If a tag were computed independently, a wheel installed from tag `1.4.2`
could report something else entirely, and there would be no way to tell two
builds apart. So the tag has to follow the file rather than the other way round.

Two pieces do this:

1. [`actions/read-pyproject-version`](../actions/read-pyproject-version) reads
   `[project].version` and exposes it as a step output. It uses `tomllib` rather
   than a `grep`, because `version` also appears under `[build-system]` and
   inside dependency specs, and a regex over the whole file picks the wrong one
   as soon as the layout changes.
2. `create-release-on-merge.yaml` takes that string as its `version` input and
   tags exactly it.

### The consequence: a merge no longer always releases

If a pull request did not bump the version, the tag already exists when the merge
lands. The release job then exits with a notice and publishes nothing.

That is deliberate, for two reasons. A re-run of the workflow on an unchanged
`main` has to be a no-op rather than a red X on the default branch. And a CI-only
tweak should not mint a version that consumers have to reason about.

But it also means nothing stops a pull request from forgetting the bump and
silently shipping nothing. That is what the versioned changelog gate is for: it
runs on the pull request, reads the same version out of the same file, and fails
unless `CHANGELOG.md` carries a heading naming it. The bump and the entry are
then reviewable in the diff like any other line.

### Gating what happens after a release

Because a merge may publish nothing, a follow-on job must not key off the release
job merely succeeding. Use the `released` output:

```yaml
  publish:
    needs: release
    if: needs.release.outputs.released == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Publishing ${{ needs.release.outputs.version }}"
```

`version` is set either way, so a skipped run still tells you which version the
tag collision was against.

## The changelog gate

`check-changelog.yaml` fails a pull request that did not touch the changelog.
Consumers pin your repo by tag, and the changelog is usually the only thing
telling them whether a bump is safe, so this is worth enforcing rather than
encouraging.

Pass `version` and it additionally requires a heading naming that version. The
heading match is deliberately forgiving about style and strict about the number:

| Heading | `version: 1.2.3` |
| --- | --- |
| `## 1.2.3` | matches |
| `## 1.2.3 - 2026-08-18` | matches |
| `## [1.2.3] - 2026-08-18` | matches |
| `### v1.2.3` | matches |
| `## 1.2.30` | does not match |
| `## 1.2.3.1` | does not match |
| `Bumped to 1.2.3.` (prose) | does not match |

Two escape hatches, both on by default:

- **`skip_label`** (default `skip-changelog`) waives the check on one pull
  request. For changes with no consumer-visible effect: a CI-only tweak, a typo
  in a comment.
- **`skip_bot_authors`** (default `true`) waives it for any author whose login
  ends in `[bot]`. Dependabot cannot edit a changelog, and its titles already
  land in the auto-generated release notes, so without this every dependency
  bump needs a label before it can merge.

### The trigger has to include `labeled`

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
```

Naming any type at all replaces the defaults, so the first three have to be
repeated. Without `labeled`, the failure message tells a contributor to apply a
label that cannot re-run the check that produced it, and the pull request stays
red until the next push.

## Requirements

`read-pyproject-version` needs Python 3.11+ on the runner, because `tomllib`
landed in 3.11. Every current GitHub-hosted image satisfies this. A self-hosted
runner may not, and the step says so explicitly rather than failing on an import
traceback; add `actions/setup-python` before it if you hit that.
