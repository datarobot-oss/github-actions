// Tests for the `actions/github-script` (JS) blocks embedded in the reusable
// workflows. The bodies are pulled straight out of the YAML, so these can't
// drift from what ships. The GitHub API is faked; we assert on the calls made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow, githubScript } from './helpers/workflow.mjs';
import { makeGithub, runGithubScript } from './helpers/github-script.mjs';

const ctx = { repo: { owner: 'datarobot-oss', repo: 'demo' } };

// add-jira-link's `jira_base_url` input has a default, but the harness extracts
// the script body only and does not evaluate `with:` defaults, so every call
// site has to pass it the way GitHub would.
const JIRA_BASE_URL = 'https://datarobot.atlassian.net/browse';

// --------------------------------------------------------------------------
// add-jira-link.yaml — "Comment with Jira link"
// --------------------------------------------------------------------------
test('add-jira-link: single ticket creates a singular comment', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub({ 'rest.issues.listComments': { data: [] } });

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'PROJ-123', PR_NUMBER: '42', JIRA_BASE_URL },
  });

  const created = github.callsTo('rest.issues.createComment');
  assert.equal(created.length, 1, 'should create a comment');
  assert.equal(github.callsTo('rest.issues.updateComment').length, 0);
  const { body, issue_number } = created[0].params;
  assert.equal(issue_number, 42);
  assert.match(body, /### 🎫 Jira Ticket\n/); // singular header
  assert.match(body, /\[PROJ-123\]\(https:\/\/datarobot\.atlassian\.net\/browse\/PROJ-123\)/);
  assert.doesNotMatch(body, /^- /m, 'single ticket should not be a bullet list');
});

// The whole point of the input is that a non-DataRobot consumer gets links its
// own readers can open. If this regresses, the workflow is portable in name only.
test('add-jira-link: a consumer-supplied jira_base_url replaces the default host', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub();

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'ACME-9', PR_NUMBER: '3', JIRA_BASE_URL: 'https://acme.atlassian.net/browse' },
  });

  const { body } = github.callsTo('rest.issues.createComment')[0].params;
  assert.match(body, /\[ACME-9\]\(https:\/\/acme\.atlassian\.net\/browse\/ACME-9\)/);
  assert.doesNotMatch(body, /datarobot/i, 'no DataRobot host leaks into a consumer comment');
});

test('add-jira-link: a trailing slash on jira_base_url does not double up', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub();

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'ACME-9', PR_NUMBER: '3', JIRA_BASE_URL: 'https://acme.atlassian.net/browse/' },
  });

  const { body } = github.callsTo('rest.issues.createComment')[0].params;
  assert.match(body, /\(https:\/\/acme\.atlassian\.net\/browse\/ACME-9\)/);
  assert.doesNotMatch(body, /browse\/\/ACME-9/, 'trailing slash is normalized away');
});

test('add-jira-link: multiple tickets render a bulleted, pluralized list', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub();

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'PROJ-1,PROJ-2', PR_NUMBER: '7', JIRA_BASE_URL },
  });

  const { body } = github.callsTo('rest.issues.createComment')[0].params;
  assert.match(body, /### 🎫 Jira Tickets\n/); // plural header
  assert.match(body, /- \[PROJ-1\]/);
  assert.match(body, /- \[PROJ-2\]/);
});

test('add-jira-link: updates the existing bot comment instead of duplicating', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub({
    'rest.issues.listComments': {
      data: [
        { id: 5, user: { type: 'User' }, body: 'unrelated human comment' },
        { id: 99, user: { type: 'Bot' }, body: '### 🎫 Jira Ticket\n\nold' },
      ],
    },
  });

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'PROJ-9', PR_NUMBER: '7', JIRA_BASE_URL },
  });

  assert.equal(github.callsTo('rest.issues.createComment').length, 0, 'should not create');
  const updated = github.callsTo('rest.issues.updateComment');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].params.comment_id, 99, 'updates the existing bot comment');
});

test('add-jira-link: tolerates a ghost-author comment (user: null)', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub({
    'rest.issues.listComments': {
      data: [
        { id: 1, user: null, body: 'comment from a deleted account' },
        { id: 99, user: { type: 'Bot' }, body: '### 🎫 Jira Ticket\n\nold' },
      ],
    },
  });

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'PROJ-9', PR_NUMBER: '7', JIRA_BASE_URL },
  });

  // Must not crash on the null author, and still find/update the bot comment.
  const updated = github.callsTo('rest.issues.updateComment');
  assert.equal(updated.length, 1, 'still updates the existing bot comment');
  assert.equal(updated[0].params.comment_id, 99);
  assert.equal(github.callsTo('rest.issues.createComment').length, 0);
});

test('add-jira-link: tolerates a comment with a null body', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub({
    'rest.issues.listComments': {
      data: [{ id: 1, user: { type: 'Bot' }, body: null }],
    },
  });

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'PROJ-9', PR_NUMBER: '7', JIRA_BASE_URL },
  });

  // No existing Jira comment matched -> creates one, without crashing.
  assert.equal(github.callsTo('rest.issues.createComment').length, 1);
  assert.equal(github.callsTo('rest.issues.updateComment').length, 0);
});

test('add-jira-link: paginates so a comment on a later page is still found', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  // paginate() in the fake unwraps `.data`; return a long list whose bot
  // comment would sit past the first API page in production.
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    user: { type: 'User' },
    body: `chatter ${i}`,
  }));
  many.push({ id: 999, user: { type: 'Bot' }, body: '### 🎫 Jira Ticket\n\nold' });
  const github = makeGithub({ 'rest.issues.listComments': { data: many } });

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'PROJ-9', PR_NUMBER: '7', JIRA_BASE_URL },
  });

  const updated = github.callsTo('rest.issues.updateComment');
  assert.equal(updated.length, 1, 'finds the bot comment across pages and updates it');
  assert.equal(updated[0].params.comment_id, 999);
  assert.equal(github.callsTo('rest.issues.createComment').length, 0);
});

// --------------------------------------------------------------------------
// mark-pr-reviewed.yaml — "Add 00 - Reviewed label"
// --------------------------------------------------------------------------
test('mark-pr-reviewed: adds the "00 - Reviewed" label to the PR', async () => {
  const script = githubScript(loadWorkflow('mark-pr-reviewed'), { name: 'Reviewed' });
  const github = makeGithub();

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { PR_NUMBER: '314' },
  });

  const labels = github.callsTo('rest.issues.addLabels');
  assert.equal(labels.length, 1);
  assert.equal(labels[0].params.issue_number, 314);
  assert.deepEqual(labels[0].params.labels, ['00 - Reviewed']);
});

test('mark-pr-reviewed: fails cleanly on an empty pr_number instead of a syntax error', async () => {
  const script = githubScript(loadWorkflow('mark-pr-reviewed'), { name: 'Reviewed' });
  const github = makeGithub();

  // An empty value (e.g. a caller expression that resolved to nothing) must
  // produce a clear core.setFailed, not crash the script body.
  await assert.rejects(
    runGithubScript(script, { github, context: ctx, env: { PR_NUMBER: '' } }),
    /core\.setFailed: Invalid pr_number/,
  );
  assert.equal(github.callsTo('rest.issues.addLabels').length, 0, 'must not attempt to label');
});

test('mark-pr-reviewed: does not inline caller input into the script body (no injection)', async () => {
  const script = githubScript(loadWorkflow('mark-pr-reviewed'), { name: 'Reviewed' });
  const github = makeGithub();

  // Were pr_number inlined into the source, this would break out and run
  // arbitrary API calls. Read via process.env, it is inert data -> setFailed.
  const evil = "1 }); await github.rest.issues.deleteLabel({ owner: 'x', repo: 'y', name: 'pwned' }); ({ issue_number: 1";
  await assert.rejects(
    runGithubScript(script, { github, context: ctx, env: { PR_NUMBER: evil } }),
    /core\.setFailed: Invalid pr_number/,
  );
  assert.equal(github.callsTo('rest.issues.deleteLabel').length, 0, 'no injected call ran');
  assert.equal(github.callsTo('rest.issues.addLabels').length, 0);
});

test('mark-pr-reviewed: a 404 from addLabels surfaces as a red check', async () => {
  const script = githubScript(loadWorkflow('mark-pr-reviewed'), { name: 'Reviewed' });
  const notFound = Object.assign(new Error('Not Found'), { status: 404 });
  const github = makeGithub({ 'rest.issues.addLabels': notFound });

  // By design the label is guaranteed to exist; a real failure (bad PR number,
  // perms) should throw and fail the job rather than be swallowed.
  await assert.rejects(
    runGithubScript(script, { github, context: ctx, env: { PR_NUMBER: '314' } }),
    /Not Found/,
  );
});

// --------------------------------------------------------------------------
// ensure-labels.yaml — "Ensure labels exist ..."
// --------------------------------------------------------------------------
function ensureLabelsScript() {
  return githubScript(loadWorkflow('ensure-labels'), { name: 'Ensure labels exist' });
}

// The canonical labels exactly as the workflow declares them (used to build
// "already up to date" fixtures so create/update calls stay quiet).
const READY = {
  name: '00 - Ready for Review',
  color: '1ac387',
  description: 'PR is ready for team review — triggers the Slack notification & digest.',
};
const REVIEWED = {
  name: '00 - Reviewed',
  color: 'd07dd3',
  description: 'PR has been approved — excludes it from the ready-for-review digest.',
};
// The two fixed backport labels, always ensured alongside the review labels.
const FAILED = {
  name: 'backport-failed',
  color: 'f4931d',
  description: 'A backport cherry-pick hit a conflict and needs manual resolution.',
};
const DO_NOT_MERGE = {
  name: 'do not merge',
  color: 'ff0000',
  description: 'Do not merge yet (e.g. CI has not run on a backport PR).',
};
// Dependabot silently drops a `labels:` entry naming a label the repo does not
// have, so these two exist to make an automerge policy keyed on `automerge`
// actually reachable.
const AUTOMERGE = {
  name: 'automerge',
  color: '0e8a16',
  description: 'Opts a bot-authored PR into unattended approve-and-merge once every expected check is green.',
};
const DEPENDENCIES = {
  name: 'dependencies',
  color: '0366d6',
  description: 'Dependency update, usually opened by Dependabot.',
};

// Every always-ensured label. Fixtures build from this rather than listing the
// set by hand, so adding a canonical label does not break every test below.
const ALL_FIXED = [READY, REVIEWED, FAILED, DO_NOT_MERGE, AUTOMERGE, DEPENDENCIES];
const ALL_FIXED_NAMES = ALL_FIXED.map((l) => l.name).sort();

test('ensure-labels: creates every fixed canonical label when none exist', async () => {
  const github = makeGithub({ 'rest.issues.listLabelsForRepo': { data: [] } });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, env: { DELETE_CONFUSABLE: 'false' },
  });

  const created = github.callsTo('rest.issues.createLabel').map((c) => c.params.name).sort();
  assert.deepEqual(created, ALL_FIXED_NAMES);
  assert.equal(github.callsTo('rest.issues.updateLabel').length, 0);
  assert.equal(github.callsTo('rest.issues.deleteLabel').length, 0);
});

test('ensure-labels: updates a drifted label and leaves up-to-date ones alone', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [...ALL_FIXED.filter((l) => l !== READY), { ...READY, color: 'ffffff', description: 'stale' }],
    },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, env: { DELETE_CONFUSABLE: 'false' },
  });

  assert.equal(github.callsTo('rest.issues.createLabel').length, 0, 'all already exist');
  const updated = github.callsTo('rest.issues.updateLabel');
  assert.equal(updated.length, 1, 'only the drifted label is updated');
  assert.equal(updated[0].params.name, '00 - Ready for Review');
  assert.equal(updated[0].params.color, '1ac387');
});

test('ensure-labels: a differently-cased existing label is renamed, not re-created', async () => {
  // GitHub label uniqueness is case-insensitive. A pre-existing "Do not merge"
  // must be matched (and renamed to canonical case) rather than re-created —
  // otherwise createLabel hits a 422 already_exists collision.
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [...ALL_FIXED.filter((l) => l !== DO_NOT_MERGE), { ...DO_NOT_MERGE, name: 'Do not merge' }],
    },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, env: { DELETE_CONFUSABLE: 'false' },
  });

  assert.equal(github.callsTo('rest.issues.createLabel').length, 0, 'no collision-inducing create');
  const updated = github.callsTo('rest.issues.updateLabel');
  assert.equal(updated.length, 1, 'only the mis-cased label is touched');
  assert.equal(updated[0].params.name, 'Do not merge', 'targets the existing casing');
  assert.equal(updated[0].params.new_name, 'do not merge', 'renamed to canonical casing');
});

test('ensure-labels: backport_branches creates backport + backported label pairs', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: ALL_FIXED },
  });
  await runGithubScript(ensureLabelsScript(), {
    github,
    context: ctx,
    env: { BACKPORT_BRANCHES: 'release/11.1, release/11.2', DELETE_CONFUSABLE: 'false' },
  });

  // Fixed labels already exist -> only the four per-branch labels are created.
  const created = github.callsTo('rest.issues.createLabel').map((c) => c.params.name).sort();
  assert.deepEqual(created, [
    'backport release/11.1',
    'backport release/11.2',
    'backported release/11.1',
    'backported release/11.2',
  ]);
});

test('ensure-labels: delete_confusable never deletes managed backport labels', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [
        ...ALL_FIXED,
        { name: 'backport release/11.1', color: '301b8e', description: 'Backport this PR to release/11.1.' },
      ],
    },
    'rest.issues.listForRepo': { data: [] },
  });
  await runGithubScript(ensureLabelsScript(), {
    github,
    context: ctx,
    env: { BACKPORT_BRANCHES: 'release/11.1', DELETE_CONFUSABLE: 'true' },
  });

  assert.equal(github.callsTo('rest.issues.deleteLabel').length, 0, 'backport labels survive cleanup');
});

test('ensure-labels: with delete_confusable=false, confusable variants are left untouched', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: [READY, REVIEWED, { name: 'Ready for Review', color: 'ccc', description: '' }] },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, env: { DELETE_CONFUSABLE: 'false' },
  });

  assert.equal(github.callsTo('rest.issues.deleteLabel').length, 0);
  assert.equal(github.callsTo('rest.issues.addLabels').length, 0);
});

test('ensure-labels: delete_confusable migrates open PRs then deletes the wrong labels', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [
        READY,
        REVIEWED,
        { name: 'Ready for Review', color: 'ccc', description: '' },       // confusable -> delete
        { name: 'reviewed', color: 'ddd', description: '' },               // confusable -> delete
        { name: 'backport release/12.0', color: 'eee', description: '' },  // protected -> keep
        { name: 'do not merge', color: 'fff', description: '' },           // protected -> keep
        { name: 'bug', color: '111', description: '' },                    // unrelated -> keep
      ],
    },
    'rest.issues.listForRepo': { data: [{ number: 12 }, { number: 34 }] },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, env: { DELETE_CONFUSABLE: 'true' },
  });

  // Only the two confusable variants are deleted; protected/unrelated survive.
  const deleted = github.callsTo('rest.issues.deleteLabel').map((c) => c.params.name).sort();
  assert.deepEqual(deleted, ['Ready for Review', 'reviewed']);

  // Each confusable label's open PRs (#12, #34) get the canonical label first.
  const added = github.callsTo('rest.issues.addLabels');
  assert.equal(added.length, 4, 'two labels × two open PRs');
  const readyMigrations = added.filter((c) => c.params.labels.includes('00 - Ready for Review'));
  const reviewedMigrations = added.filter((c) => c.params.labels.includes('00 - Reviewed'));
  assert.deepEqual(readyMigrations.map((c) => c.params.issue_number).sort(), [12, 34]);
  assert.deepEqual(reviewedMigrations.map((c) => c.params.issue_number).sort(), [12, 34]);
});

test('ensure-labels: a mis-cased canonical review label is renamed but never deleted during cleanup', async () => {
  // Regression: "00 - REVIEWED" is the SAME label as canonical "00 - Reviewed"
  // (GitHub label uniqueness is case-insensitive). Step 2 renames it to
  // canonical case; step 3 must not then treat the stale snapshot entry as a
  // deletable confusable — doing so wipes the label it just repaired.
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [READY, { ...REVIEWED, name: '00 - REVIEWED' }, FAILED, DO_NOT_MERGE],
    },
    'rest.issues.listForRepo': { data: [] },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, env: { DELETE_CONFUSABLE: 'true' },
  });

  const renamed = github.callsTo('rest.issues.updateLabel');
  assert.equal(renamed.length, 1, 'only the mis-cased canonical is renamed');
  assert.equal(renamed[0].params.name, '00 - REVIEWED');
  assert.equal(renamed[0].params.new_name, '00 - Reviewed');

  assert.equal(github.callsTo('rest.issues.deleteLabel').length, 0, 'the repaired canonical is never deleted');
  assert.equal(github.callsTo('rest.issues.addLabels').length, 0, 'no bogus PR migration for a canonical label');
});

test('ensure-labels: mis-cased canonical + case-sensitive delete API does not crash the Action', async () => {
  // GitHub's DELETE-label endpoint can be case-sensitive on lookup, so deleting
  // the stale "00 - REVIEWED" name (already renamed to "00 - Reviewed") would
  // 404 and reject — crashing the step. The cleanup must never issue that call.
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [READY, { ...REVIEWED, name: '00 - REVIEWED' }, FAILED, DO_NOT_MERGE],
    },
    'rest.issues.listForRepo': { data: [] },
    'rest.issues.deleteLabel': ({ name }) =>
      new Error(`404 Not Found: no label named "${name}"`),
  });

  await assert.doesNotReject(
    runGithubScript(ensureLabelsScript(), {
      github, context: ctx, env: { DELETE_CONFUSABLE: 'true' },
    }),
    'the Action must not crash on a case-sensitive delete',
  );
});

test('ensure-labels: duplicate backport branches create each label once (no 422 double-create)', async () => {
  // Regression: the same branch listed twice must not queue the same label
  // twice — the second createLabel would 422 "already_exists" and crash.
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: ALL_FIXED },
    // Model the real API: a duplicate create for an existing name rejects.
    'rest.issues.createLabel': (() => {
      const seen = new Set();
      return ({ name }) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return new Error(`422 already_exists: "${name}"`);
        seen.add(key);
        return { data: {} };
      };
    })(),
  });

  await assert.doesNotReject(
    runGithubScript(ensureLabelsScript(), {
      github,
      context: ctx,
      env: { BACKPORT_BRANCHES: 'release/11.1, release/11.1', DELETE_CONFUSABLE: 'false' },
    }),
    'duplicate input must not cause a double-create',
  );

  const created = github.callsTo('rest.issues.createLabel').map((c) => c.params.name).sort();
  assert.deepEqual(created, ['backport release/11.1', 'backported release/11.1']);
});

test('ensure-labels: branches whose labels collide case-insensitively create each label once', async () => {
  // Two distinct git branches ("release/11.1" vs "Release/11.1") produce labels
  // that GitHub treats as the same (case-insensitive) — must still create once.
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: ALL_FIXED },
    'rest.issues.createLabel': (() => {
      const seen = new Set();
      return ({ name }) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return new Error(`422 already_exists: "${name}"`);
        seen.add(key);
        return { data: {} };
      };
    })(),
  });

  await assert.doesNotReject(
    runGithubScript(ensureLabelsScript(), {
      github,
      context: ctx,
      env: { BACKPORT_BRANCHES: 'release/11.1 Release/11.1', DELETE_CONFUSABLE: 'false' },
    }),
  );

  const created = github.callsTo('rest.issues.createLabel').map((c) => c.params.name.toLowerCase()).sort();
  assert.deepEqual(created, ['backport release/11.1', 'backported release/11.1']);
});

test('ensure-labels: a case-colliding existing label never triggers createLabel (422-safe)', async () => {
  // The case-insensitive keying must route a differently-cased existing label to
  // updateLabel, never createLabel — so an injected 422 on create never fires.
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [...ALL_FIXED.filter((l) => l !== DO_NOT_MERGE), { ...DO_NOT_MERGE, name: 'DO NOT MERGE' }],
    },
    'rest.issues.createLabel': () => new Error('422 already_exists (should never be called)'),
  });

  await assert.doesNotReject(
    runGithubScript(ensureLabelsScript(), {
      github, context: ctx, env: { DELETE_CONFUSABLE: 'false' },
    }),
    'a case-collision must go through updateLabel, not createLabel',
  );
  assert.equal(github.callsTo('rest.issues.createLabel').length, 0);
  assert.equal(github.callsTo('rest.issues.updateLabel').length, 1);
});

test('ensure-labels: dependabot_ecosystems creates one label per ecosystem', async () => {
  const github = makeGithub({ 'rest.issues.listLabelsForRepo': { data: ALL_FIXED } });
  await runGithubScript(ensureLabelsScript(), {
    github,
    context: ctx,
    env: { DEPENDABOT_ECOSYSTEMS: 'github-actions, pip', DELETE_CONFUSABLE: 'false' },
  });

  const created = github.callsTo('rest.issues.createLabel').map((c) => c.params.name).sort();
  assert.deepEqual(created, ['github-actions', 'pip']);
});

// `dependencies` is already canonical, so naming it as an ecosystem must not
// queue it a second time — the duplicate createLabel would 422 already_exists.
test('ensure-labels: an ecosystem that duplicates a canonical label is created once', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: [] },
    'rest.issues.createLabel': (() => {
      const seen = new Set();
      return ({ name }) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return new Error(`422 already_exists: "${name}"`);
        seen.add(key);
        return { data: {} };
      };
    })(),
  });

  await assert.doesNotReject(
    runGithubScript(ensureLabelsScript(), {
      github, context: ctx, env: { DEPENDABOT_ECOSYSTEMS: 'dependencies', DELETE_CONFUSABLE: 'false' },
    }),
  );

  const created = github.callsTo('rest.issues.createLabel').map((c) => c.params.name).sort();
  assert.deepEqual(created, ALL_FIXED_NAMES, 'no extra "dependencies" create');
});

// The automerge label gates unattended merging, so a cleanup pass must never
// take it out from under a repo that is relying on it.
test('ensure-labels: delete_confusable never deletes the automerge label', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: ALL_FIXED },
    'rest.issues.listForRepo': { data: [] },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, env: { DELETE_CONFUSABLE: 'true' },
  });

  assert.equal(github.callsTo('rest.issues.deleteLabel').length, 0);
});

// --------------------------------------------------------------------------
// backport.yaml — "Label & comment with backport result"
// --------------------------------------------------------------------------
function backportScript() {
  return githubScript(loadWorkflow('backport'), { name: 'Label & comment with backport result' });
}

test('backport: all targets succeed -> per-target labels + cherry comment, no failure label', async () => {
  const github = makeGithub();
  await runGithubScript(backportScript(), {
    github,
    context: ctx,
    env: {
      PR_NUMBER: '50',
      BY_TARGET: 'release/12.0=true\nrelease/11.0=true',
      CREATED: '101 102',
      APP_TOKEN_USED: 'true', // App token -> no "do not merge" path
    },
  });

  const addLabels = github.callsTo('rest.issues.addLabels');
  // exactly one addLabels call against the source PR (App token => no per-backport gating)
  assert.equal(addLabels.length, 1);
  assert.deepEqual(addLabels[0].params.labels, ['backported release/12.0', 'backported release/11.0']);
  assert.ok(!addLabels[0].params.labels.includes('backport-failed'));

  const comments = github.callsTo('rest.issues.createComment');
  assert.equal(comments.length, 1);
  assert.match(comments[0].params.body, /🍒 \*\*Backported\*\*/);
  assert.match(comments[0].params.body, /#101, #102/);
});

test('backport: branch names containing "=" parse via lastIndexOf', async () => {
  const github = makeGithub();
  await runGithubScript(backportScript(), {
    github,
    context: ctx,
    env: {
      PR_NUMBER: '60',
      BY_TARGET: 'feature/a=b=true', // branch literally contains '='
      CREATED: '',
      APP_TOKEN_USED: 'true',
    },
  });
  const addLabels = github.callsTo('rest.issues.addLabels');
  assert.deepEqual(addLabels[0].params.labels, ['backported feature/a=b']);
});

test('backport: a failed target adds backport-failed and conflict instructions', async () => {
  const github = makeGithub();
  await runGithubScript(backportScript(), {
    github,
    context: ctx,
    env: {
      PR_NUMBER: '70',
      BY_TARGET: 'release/12.0=true\nrelease/9.0=false',
      CREATED: '201',
      APP_TOKEN_USED: 'true',
    },
  });

  const labels = github.callsTo('rest.issues.addLabels')[0].params.labels;
  assert.ok(labels.includes('backported release/12.0'));
  assert.ok(labels.includes('backport-failed'));

  const body = github.callsTo('rest.issues.createComment')[0].params.body;
  assert.match(body, /⚠️ \*\*Backport failed\*\* for: `release\/9\.0`/);
  assert.match(body, /git cherry-pick/);
});

test('backport: without App token, created PRs get "do not merge" + a CI-kick comment', async () => {
  const github = makeGithub({
    'rest.pulls.get': ({ pull_number }) => ({ data: { head: { ref: `backport/pr-${pull_number}` } } }),
  });
  await runGithubScript(backportScript(), {
    github,
    context: ctx,
    env: {
      PR_NUMBER: '80',
      BY_TARGET: 'release/12.0=true',
      CREATED: '301 302',
      APP_TOKEN_USED: 'false', // GITHUB_TOKEN fallback
    },
  });

  // Source PR labelled once; then each created PR labelled "do not merge".
  const labelCalls = github.callsTo('rest.issues.addLabels');
  const doNotMerge = labelCalls.filter((c) => (c.params.labels || []).includes('do not merge'));
  assert.equal(doNotMerge.length, 2, 'both created PRs get do-not-merge');
  assert.deepEqual(doNotMerge.map((c) => c.params.issue_number).sort(), [301, 302]);

  const ciComments = github
    .callsTo('rest.issues.createComment')
    .filter((c) => /Do not merge yet/.test(c.params.body));
  assert.equal(ciComments.length, 2);
  assert.match(ciComments[0].params.body, /git checkout backport\/pr-301/);
});

test('backport: empty result set is a no-op (no labels, no comments)', async () => {
  const github = makeGithub();
  await runGithubScript(backportScript(), {
    github,
    context: ctx,
    env: { PR_NUMBER: '90', BY_TARGET: '', CREATED: '', APP_TOKEN_USED: 'true' },
  });
  assert.equal(github.callsTo('rest.issues.addLabels').length, 0);
  assert.equal(github.callsTo('rest.issues.createComment').length, 0);
});

// --------------------------------------------------------------------------
// automerge.yaml — "Evaluate and act on open PRs"
//
// The interesting assertion in almost every case below is a NEGATIVE one:
// `rest.pulls.merge` was never called. A bug that merges too eagerly is the
// only bug here that cannot be undone, so each refusal reason gets its own
// test rather than being folded into a table-driven sweep.
// --------------------------------------------------------------------------
const automergeScript = () =>
  githubScript(loadWorkflow('automerge'), { name: 'Evaluate and act on open PRs' });

const BOT = 'dr-auto-merge[bot]';

// The policy the workflow's bash step would have produced from
// `.github/automerge.yaml`. `settle_seconds: 0` by default so that only the
// test that is about settling has to think about clocks.
const policy = (over = {}) =>
  JSON.stringify({
    allowed_authors: ['dependabot[bot]'],
    label: 'automerge',
    expected_checks: ['Unit CI'],
    allowed_paths: [],
    block_on_any_failure: true,
    settle_seconds: 0,
    max_changed_files: 0,
    merge_method: 'squash',
    ...over,
  });

const aPr = (over = {}) => ({
  number: 7,
  draft: false,
  user: { login: 'dependabot[bot]' },
  labels: [{ name: 'automerge' }],
  base: { ref: 'main' },
  head: { sha: 'deadbee' },
  ...over,
});

// Shaped like a REAL Dependabot commit, verified against
// af-component-evaluation PR #64: GitHub creates the commit through the API, so
// the author is the bot but the committer is `web-flow`, GitHub's own signing
// identity, with a valid signature.
const botCommit = (sha = 'c0ffee1', over = {}) => ({
  sha,
  author: { login: 'dependabot[bot]' },
  committer: { login: 'web-flow' },
  commit: { verification: { verified: true, reason: 'valid' } },
  ...over,
});

// Old enough that a zero settle window is satisfied without faking the clock.
const aCheck = (name, conclusion = 'success', over = {}) => ({
  id: 1,
  name,
  status: 'completed',
  conclusion,
  completed_at: '2020-01-01T00:00:00Z',
  ...over,
});

const RULES_ROUTE = 'request:GET /repos/{owner}/{repo}/rules/branches/{branch}';

/** A repo whose every gate passes, which each test then breaks in one place. */
const happyPath = (over = {}) =>
  makeGithub({
    'rest.pulls.list': { data: [aPr()] },
    'rest.pulls.listCommits': { data: [botCommit()] },
    'rest.checks.listForRef': { data: [aCheck('Unit CI')] },
    'rest.pulls.get': { data: { mergeable: true, mergeable_state: 'clean', changed_files: 1 } },
    [RULES_ROUTE]: { data: [] },
    ...over,
  });

const runAutomerge = (github, { mode = 'merge', config = {} } = {}) =>
  runGithubScript(automergeScript(), {
    github,
    context: ctx,
    env: { MODE: mode, APP_SLUG: 'dr-auto-merge', AUTOMERGE_CONFIG: policy(config) },
  });

const mergeCalls = (github) => github.callsTo('rest.pulls.merge');
const approveCalls = (github) => github.callsTo('rest.pulls.createReview');
const commentBodies = (github) => [
  ...github.callsTo('rest.issues.createComment').map((c) => c.params.body),
  ...github.callsTo('rest.issues.updateComment').map((c) => c.params.body),
];

// --- the happy path, once, so every negative test below has a baseline ------
test('automerge: an eligible PR that this bot already approved is merged, pinned to the head sha', async () => {
  const github = happyPath({
    'rest.pulls.listReviews': { data: [{ state: 'APPROVED', user: { login: BOT } }] },
  });

  await runAutomerge(github);

  const merged = mergeCalls(github);
  assert.equal(merged.length, 1, 'should merge');
  assert.equal(merged[0].params.pull_number, 7);
  assert.equal(merged[0].params.merge_method, 'squash');
  // Without the sha pin, a push landing between evaluation and merge would be
  // merged unexamined.
  assert.equal(merged[0].params.sha, 'deadbee', 'merge must be pinned to the evaluated head');
});

// --- not a candidate: silent, no PR noise ----------------------------------
test('automerge: a PR without the opt-in label is ignored entirely', async () => {
  const github = happyPath({ 'rest.pulls.list': { data: [aPr({ labels: [] })] } });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.equal(approveCalls(github).length, 0);
  // Someone's ordinary PR should not collect a bot comment explaining why it
  // was not auto-merged.
  assert.equal(commentBodies(github).length, 0, 'a non-candidate gets no comment');
});

test('automerge: a labelled PR from a human author is ignored entirely', async () => {
  const github = happyPath({
    'rest.pulls.list': { data: [aPr({ user: { login: 'mjnitz02' } })] },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.equal(commentBodies(github).length, 0);
});

// --- THE one that matters --------------------------------------------------
// `pull_request.user.login` stays the bot after a human pushes to the branch,
// so an opener-only check would let hand-written code ride the automerge label.
test('automerge: a human commit on a bot branch blocks the merge', async () => {
  const github = happyPath({
    'rest.pulls.listCommits': {
      data: [
        botCommit('aaaaaaa'),
        { sha: 'bbbbbbb', author: { login: 'mjnitz02' }, committer: { login: 'mjnitz02' } },
      ],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0, 'must not merge a human commit');
  assert.equal(approveCalls(github).length, 0, 'must not approve it either');
  assert.match(commentBodies(github).join('\n'), /bbbbbbb.*not an allow-listed bot/s);
});

// Regression, found on the first live run against af-component-evaluation PR #64.
// Requiring the committer to be an allow-listed bot rejected every genuine
// Dependabot PR, because GitHub commits them as `web-flow`.
test('automerge: a real Dependabot commit (committed by web-flow) is accepted', async () => {
  const github = happyPath({
    'rest.pulls.listCommits': { data: [botCommit('7e1a7f5')] },
    'rest.pulls.listReviews': { data: [{ state: 'APPROVED', user: { login: BOT } }] },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 1, 'web-flow is how every real bot commit looks');
});

// The committer check exists to close author spoofing: GitHub links
// `author.login` by email alone, so a human can claim to be Dependabot. Setting
// committer.email to noreply@github.com resolves the committer to web-flow too,
// so the SIGNATURE is the only thing that actually distinguishes them.
test('automerge: a web-flow committer without a verified signature is refused', async () => {
  const github = happyPath({
    'rest.pulls.listCommits': {
      data: [botCommit('5p00fed', { commit: { verification: { verified: false, reason: 'unsigned' } } })],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0, 'an unsigned web-flow commit is spoofable');
  assert.match(commentBodies(github).join('\n'), /signature is not verified/);
});

test('automerge: a spoofed author is caught even when the signature is valid', async () => {
  const github = happyPath({
    'rest.pulls.listCommits': {
      data: [botCommit('deadbad', { author: { login: 'mjnitz02' } })],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /authored by `mjnitz02`/);
});

test('automerge: a commit with no linked GitHub account blocks the merge', async () => {
  const github = happyPath({
    'rest.pulls.listCommits': { data: [{ sha: 'ccccccc', author: null, committer: null }] },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /unknown/);
});

// --- checks ----------------------------------------------------------------
// The case "all checks are green" gets wrong: nothing ran, so nothing is red.
test('automerge: an expected check that never reported blocks the merge', async () => {
  const github = happyPath({ 'rest.checks.listForRef': { data: [] } });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0, 'absent is not the same as passing');
  assert.match(commentBodies(github).join('\n'), /expected check `Unit CI` has not reported/);
});

test('automerge: a check required by the ruleset but absent from expected_checks still blocks', async () => {
  const github = happyPath({
    [RULES_ROUTE]: {
      data: [
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'gate / cve-sync gate' }] },
        },
      ],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /`gate \/ cve-sync gate` has not reported/);
});

test('automerge: a check still running blocks the merge', async () => {
  const github = happyPath({
    'rest.checks.listForRef': {
      data: [aCheck('Unit CI', null, { status: 'in_progress', completed_at: null })],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /still running/);
});

test('automerge: a failing check outside the expected list still blocks the merge', async () => {
  const github = happyPath({
    'rest.checks.listForRef': {
      data: [aCheck('Unit CI'), aCheck('Lint', 'failure', { id: 2 })],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0, 'block_on_any_failure covers unrequired checks');
  assert.match(commentBodies(github).join('\n'), /`Lint` is failing/);
});

// A path-filtered suite behind an always-reporting gate job reports `skipped`.
// Treating that as a failure would jam every PR in a repo using the pattern.
test('automerge: skipped and neutral conclusions count as a pass', async () => {
  const github = happyPath({
    'rest.checks.listForRef': {
      data: [
        aCheck('Unit CI', 'skipped'),
        aCheck('Docker Build CI', 'neutral', { id: 2 }),
      ],
    },
    'rest.pulls.listReviews': { data: [{ state: 'APPROVED', user: { login: BOT } }] },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 1, 'a skipped gate job must not block');
});

test('automerge: an unrecognised check conclusion is treated as a failure, not waved through', async () => {
  const github = happyPath({
    'rest.checks.listForRef': { data: [aCheck('Unit CI', 'something_new')] },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0, 'unknown conclusions must fail closed');
});

// --- verifying nothing -----------------------------------------------------
test('automerge: refuses when neither the rulesets nor expected_checks name any check', async () => {
  const github = happyPath({ [RULES_ROUTE]: { data: [] } });

  await runAutomerge(github, { config: { expected_checks: [] } });

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /verified nothing/);
});

// --- reviews and mergeability ----------------------------------------------
test('automerge: an outstanding CHANGES_REQUESTED review blocks the merge', async () => {
  const github = happyPath({
    'rest.pulls.listReviews': {
      data: [
        { state: 'APPROVED', user: { login: BOT } },
        { state: 'CHANGES_REQUESTED', user: { login: 'mjnitz02' } },
      ],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /`mjnitz02` has requested changes/);
});

test('automerge: a later COMMENTED review does not clear an earlier CHANGES_REQUESTED', async () => {
  const github = happyPath({
    'rest.pulls.listReviews': {
      data: [
        { state: 'CHANGES_REQUESTED', user: { login: 'mjnitz02' } },
        { state: 'COMMENTED', user: { login: 'mjnitz02' } },
      ],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0, 'a drive-by comment must not count as resolution');
});

test('automerge: a conflicted PR blocks the merge', async () => {
  const github = happyPath({
    'rest.pulls.get': { data: { mergeable: false, mergeable_state: 'dirty', changed_files: 1 } },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /conflicts/);
});

test('automerge: an uncomputed mergeable flag waits rather than merging', async () => {
  const github = happyPath({
    'rest.pulls.get': { data: { mergeable: null, changed_files: 1 } },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0, 'null must not be read as mergeable');
});

test('automerge: a branch behind base blocks when the ruleset is strict', async () => {
  const github = happyPath({
    'rest.pulls.get': { data: { mergeable: true, mergeable_state: 'behind', changed_files: 1 } },
    [RULES_ROUTE]: {
      data: [
        {
          type: 'required_status_checks',
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [{ context: 'Unit CI' }],
          },
        },
      ],
    },
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /behind base/);
});

// --- scope limits ----------------------------------------------------------
test('automerge: a file outside allowed_paths blocks the merge', async () => {
  const github = happyPath({
    'rest.pulls.listFiles': { data: [{ filename: 'src/app/main.py' }] },
  });

  await runAutomerge(github, { config: { allowed_paths: ['uv.lock', '.github/workflows/**'] } });

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /`src\/app\/main\.py` is outside the allowed paths/);
});

test('automerge: allowed_paths globs match lockfiles and nested workflow files', async () => {
  const github = happyPath({
    'rest.pulls.listFiles': {
      data: [{ filename: 'uv.lock' }, { filename: '.github/workflows/ci.yaml' }],
    },
    'rest.pulls.listReviews': { data: [{ state: 'APPROVED', user: { login: BOT } }] },
  });

  await runAutomerge(github, { config: { allowed_paths: ['uv.lock', '.github/workflows/**'] } });

  assert.equal(mergeCalls(github).length, 1);
});

// A dot in a glob must match a literal dot, or `uv.lock` would also accept
// `uvxlock` and, worse, `.github/workflows/**` would match far too much.
test('automerge: a dot in an allowed_paths glob is literal, not a wildcard', async () => {
  const github = happyPath({ 'rest.pulls.listFiles': { data: [{ filename: 'uvxlock' }] } });

  await runAutomerge(github, { config: { allowed_paths: ['uv.lock'] } });

  assert.equal(mergeCalls(github).length, 0);
});

test('automerge: a PR over max_changed_files blocks the merge', async () => {
  const github = happyPath({
    'rest.pulls.get': { data: { mergeable: true, mergeable_state: 'clean', changed_files: 40 } },
  });

  await runAutomerge(github, { config: { max_changed_files: 25 } });

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /touches 40 files/);
});

test('automerge: a draft PR blocks the merge', async () => {
  const github = happyPath({ 'rest.pulls.list': { data: [aPr({ draft: true })] } });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /draft/);
});

// --- settling --------------------------------------------------------------
test('automerge: a check that just finished is left to settle', async () => {
  const github = happyPath({
    'rest.checks.listForRef': {
      data: [aCheck('Unit CI', 'success', { completed_at: new Date().toISOString() })],
    },
  });

  await runAutomerge(github, { config: { settle_seconds: 300 } });

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /settling, \d+s remaining/);
});

// --- modes -----------------------------------------------------------------
test('automerge: report mode approves and merges nothing', async () => {
  const github = happyPath({
    'rest.pulls.listReviews': { data: [{ state: 'APPROVED', user: { login: BOT } }] },
  });

  await runAutomerge(github, { mode: 'report' });

  assert.equal(mergeCalls(github).length, 0);
  assert.equal(approveCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /`report` mode/);
});

test('automerge: approve mode approves but never merges, even once self-approved', async () => {
  const github = happyPath({
    'rest.pulls.listReviews': { data: [{ state: 'APPROVED', user: { login: BOT } }] },
  });

  await runAutomerge(github, { mode: 'approve' });

  assert.equal(mergeCalls(github).length, 0);
  assert.match(commentBodies(github).join('\n'), /`approve` mode/);
});

// The approval and the merge are deliberately split across two polls, so there
// is a window in which a human can still intervene.
test('automerge: merge mode approves on the first pass and does not also merge', async () => {
  const github = happyPath({ 'rest.pulls.listReviews': { data: [] } });

  await runAutomerge(github, { mode: 'merge' });

  assert.equal(approveCalls(github).length, 1, 'should approve');
  assert.equal(approveCalls(github)[0].params.event, 'APPROVE');
  assert.equal(mergeCalls(github).length, 0, 'merging in the same tick would leave no window');
});

test('automerge: an approval from someone else does not stand in for this bot\'s own', async () => {
  const github = happyPath({
    'rest.pulls.listReviews': { data: [{ state: 'APPROVED', user: { login: 'mjnitz02' } }] },
  });

  await runAutomerge(github, { mode: 'merge' });

  assert.equal(approveCalls(github).length, 1, 'the bot still records its own verdict');
  assert.equal(mergeCalls(github).length, 0);
});

// --- failure handling ------------------------------------------------------
// A refused merge is the ruleset doing its job. It must not take the run down
// and skip every remaining PR.
test('automerge: a merge refused by GitHub is reported and does not abort the run', async () => {
  const github = happyPath({
    'rest.pulls.list': { data: [aPr(), aPr({ number: 8 })] },
    'rest.pulls.listReviews': { data: [{ state: 'APPROVED', user: { login: BOT } }] },
    'rest.pulls.merge': new Error('At least 1 approving review is required'),
  });

  await runAutomerge(github);

  assert.equal(mergeCalls(github).length, 2, 'the second PR is still attempted');
  assert.match(commentBodies(github).join('\n'), /refused by GitHub: At least 1 approving review/);
});

// --- comment hygiene -------------------------------------------------------
// A ten-minute poller that posted a fresh comment each tick would bury the PR
// within a day.
test('automerge: an existing verdict comment is updated, not duplicated', async () => {
  const github = happyPath({
    'rest.issues.listComments': {
      data: [{ id: 99, user: { login: BOT }, body: '<!-- dr-auto-merge:verdict -->\nold news' }],
    },
    'rest.checks.listForRef': { data: [] },
  });

  await runAutomerge(github);

  assert.equal(github.callsTo('rest.issues.createComment').length, 0);
  const updated = github.callsTo('rest.issues.updateComment');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].params.comment_id, 99);
});

test('automerge: a comment from another bot is not mistaken for this bot\'s verdict', async () => {
  const github = happyPath({
    'rest.issues.listComments': {
      data: [{ id: 99, user: { login: 'other[bot]' }, body: '<!-- dr-auto-merge:verdict -->\nspoof' }],
    },
    'rest.checks.listForRef': { data: [] },
  });

  await runAutomerge(github);

  assert.equal(github.callsTo('rest.issues.createComment').length, 1, 'should post its own');
  assert.equal(github.callsTo('rest.issues.updateComment').length, 0);
});

// --- misconfiguration fails loudly -----------------------------------------
test('automerge: an unknown mode fails the run rather than defaulting to something', async () => {
  await assert.rejects(
    () => runAutomerge(happyPath(), { mode: 'yolo' }),
    /core\.setFailed: Invalid mode/,
  );
});

test('automerge: an empty author allow-list fails the run', async () => {
  await assert.rejects(
    () => runAutomerge(happyPath(), { config: { allowed_authors: [] } }),
    /core\.setFailed: allowed_authors is empty/,
  );
});

test('automerge: a non-numeric settle_seconds fails the run rather than becoming NaN', async () => {
  await assert.rejects(
    () => runAutomerge(happyPath(), { config: { settle_seconds: '5 minutes' } }),
    /core\.setFailed: Invalid settle_seconds/,
  );
});

test('automerge: a merge_method the ruleset could never accept fails the run', async () => {
  await assert.rejects(
    () => runAutomerge(happyPath(), { config: { merge_method: 'fast-forward' } }),
    /core\.setFailed: Invalid merge_method/,
  );
});
