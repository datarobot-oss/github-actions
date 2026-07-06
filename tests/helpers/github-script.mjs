// Runs an extracted `actions/github-script` body against a fake Octokit, the
// same way the github-script action does: the body is an async function with
// `github`, `context`, `core`, `process` and `console` in scope.

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/**
 * Build a fake `github` client. `responses` maps "rest.<group>.<method>" to
 * either a value or a (params) => value function; the default is an empty-ish
 * reply. Every call is recorded on `client.calls` for assertions.
 */
export function makeGithub(responses = {}) {
  const calls = [];
  const defaults = {
    'rest.issues.listComments': { data: [] },
    'rest.issues.createComment': { data: { id: 1 } },
    'rest.issues.updateComment': { data: { id: 1 } },
    'rest.issues.addLabels': { data: [] },
    'rest.issues.listLabelsForRepo': { data: [] },
    'rest.issues.createLabel': { data: {} },
    'rest.issues.updateLabel': { data: {} },
    'rest.issues.deleteLabel': { data: {} },
    'rest.issues.listForRepo': { data: [] },
    'rest.pulls.get': { data: { head: { ref: 'unknown' } } },
  };
  const make = (key) =>
    async (params) => {
      calls.push({ method: key, params });
      const r = key in responses ? responses[key] : defaults[key];
      const resolved = typeof r === 'function' ? r(params) : r;
      // A stub may model a real API failure by returning (or resolving to) an
      // Error — the script sees it as a rejected call, exactly like Octokit
      // throwing a 404/422. This is how we exercise "does the Action crash?".
      if (resolved instanceof Error) throw resolved;
      return resolved;
    };
  const client = {
    calls,
    callsTo: (key) => calls.filter((c) => c.method === key),
    // Fake octokit paginate: our stubbed methods return a single page, so just
    // run the method and hand back its item array (unwrapping `{ data }`).
    paginate: async (method, params) => {
      const r = await method(params);
      return Array.isArray(r) ? r : (r?.data ?? []);
    },
    rest: {
      issues: {
        listComments: make('rest.issues.listComments'),
        createComment: make('rest.issues.createComment'),
        updateComment: make('rest.issues.updateComment'),
        addLabels: make('rest.issues.addLabels'),
        listLabelsForRepo: make('rest.issues.listLabelsForRepo'),
        createLabel: make('rest.issues.createLabel'),
        updateLabel: make('rest.issues.updateLabel'),
        deleteLabel: make('rest.issues.deleteLabel'),
        listForRepo: make('rest.issues.listForRepo'),
      },
      pulls: {
        get: make('rest.pulls.get'),
      },
    },
  };
  return client;
}

/**
 * Replace `${{ inputs.foo }}` / `${{ ... }}` templating with values from `vars`.
 * Expressions with no supplied value are left untouched — GitHub would expand
 * everything, but for tests we only care about the ones we drive, and leaving
 * the rest as-is keeps literal `${{ }}` examples in comments harmless.
 */
export function renderTemplate(script, vars = {}) {
  return script.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (whole, expr) =>
    expr in vars ? String(vars[expr]) : whole,
  );
}

/**
 * Execute a github-script body.
 *  - script: the JS string
 *  - github / context: the mocks
 *  - env: becomes process.env for the run
 *  - templateVars: values for any `${{ }}` expressions in the body
 */
export async function runGithubScript(script, { github, context, env = {}, templateVars = {} } = {}) {
  const rendered = renderTemplate(script, templateVars);
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
  const fakeProcess = { env: { ...env } };
  const core = { setFailed: (m) => { throw new Error(`core.setFailed: ${m}`); }, info: () => {}, warning: () => {} };
  const fn = new AsyncFunction('github', 'context', 'core', 'process', 'console', rendered);
  await fn(github, context, core, fakeProcess, fakeConsole);
  return { logs };
}
