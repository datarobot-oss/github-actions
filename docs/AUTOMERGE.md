# Automerge

`automerge.yaml` approves and merges pull requests opened by an allow-listed bot, once every
check the repo expects has actually reported green. It exists to take a specific, large, and
entirely mechanical chunk of work off people: watching a Dependabot or CVE-bump PR, confirming
CI is green, approving it, and merging it. That loop involves no judgment. It is pure latency.

It is the only workflow in this repo that can change your repository without a human in the
loop, so it is deliberately harder to turn on than the others, and it starts in a mode that
merges nothing.

## The one idea to take away

**The ruleset is the enforcer. This workflow is only the trigger.**

It is meant to run against a branch governed by two *stacked* rulesets:

- one carrying `required_status_checks`, with an **empty** bypass list
- one carrying `pull_request` (the review rule), with the merge App **bypassed**

So the App can merge without a human review, and cannot merge a PR that fails a required
check. GitHub refuses that server-side, no matter what this workflow decides. Everything below
is a second, narrower gate layered on top of that floor, never a replacement for it.

Getting this split wrong is the one way to make automerge genuinely unsafe. See
"Ruleset setup" below.

## Why not GitHub's native auto-merge

Native auto-merge waits only on **required** checks, and the required set has to stay small.
A required context that a PR legitimately never fires leaves that PR pending forever, so a repo
cannot simply require everything it cares about.

That leaves a gap: a bot PR can satisfy every required check while a suite you very much
wanted to see never ran at all.

`expected_checks` in `.github/automerge.yaml` closes it. Those contexts must be **present and
green**, not merely not-failing, and the list can be far stricter than anything the repo could
make mandatory, because **it wedges nothing**. If an expected check is missing, the PR simply
waits for a human instead of merging itself.

The contexts your rulesets already require are added automatically, read live from the branch
rules API. Do not copy them into the policy file; they would only drift.

### The gate-job caveat

A job that is skipped reports **no status at all**. So a path-filtered workflow will never
report, and a PR waiting on it will never merge.

The fix is an always-reporting gate job, not a shorter `expected_checks` list: a `needs:`-gated
job with `if: always()` whose name is the context you list. It reports green in seconds having
run nothing when the suite does not apply, and red when any leg of the suite failed. That keeps
it listable.

## Setup

`scripts/install-automerge.sh` does most of this and checks all of it:

```bash
scripts/install-automerge.sh --repo owner/name --pem ~/keys/dr-auto-merge.pem          # audit
scripts/install-automerge.sh --repo owner/name --pem ~/keys/dr-auto-merge.pem --apply  # fix
```

It is read-only without `--apply`, and exits non-zero while anything still blocks automerge,
so it works as a pre-flight and as a re-check afterwards. With `--apply` it creates the
`automerge` label, sets the secret from your PEM, and adds the App to the review ruleset's
bypass list, re-reading the ruleset afterwards rather than trusting the write.

Two things it deliberately does not do:

- **Install the App on the repository.** The API for that needs a user-to-server token from an
  OAuth flow, which `gh` does not issue, so it stays a click in the browser. The script does
  *detect* whether it has happened, by authenticating as the App with your private key, so you
  are never left guessing.
- **Split your rulesets.** Moving the `pull_request` rule between rulesets is surgery on branch
  protection, and getting it wrong is the one way to make automerge genuinely unsafe. The script
  refuses to add a bypass to any ruleset that also carries `required_status_checks`, and reports
  the split with exact instructions instead.

The manual steps behind it, in full:

1. **Create a GitHub App** and install it on the repo. Repository permissions:

   | Permission | Level | Why |
   |---|---|---|
   | Contents | Read and write | `PUT /pulls/{n}/merge` requires write |
   | Pull requests | Read and write | approve, comment, read commits and files |
   | Checks | Read-only | check-run conclusions |
   | Commit statuses | Read-only | non-Actions status contexts |
   | Workflows | Write | see below |
   | Metadata | Read-only | mandatory |

   **Workflows: write is not optional** if you automerge Dependabot's `github-actions`
   ecosystem, because those PRs modify `.github/workflows/` by definition, and an App token
   without it is refused when a commit it creates touches a workflow file. The merge API
   creates that commit as the token. There is no read-only tier for this permission.

   No Actions, Secrets, Administration, or Issues scope is needed. Commenting on and reading
   labels of a PR both fall under Pull requests.

2. **Add the private key** as a secret the repo can read, e.g. `DR_AUTO_MERGE_PRIVATE_KEY`.
   Whole PEM, BEGIN/END lines included. The app id is public metadata, so it is a plain input
   rather than a secret.

3. **Split your rulesets** as described below.

4. **Copy the policy file.** `examples/automerge.yaml` to `.github/automerge.yaml`, and edit it.
   The presence of this file is what enrols a repo: delete it and automerge stops, with no
   workflow edit. If the workflow runs without it, the job fails loudly rather than quietly
   doing nothing.

5. **Copy the caller.** `examples/workflow-automerge.yaml` to `.github/workflows/`.

6. **Leave `mode: report`** until you have watched it against real traffic for a week.

## Ruleset setup

Ruleset bypass applies to a **whole ruleset**, not to individual rules. "Skip review but still
run the tests" is therefore not expressible in one ruleset. Split it in two:

| Ruleset | Bypass | Rules |
|---|---|---|
| `main` | **empty** | `deletion`, `non_fast_forward`, `required_status_checks` |
| `main review` | the merge App, `always` | `pull_request` only |

Rulesets stack and the union of matching rules applies, so **the `pull_request` rule must exist
in exactly one of them**. Leave a copy in both and the bypass is silently defeated: the App
bypasses one and is immediately caught by the other.

Two more things that are easy to get wrong:

- **Bypass resolves against whoever performs the merge**, not who opened the PR. Putting
  `dependabot[bot]` in a bypass list does nothing if the merge is executed by a workflow's
  `GITHUB_TOKEN`, which acts as `github-actions[bot]`. That actor cannot be given a bypass
  either: bypass actors must be Apps *installed* on the repo, and Actions is built in. This is
  the whole reason the workflow merges with an App token.
- **Bypass actors must already be installed.** Install the App before adding the entry.

## Modes

The mode is the rollout. Move one step at a time and do not skip the first.

| Mode | Behaviour |
|---|---|
| `report` | Evaluates every PR and comments its verdict. Approves nothing, merges nothing. |
| `approve` | Also approves. A human still clicks merge. |
| `merge` | Also merges. |

`report` is the default, so a caller that forgets to set the input cannot merge anything.

Run `report` for a week first. It gives you a log of "would have merged" against PRs whose real
outcome you already know, which is the only cheap way to find out whether your policy says what
you think it says.

Even in `merge` mode the approval and the merge happen on **different polls**, so there is
always a window in which a person can intervene.

## Why a cron and not `pull_request`

Three independent reasons:

1. A Dependabot `pull_request` event reads **Dependabot secrets** only, never the repo's Actions
   secrets. The App private key would arrive empty.
2. GitHub intermittently fails to dispatch workflow runs at all. A fire-once bot would skip
   those PRs permanently; a poller self-heals on the next tick.
3. "Wait for the checks to finish" falls out for free, with no sleep loop burning runner minutes
   and no job timeout to lose the PR to.

The cost is latency. A bot PR merges in roughly 10 to 20 minutes rather than instantly.

## What is checked

Cheapest first. Any failure is a no-op that is logged, never a red X on the PR.

1. Policy file present on the **default branch**. A scheduled run checks out the default branch
   by construction, so a PR can never supply a policy that grants itself permission.
2. The opt-in label is present.
3. The PR author is in `allowed_authors`.
4. **Every commit is authored and committed by an allow-listed bot.** Not just the PR opener:
   `pull_request.user.login` stays the bot after a human pushes to the branch, so an
   opener-only check would let hand-written code ride the automerge label in. A commit with no
   linked GitHub account is refused too.
5. The union of ruleset-required contexts and `expected_checks` is non-empty. Refusing here is
   the "never merge having verified nothing" guard.
6. Every context in that union is **present** and successful on the head commit.
7. Nothing is queued or in progress.
8. No other check is failing (`block_on_any_failure`). `skipped` and `neutral` count as a pass.
9. No outstanding `CHANGES_REQUESTED` review.
10. No open finding from a review bot (`block_on_cursor_comments`, off by default). See below.
11. The PR is mergeable, and not behind base when the ruleset is strict.
12. `max_changed_files` and `allowed_paths`.
13. The settle window has elapsed, measured from the last check completion rather than slept
    through. Its real job is catching a workflow that has not registered a check run yet.

The merge is pinned to the head commit that was evaluated, so a push landing between evaluation
and merge fails the merge instead of sailing through it unexamined.

## Blocking on an AI reviewer

Cursor Bugbot reviews a PR and leaves its findings as inline review comments. It does not
report through a check, and it does not click "Request changes". So by default it is invisible
to everything in the list above: a dependency PR can carry a high-severity Bugbot finding and
still merge itself, because every check was green and no human said otherwise.

Set `block_on_cursor_comments: true` in the policy and an open finding becomes a **terminal**
refusal. The PR is handed to a person the same way a red check is.

The subtlety is what counts as open. Automerge reads review **threads**, not comments, because
threads are the only place GitHub records whether a conversation has been dealt with:

| Thread state | Blocks? | Why |
|---|---|---|
| Open | yes | Nobody has looked at it. |
| Resolved | no | Clicking "Resolve conversation" is a person saying it is handled. |
| Outdated | no | The lines it pointed at are gone from the diff, so it no longer describes this PR. |

Threads are also the right unit rather than the bot's summary review. Bugbot posts "I reviewed
your changes" whether or not it found anything, so counting comments would ask *did the bot
run*, and every PR would block forever. It opens a thread only when it actually found
something, which is the question worth asking.

Excluding outdated threads is also what keeps the escalation recoverable. Escalation strips the
opt-in label, and the documented way back is to fix the problem and re-apply it. If a thread
kept blocking after the code it referred to was rewritten, re-applying the label would escalate
the PR again on the very next poll and it could never be handed back to the bot.

Which logins count is `review_bot_logins`, defaulting to `cursor[bot]`. GitHub spells the same
account `cursor[bot]` in REST and `cursor` in GraphQL; both forms match, so the `[bot]` suffix
is optional.

Two smaller decisions worth knowing:

- **A thread belongs to whoever opened it.** A human replying to a Bugbot finding does not
  launder it into a human thread.
- **A failed read waits rather than escalating.** Escalation is one-shot, so spending a PR's
  single handover on a GraphQL outage or a token missing a scope would burn it on something
  that says nothing about the PR. The next poll asks again, and nothing merges meanwhile.

This flag is **off by default**, unlike `block_on_any_failure`. It is the one guard that hands
your PR to a human on the say-so of a third-party bot that need not even be installed, so a
repo that has never heard of Bugbot does not inherit it on a version bump.

## When it gives up, it hands over

Automerge refuses for two different kinds of reason, and it treats them differently.

**Transient**, so it waits for the next poll: checks still running, an unreported check whose
workflow may not have started, a settle window, a branch behind base, mergeability not yet
computed.

**Terminal**, so a person is needed: a check that completed and failed, a PR over
`max_changed_files`, a file outside `allowed_paths`, an open review-bot finding. None of these
resolve on their own.

On a terminal refusal, and only when `escalate_label` is set, the workflow:

1. removes the `automerge` label,
2. applies `escalate_label` (`00 - Ready for Review` in the example),
3. posts a **new** comment saying what went wrong and what to do about it.

The order matters. Removing the opt-in label first is what makes the handover happen exactly
once: the PR immediately stops being a candidate, so the next poll passes over it.

The comment is new rather than an edit of the running verdict because **GitHub sends no
notification when a comment is edited**, and the entire point is to get someone's attention.

There is a second, quieter benefit. The label is applied with the App token, and unlike
`GITHUB_TOKEN`, App-token actions *do* trigger workflows. So applying `00 - Ready for Review`
fires the existing `mark-pr-to-review.yaml` Slack ping with no extra wiring.

In `report` mode the workflow says what it *would* do and changes no labels.

The full loop this closes:

```
bot opens a dependency PR
      -> checks run
      -> automerge polls until everything has settled
            -> all green  -> approve, then merge on a later poll
            -> red        -> drop the label, tag a human, say why
```

Either way the PR reaches a resolution. It never just sits there.

## Turning it off

Three independent levers, any one sufficient:

- **One PR:** remove the label.
- **One repo:** delete `.github/automerge.yaml`.
- **Everywhere:** remove the App's bypass entry, or uninstall the App.

## Known limits

- A branch behind base cannot merge when the ruleset is strict, and this workflow does not
  rebase. It refuses and says so. Rebasing a stale PR is the obvious next feature and is
  deliberately not in this version, because it means writing to the PR branch.
- An expected check that never reports leaves a PR waiting indefinitely. That is the correct
  direction to fail, but nothing escalates it yet beyond the verdict comment.
- GitHub disables scheduled workflows after 60 days of repository inactivity, so a dormant repo
  silently stops automerging. A dormant repo has no bot PRs either, so this has not mattered.
