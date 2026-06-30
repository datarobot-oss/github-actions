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

// NOTE: backport.yaml lives on a separate branch and is not part of this repo
// state yet — its github-script tests are added alongside that workflow.
