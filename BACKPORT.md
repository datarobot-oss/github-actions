# Backport / Cherry-Pick Automation

Label a merged PR and a cherry-pick PR is opened on the branch you name. Write
once here, distribute to every repo by copying one example workflow.

## TL;DR usage

1. Merge your fix to `main` as normal.
2. Add a label to the PR: **`backport <branch>`** — e.g. `backport release/12.0`.
   - Add several (`backport release/12.0`, `backport release/11.1`) to fan out.
   - You can add the label **before or after** merge; both work.
3. The automation cherry-picks the merge onto that branch and opens a PR
   assigned to you, titled `[Backport release/12.0] <original title>`.
4. The original PR gets a comment with the result and a **`backported <branch>`**
   label. The trigger label stays as the permanent record.

### When the cherry-pick conflicts

Nothing is dropped silently. The original PR gets:
- a **`backport-failed`** label,
- a comment with the exact manual `git cherry-pick` commands to finish it by hand.

```bash
git checkout release/12.0 && git pull
git checkout -b backport/pr-<N>-release-12.0
git cherry-pick <merge_sha>     # -m 1 for a merge commit
# resolve, push, open a PR targeting release/12.0
```

## How it's wired (matches this repo's conventions)

| File | Role |
|---|---|
| `.github/workflows/backport.yaml` | Reusable workflow (`workflow_call`) — the logic. Wraps [`korthout/backport-action`](https://github.com/korthout/backport-action). |
| `.github/workflows/workflow-backport.yaml` | Trigger wrapper that dogfoods it in **this** repo. |
| `examples/workflow-backport.yaml` | Drop-in for **consuming** repos, pinned `@version`. |

To onboard a repo:

1. Copy `examples/workflow-backport.yaml` into its `.github/workflows/`.
2. **Create the trigger labels** the repo will use — one `backport <branch>` per
   target branch (e.g. `backport release/12.0`). A dev applies these by hand, so
   they must exist first. The result labels (`backported <branch>`,
   `backport-failed`) are auto-created on first use but are worth pre-making for a
   sensible colour/description.
3. Commit. Bump the `@version` to upgrade later — no other change needed.

> The required-labels list is also repeated as a comment block at the top of the
> example file, so it travels with the copy.

## Token & CI — important

PRs opened with the built-in `GITHUB_TOKEN` **do not trigger other workflows**, so
CI will not auto-run on the backport PR. For an LTS line you almost always *want*
the cherry-pick tested. The workflow therefore supports an **optional GitHub App
token**:

| Mode | CI on backport PR? | Setup |
|---|---|---|
| **GitHub App** (secrets present) | ✅ yes | one-time org App + 2 secrets |
| `GITHUB_TOKEN` fallback (no secrets) | ❌ no — push empty commit / re-open to kick CI | none |

In the fallback case the workflow makes the gap loud: each backport PR gets a
**`do not merge`** label and a comment explaining that CI didn't run and exactly
how to kick it:

```bash
git fetch origin
git checkout <backport-branch>
git commit --allow-empty -m "ci: trigger checks"
git push
```

The empty commit fires a `pull_request: synchronize` event, which standard CI
runs on. When checks pass, remove the `do not merge` label and merge. Consider
adding a branch-protection rule so a PR carrying `do not merge` can't be merged
at all.

The fallback needs **zero setup**, so you can adopt this today and flip on App-based
CI later **just by adding the two secrets** — no workflow change in any repo.

### One-time GitHub App setup (for an org admin)

A GitHub App is an **org-owned identity** — it is *not* tied to any person's
account and does not consume a seat, which makes it the right fit for
org-controlled accounts. Steps:

1. Org admin → `https://github.com/organizations/datarobot-oss/settings/apps` →
   **New GitHub App**.
   - Name: e.g. `datarobot-backport-bot`.
   - Uncheck **Webhook → Active** (not needed).
   - **Repository permissions:** `Contents: Read and write`,
     `Pull requests: Read and write`.
   - Where can it be installed: **Only on this account**.
2. **Create**, then note the **App ID**. Under **Private keys**, **Generate a
   private key** (downloads a `.pem`).
3. **Install App** → choose the repos that need backports (or All repositories).
4. Add two **org-level Actions secrets** (or per-repo) so the example workflow
   picks them up:
   - `BACKPORT_APP_ID` = the App ID
   - `BACKPORT_APP_PRIVATE_KEY` = the full contents of the `.pem`

Once those secrets exist, backport PRs are opened by `datarobot-backport-bot[bot]`
and CI runs on them automatically. Until then, the workflow uses `GITHUB_TOKEN`.

> **TODO (tracked separately):** open a ticket to stand up the org GitHub App and
> add the two secrets. Until it lands we run on the `GITHUB_TOKEN` fallback.
