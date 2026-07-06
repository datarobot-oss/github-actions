// Tests for the `actions/github-script` (JS) blocks embedded in the reusable
// workflows. The bodies are pulled straight out of the YAML, so these can't
// drift from what ships. The GitHub API is faked; we assert on the calls made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow, githubScript } from './helpers/workflow.mjs';
import { makeGithub, runGithubScript } from './helpers/github-script.mjs';

const ctx = { repo: { owner: 'datarobot-oss', repo: 'demo' } };

// --------------------------------------------------------------------------
// add-jira-link.yaml — "Comment with Jira link"
// --------------------------------------------------------------------------
test('add-jira-link: single ticket creates a singular comment', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub({ 'rest.issues.listComments': { data: [] } });

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'BUZZOK-123', PR_NUMBER: '42' },
  });

  const created = github.callsTo('rest.issues.createComment');
  assert.equal(created.length, 1, 'should create a comment');
  assert.equal(github.callsTo('rest.issues.updateComment').length, 0);
  const { body, issue_number } = created[0].params;
  assert.equal(issue_number, 42);
  assert.match(body, /### 🎫 Jira Ticket\n/); // singular header
  assert.match(body, /\[BUZZOK-123\]\(https:\/\/datarobot\.atlassian\.net\/browse\/BUZZOK-123\)/);
  assert.doesNotMatch(body, /^- /m, 'single ticket should not be a bullet list');
});

test('add-jira-link: multiple tickets render a bulleted, pluralized list', async () => {
  const script = githubScript(loadWorkflow('add-jira-link'), { name: 'Comment with Jira link' });
  const github = makeGithub();

  await runGithubScript(script, {
    github,
    context: ctx,
    env: { TICKET_IDS: 'BUZZOK-1,BUZZOK-2', PR_NUMBER: '7' },
  });

  const { body } = github.callsTo('rest.issues.createComment')[0].params;
  assert.match(body, /### 🎫 Jira Tickets\n/); // plural header
  assert.match(body, /- \[BUZZOK-1\]/);
  assert.match(body, /- \[BUZZOK-2\]/);
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
    env: { TICKET_IDS: 'BUZZOK-9', PR_NUMBER: '7' },
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
    env: { TICKET_IDS: 'BUZZOK-9', PR_NUMBER: '7' },
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
    env: { TICKET_IDS: 'BUZZOK-9', PR_NUMBER: '7' },
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
    env: { TICKET_IDS: 'BUZZOK-9', PR_NUMBER: '7' },
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
    templateVars: { 'inputs.pr_number': 314 },
  });

  const labels = github.callsTo('rest.issues.addLabels');
  assert.equal(labels.length, 1);
  assert.equal(labels[0].params.issue_number, 314);
  assert.deepEqual(labels[0].params.labels, ['00 - Reviewed']);
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
  color: '0e8a16',
  description: 'PR is ready for team review — triggers the Slack notification & digest.',
};
const REVIEWED = {
  name: '00 - Reviewed',
  color: '5319e7',
  description: 'PR has been approved — excludes it from the ready-for-review digest.',
};
// The two fixed backport labels, always ensured alongside the review labels.
const FAILED = {
  name: 'backport-failed',
  color: 'd93f0b',
  description: 'A backport cherry-pick hit a conflict and needs manual resolution.',
};
const DO_NOT_MERGE = {
  name: 'do not merge',
  color: 'b60205',
  description: 'Do not merge yet (e.g. CI has not run on a backport PR).',
};

test('ensure-labels: creates all four fixed canonical labels when none exist', async () => {
  const github = makeGithub({ 'rest.issues.listLabelsForRepo': { data: [] } });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, templateVars: { 'inputs.delete_confusable': false },
  });

  const created = github.callsTo('rest.issues.createLabel').map((c) => c.params.name).sort();
  assert.deepEqual(created, ['00 - Ready for Review', '00 - Reviewed', 'backport-failed', 'do not merge']);
  assert.equal(github.callsTo('rest.issues.updateLabel').length, 0);
  assert.equal(github.callsTo('rest.issues.deleteLabel').length, 0);
});

test('ensure-labels: updates a drifted label and leaves up-to-date ones alone', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [REVIEWED, FAILED, DO_NOT_MERGE, { ...READY, color: 'ffffff', description: 'stale' }],
    },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, templateVars: { 'inputs.delete_confusable': false },
  });

  assert.equal(github.callsTo('rest.issues.createLabel').length, 0, 'all already exist');
  const updated = github.callsTo('rest.issues.updateLabel');
  assert.equal(updated.length, 1, 'only the drifted label is updated');
  assert.equal(updated[0].params.name, '00 - Ready for Review');
  assert.equal(updated[0].params.color, '0e8a16');
});

test('ensure-labels: a differently-cased existing label is renamed, not re-created', async () => {
  // GitHub label uniqueness is case-insensitive. A pre-existing "Do not merge"
  // must be matched (and renamed to canonical case) rather than re-created —
  // otherwise createLabel hits a 422 already_exists collision.
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': {
      data: [READY, REVIEWED, FAILED, { ...DO_NOT_MERGE, name: 'Do not merge' }],
    },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, templateVars: { 'inputs.delete_confusable': false },
  });

  assert.equal(github.callsTo('rest.issues.createLabel').length, 0, 'no collision-inducing create');
  const updated = github.callsTo('rest.issues.updateLabel');
  assert.equal(updated.length, 1, 'only the mis-cased label is touched');
  assert.equal(updated[0].params.name, 'Do not merge', 'targets the existing casing');
  assert.equal(updated[0].params.new_name, 'do not merge', 'renamed to canonical casing');
});

test('ensure-labels: backport_branches creates backport + backported label pairs', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: [READY, REVIEWED, FAILED, DO_NOT_MERGE] },
  });
  await runGithubScript(ensureLabelsScript(), {
    github,
    context: ctx,
    env: { BACKPORT_BRANCHES: 'release/11.1, release/11.2' },
    templateVars: { 'inputs.delete_confusable': false },
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
        READY, REVIEWED, FAILED, DO_NOT_MERGE,
        { name: 'backport release/11.1', color: '1d76db', description: 'Backport this PR to release/11.1.' },
      ],
    },
    'rest.issues.listForRepo': { data: [] },
  });
  await runGithubScript(ensureLabelsScript(), {
    github,
    context: ctx,
    env: { BACKPORT_BRANCHES: 'release/11.1' },
    templateVars: { 'inputs.delete_confusable': true },
  });

  assert.equal(github.callsTo('rest.issues.deleteLabel').length, 0, 'backport labels survive cleanup');
});

test('ensure-labels: with delete_confusable=false, confusable variants are left untouched', async () => {
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: [READY, REVIEWED, { name: 'Ready for Review', color: 'ccc', description: '' }] },
  });
  await runGithubScript(ensureLabelsScript(), {
    github, context: ctx, templateVars: { 'inputs.delete_confusable': false },
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
    github, context: ctx, templateVars: { 'inputs.delete_confusable': true },
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
    github, context: ctx, templateVars: { 'inputs.delete_confusable': true },
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
      github, context: ctx, templateVars: { 'inputs.delete_confusable': true },
    }),
    'the Action must not crash on a case-sensitive delete',
  );
});

test('ensure-labels: duplicate backport branches create each label once (no 422 double-create)', async () => {
  // Regression: the same branch listed twice must not queue the same label
  // twice — the second createLabel would 422 "already_exists" and crash.
  const github = makeGithub({
    'rest.issues.listLabelsForRepo': { data: [READY, REVIEWED, FAILED, DO_NOT_MERGE] },
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
      env: { BACKPORT_BRANCHES: 'release/11.1, release/11.1' },
      templateVars: { 'inputs.delete_confusable': false },
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
    'rest.issues.listLabelsForRepo': { data: [READY, REVIEWED, FAILED, DO_NOT_MERGE] },
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
      env: { BACKPORT_BRANCHES: 'release/11.1 Release/11.1' },
      templateVars: { 'inputs.delete_confusable': false },
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
      data: [READY, REVIEWED, FAILED, { ...DO_NOT_MERGE, name: 'DO NOT MERGE' }],
    },
    'rest.issues.createLabel': () => new Error('422 already_exists (should never be called)'),
  });

  await assert.doesNotReject(
    runGithubScript(ensureLabelsScript(), {
      github, context: ctx, templateVars: { 'inputs.delete_confusable': false },
    }),
    'a case-collision must go through updateLabel, not createLabel',
  );
  assert.equal(github.callsTo('rest.issues.createLabel').length, 0);
  assert.equal(github.callsTo('rest.issues.updateLabel').length, 1);
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
