# Testing the reusable workflows

This repo's "product" is the reusable workflows under `.github/workflows/`, which
~two dozen downstream repos consume by tag. Historically the only way to know a
change was safe was to merge, tag, and watch real runs. These self-tests let a
change be validated **on the PR**, before a release tag is cut.

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

- `workflow.mjs` — load a workflow, find a step by `id`/`name`, return its
  `run` (bash) or `with.script` (JS) body.
- `github-script.mjs` — run a github-script body against a fake Octokit
  (`makeGithub`) that records every API call for assertions.
- `bash.mjs` — run a `run:` block under `bash -eo pipefail` (matching GitHub's
  default shell), with `$GITHUB_OUTPUT` / `$GITHUB_ENV` wired to temp files and
  parsed back out.
- `stubs/` — deterministic, offline `curl`, `gh`, `git`, and `date` on `PATH`.
  `curl` serves GET fixtures by URL and captures POSTs (so a test can assert
  exactly what would be sent to Slack); `date` makes GNU-style `date -d` work on
  macOS too and pins "now" for stable waiting-time math.

Because the bodies come from the YAML, the production workflows stay
byte-for-byte what downstream repos consume, and a test can never silently drift
from what ships.

## Adding tests for a new workflow

When you add or change a workflow, give its logic a test:

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

Select steps by their `id` when they have one, otherwise by a substring of
`name`. `findStep` throws if zero or more than one step matches, so a renamed
step fails loudly instead of testing nothing.

> Note: `act` (local full-workflow execution) is a complementary next step for
> workflows that are hard to unit-test in pieces (e.g. the backport flow's
> end-to-end cherry-pick). These unit tests cover the logic; `act` covers wiring.
