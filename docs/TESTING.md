# Testing the reusable workflows

This repo's "product" is the reusable workflows under `.github/workflows/` and
the composite actions under `actions/`, which consuming repos reference by tag.
Because a consumer runs them rather than importing them, a change here is only
observable once it is tagged and executed somewhere. These self-tests close that gap: they validate a change **on the PR**,
before a release tag is cut.

There are three checks, all run by CI (`.github/workflows/self-test.yaml`) and
locally via [`go-task`](https://taskfile.dev):

| Check | What it covers | Run locally |
| --- | --- | --- |
| **actionlint** | Every workflow: YAML schema, `${{ }}` expressions, runner labels, plus **shellcheck** on every inline `run:` script | `task lint` |
| **github-script tests** | The JS in `actions/github-script` steps (`tests/scripts-js.test.mjs`) | `task test` |
| **bash tests** | The `run:` shell blocks (`tests/scripts-bash.test.mjs`) | `task test` |

```bash
task          # list available tasks
task ci       # lint + test (everything CI runs)
task lint     # actionlint + shellcheck via Docker (matches CI exactly)
task test     # node unit tests
```

`task lint` runs actionlint through Docker, so the only local prerequisites are
Docker (for lint) and Node 18+ (for tests). No global installs.

## How it works — tests run the *real* shipped code

The tests **do not** reimplement the workflow logic. Instead the harness
(`tests/helpers/`) loads each workflow YAML and pulls the embedded `run:` and
`with.script:` blocks straight out of it, then executes them against fakes:

- `workflow.mjs` — load a workflow (`loadWorkflow`) or a composite action
  (`loadAction`), find a step by `id`/`name`, return its `run` (bash) or
  `with.script` (JS) body. A workflow keeps its steps under each job and an
  action keeps them under `runs.steps`; both feed the same selectors.
- `github-script.mjs` — run a github-script body against a fake Octokit
  (`makeGithub`) that records every API call for assertions.
- `bash.mjs` — run a `run:` block under `bash -eo pipefail` (matching GitHub's
  default shell), with `$GITHUB_OUTPUT` / `$GITHUB_ENV` wired to temp files and
  parsed back out. Pass `cwd` for a step that reads repo files (a changelog, a
  `pyproject.toml`) rather than only environment variables.
- `stubs/` — deterministic, offline `curl`, `gh`, `git`, and `date` on `PATH`.
  `curl` serves GET fixtures by URL and captures POSTs (so a test can assert
  exactly what would be sent to Slack); `git` answers `tag --list`,
  `rev-parse --verify refs/tags/X`, and `diff --name-only` from `__GIT_TAGS` /
  `__GIT_DIFF_FILES`; `date` makes GNU-style `date -d` work on macOS too and pins
  "now" for stable waiting-time math.

A stub fails loud on any call it does not implement, so a new call site in a
workflow shows up as a test failure rather than silently returning nothing.

Because the bodies come from the YAML, the production workflows stay
byte-for-byte what downstream repos consume, and a test can never silently drift
from what ships.

## Adding tests for a new workflow or action

When you add or change one, give its logic a test:

1. **github-script step** — grab the body and assert on the recorded API calls:

   ```js
   const script = githubScript(loadWorkflow('my-workflow'), { name: 'My step' });
   const github = makeGithub({ 'rest.issues.listComments': { data: [] } });
   await runGithubScript(script, { github, context: ctx, env: { PR_NUMBER: '1' } });
   assert.equal(github.callsTo('rest.issues.createComment').length, 1);
   ```

2. **bash step** — drive it with env / curl fixtures and read the outputs:

   ```js
   const script = runScript(loadWorkflow('my-workflow'), { id: 'my-step' });
   const r = runBash(script, { env: { FOO: 'bar' }, curlFixtures: [{ match: 'pulls/1', body: {...} }] });
   assert.equal(r.outputs['some-output'], 'expected');
   ```

3. **composite action step** — same as a bash step, but loaded with
   `loadAction`, and usually run against a scratch directory:

   ```js
   const script = runScript(loadAction('read-pyproject-version'), { id: 'read' });
   const r = runBash(script, { cwd: sandbox({ 'pyproject.toml': '[project]\nversion = "1.0.0"\n' }) });
   assert.equal(r.outputs.version, '1.0.0');
   ```

   `sandbox()` in `tests/scripts-bash.test.mjs` builds that directory from a
   `{ path: contents }` map.

Select steps by their `id` when they have one, otherwise by a substring of
`name`. `findStep` throws if zero or more than one step matches, so a renamed
step fails loudly instead of testing nothing.

> Note: `act` (local full-workflow execution) is a complementary next step for
> workflows that are hard to unit-test in pieces (e.g. the backport flow's
> end-to-end cherry-pick). These unit tests cover the logic; `act` covers wiring.
