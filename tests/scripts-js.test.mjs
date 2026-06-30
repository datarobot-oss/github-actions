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
