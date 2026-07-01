// Tests for the bash `run:` blocks embedded in the reusable workflows. The
// bodies are pulled straight from the YAML and executed under `bash -eo
// pipefail` (matching GitHub), with curl/gh/git/date stubbed for determinism.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflow, runScript } from './helpers/workflow.mjs';
import { runBash } from './helpers/bash.mjs';

const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

// --------------------------------------------------------------------------
// add-jira-link.yaml — "Extract Jira Ticket ID from PR title"
// --------------------------------------------------------------------------
function extractTicket(env) {
  const script = runScript(loadWorkflow('add-jira-link'), { id: 'extract-ticket' });
  return runBash(script, { env });
}

test('jira extract: single [TICKET] in title', () => {
  const r = extractTicket({ PR_TITLE: '[BUZZOK-123] Fix the thing', PR_BRANCH: 'main' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs['has-ticket'], 'true');
  assert.equal(r.outputs['ticket-id'], 'BUZZOK-123');
});

test('jira extract: multiple tickets join with commas', () => {
  const r = extractTicket({ PR_TITLE: '[BUZZOK-1][PROJ-22] two tickets', PR_BRANCH: 'main' });
  assert.equal(r.outputs['ticket-id'], 'BUZZOK-1,PROJ-22');
});

test('jira extract: falls back to branch name when title has none', () => {
  const r = extractTicket({ PR_TITLE: 'no ticket here', PR_BRANCH: 'user/BUZZOK-2342-some-feature' });
  assert.equal(r.outputs['has-ticket'], 'true');
  assert.equal(r.outputs['ticket-id'], 'BUZZOK-2342');
});

test('jira extract: no ticket anywhere -> has-ticket=false', () => {
  const r = extractTicket({ PR_TITLE: 'just a title', PR_BRANCH: 'main' });
  assert.equal(r.outputs['has-ticket'], 'false');
  assert.equal(r.outputs['ticket-id'], undefined);
});

// --------------------------------------------------------------------------
// create-release-on-merge.yaml — latest-tag detection + version bump
// --------------------------------------------------------------------------
function latestTag(tags) {
  const script = runScript(loadWorkflow('create-release-on-merge'), { id: 'get-latest-tag' });
  return runBash(script, { env: { __GIT_TAGS: tags } });
}
function nextVersion(latest) {
  const script = runScript(loadWorkflow('create-release-on-merge'), { id: 'next-version' });
  return runBash(script, { templateVars: { 'steps.get-latest-tag.outputs.latest-tag': latest } });
}

test('release: picks the highest semver tag with sort -V (not lexical)', () => {
  const r = latestTag(['1.2.0', '1.10.0', '1.9.0', 'not-a-tag'].join('\n'));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs['latest-tag'], '1.10.0'); // 1.10 > 1.9 numerically
});

test('release: strips a v prefix from tags', () => {
  const r = latestTag(['v2.0.1', 'v2.0.10'].join('\n'));
  assert.equal(r.outputs['latest-tag'], '2.0.10');
});

test('release: no tags -> defaults to 0.0.0', () => {
  const r = latestTag('');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs['latest-tag'], '0.0.0');
});

test('release: next-version increments the patch', () => {
  assert.equal(nextVersion('1.4.9').outputs['new-version'], '1.4.10');
  assert.equal(nextVersion('0.0.0').outputs['new-version'], '0.0.1');
});

// --------------------------------------------------------------------------
// mark-pr-to-review.yaml — single Slack notification payload
// --------------------------------------------------------------------------
test('mark-pr-to-review: builds valid Slack JSON and is injection-safe', () => {
  const script = runScript(loadWorkflow('mark-pr-to-review'), { name: 'Send notification to Slack' });
  const nastyTitle = 'Fix "quotes" & $(whoami) `backticks` and \\ slashes';
  const r = runBash(script, {
    env: {
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/abc',
      PR_NR: '123',
      PR_URL: 'https://github.com/org/repo/pull/123',
      PR_TITLE: nastyTitle,
      PR_AUTHOR: 'alice',
      PR_ADDITIONS: '10',
      PR_DELETIONS: '3',
      REPO_NAME: 'org/repo',
    },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.posts.length, 1, 'one POST to Slack');
  assert.equal(r.posts[0].url, 'https://hooks.slack.test/abc');
  const payload = JSON.parse(r.posts[0].data); // throws if jq emitted invalid JSON
  const text = payload.blocks[0].text.text;
  assert.ok(text.includes(nastyTitle), 'title preserved verbatim, no shell expansion');
  assert.ok(text.includes('by alice'));
});

// --------------------------------------------------------------------------
// notify-slack.yaml — scheduled digest of open "ready for review" PRs
// --------------------------------------------------------------------------
test('notify-slack: fetch-prs keeps ready-for-review PRs, drops reviewed/others', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'fetch-prs' });
  const fixtures = [
    {
      match: 'pulls?state=open',
      body: [
        { number: 1, title: 'A', labels: [{ name: 'Ready for Review' }] },
        { number: 2, title: 'B', labels: [{ name: 'ready for review' }, { name: '00 - Reviewed' }] },
        { number: 3, title: 'C', labels: [{ name: 'wip' }] },
        { number: 4, title: 'D', labels: [{ name: 'READY FOR REVIEW' }] },
      ],
    },
  ];
  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo' },
    curlFixtures: fixtures,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs['pr-numbers'].trim(), '1 4');
});

test('notify-slack: build-pr-list skips approved PRs and computes waiting time', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'build-pr-list' });
  const now = sec('2026-06-30T00:00:00Z');
  const fixtures = [
    // PR 1 — open, unapproved, labelled ~1 day ago, CI green -> included
    { match: 'pulls/1/reviews', body: [] },
    {
      match: 'pulls/1',
      body: {
        number: 1,
        title: 'Add "feature" & stuff',
        user: { login: 'alice' },
        additions: 5,
        deletions: 2,
        html_url: 'https://github.com/org/repo/pull/1',
        head: { sha: 'sha1' },
        requested_reviewers: [],
      },
    },
    {
      match: 'issues/1/events',
      body: [
        { event: 'labeled', label: { name: 'Ready for Review' }, created_at: '2026-06-29T00:00:00Z' },
      ],
    },
    { match: 'commits/sha1/status', body: { state: 'success' } },

    // PR 2 — approved with no pending re-review -> skipped
    { match: 'pulls/2/reviews', body: [{ state: 'APPROVED', user: { login: 'bob' }, submitted_at: '2026-06-01T00:00:00Z' }] },
    { match: 'pulls/2', body: { number: 2, title: 'B', head: { sha: 'sha2' }, requested_reviewers: [] } },
  ];

  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo', PR_NUMBERS: '1 2' },
    now,
    curlFixtures: fixtures,
  });
  assert.equal(r.code, 0, r.stderr);

  const records = JSON.parse(r.exportedEnv.PR_RECORDS);
  assert.equal(records.length, 1, 'only the unapproved PR survives');
  assert.equal(records[0].number, 1);
  assert.equal(records[0].title, 'Add "feature" & stuff', 'title round-trips through JSON intact');
  assert.equal(records[0].status_icon, ':green_with_check:');
  assert.match(records[0].waiting, /waiting 1d 0h/);
});

// --------------------------------------------------------------------------
// workflow-backport.yaml — "Compute label pattern"
// Scopes korthout to the triggering label on `labeled` events so it doesn't
// reprocess already-backported branches; uses the catch-all on merge.
// --------------------------------------------------------------------------
function computePattern(env) {
  const script = runScript(loadWorkflow('workflow-backport'), { id: 'pattern' });
  return runBash(script, { env });
}

test('backport pattern: merge (closed) event uses the catch-all pattern', () => {
  const r = computePattern({ ACTION: 'closed', LABEL_NAME: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs['label_pattern'], '^backport ([^ ]+)$');
});

test('backport pattern: labeled event scopes to only the triggering branch', () => {
  const r = computePattern({ ACTION: 'labeled', LABEL_NAME: 'backport release/12.0' });
  assert.equal(r.code, 0, r.stderr);
  const pattern = r.outputs['label_pattern'];
  assert.equal(pattern, '^backport (release/12\\.0)$');

  // The whole point: the scoped regex matches its own label and NOT the other
  // backport labels that may sit on the same PR.
  const re = new RegExp(pattern);
  assert.match('backport release/12.0', re);
  assert.doesNotMatch('backport release/11.0', re, 'must not re-trigger other branches');
  assert.doesNotMatch('backport release/12X0', re, 'escaped dot is literal, not a wildcard');
  // Capture group yields the branch korthout backports to.
  assert.equal('backport release/12.0'.match(re)[1], 'release/12.0');
});

test('backport pattern: plain branch name needs no escaping', () => {
  const r = computePattern({ ACTION: 'labeled', LABEL_NAME: 'backport main' });
  assert.equal(r.outputs['label_pattern'], '^backport (main)$');
});

test('notify-slack: reconciles a missing "00 - Reviewed" label on an approved+done PR', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'build-pr-list' });
  const now = sec('2026-06-30T00:00:00Z');
  const fixtures = [
    // Approved, no pending re-review -> excluded from the digest. It only
    // reached this loop because the event-driven mark-reviewed never fired,
    // so the digest must heal the label itself.
    { match: 'pulls/2/reviews', body: [{ state: 'APPROVED', user: { login: 'bob' }, submitted_at: '2026-06-01T00:00:00Z' }] },
    { match: 'pulls/2', body: { number: 2, title: 'B', head: { sha: 'sha2' }, requested_reviewers: [] } },
  ];
  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo', PR_NUMBERS: '2' },
    now,
    curlFixtures: fixtures,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.exportedEnv.PR_RECORDS), [], 'approved PR stays out of the digest');

  const labelPost = r.posts.find((p) => p.url.includes('/issues/2/labels'));
  assert.ok(labelPost, 'posts a label-reconcile request to the labels endpoint');
  assert.deepEqual(JSON.parse(labelPost.data), { labels: ['00 - Reviewed'] });
});

test('notify-slack: approved PR with a pending re-review request is re-surfaced', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'build-pr-list' });
  const now = sec('2026-06-30T00:00:00Z');
  const fixtures = [
    { match: 'pulls/3/reviews', body: [{ state: 'APPROVED', user: { login: 'bob' }, submitted_at: '2026-06-01T00:00:00Z' }] },
    {
      match: 'pulls/3',
      body: {
        number: 3,
        title: 'Reopened review',
        user: { login: 'carol' },
        additions: 1,
        deletions: 1,
        html_url: 'https://github.com/org/repo/pull/3',
        head: { sha: 'sha3' },
        requested_reviewers: [{ login: 'dave' }], // re-review requested
      },
    },
    { match: 'issues/3/events', body: [] },
    { match: 'commits/sha3/status', body: { state: 'pending' } },
  ];
  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo', PR_NUMBERS: '3' },
    now,
    curlFixtures: fixtures,
  });
  assert.equal(r.code, 0, r.stderr);
  const records = JSON.parse(r.exportedEnv.PR_RECORDS);
  assert.equal(records.length, 1, 'approval is overridden by the pending re-review request');
  assert.equal(records[0].status_icon, ':yellow_pending:');
});
