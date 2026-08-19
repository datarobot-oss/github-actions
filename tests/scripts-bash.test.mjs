// Tests for the bash `run:` blocks embedded in the reusable workflows. The
// bodies are pulled straight from the YAML and executed under `bash -eo
// pipefail` (matching GitHub), with curl/gh/git/date stubbed for determinism.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadAction, loadWorkflow, runScript } from './helpers/workflow.mjs';
import { runBash } from './helpers/bash.mjs';

const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

/** A scratch directory with `files` ({ relativePath: contents }) written into it. */
function sandbox(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wf-files-'));
  for (const [name, contents] of Object.entries(files)) {
    const target = join(dir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return dir;
}

// --------------------------------------------------------------------------
// add-jira-link.yaml — "Extract Jira Ticket ID from PR title"
// --------------------------------------------------------------------------
function extractTicket(env) {
  const script = runScript(loadWorkflow('add-jira-link'), { id: 'extract-ticket' });
  return runBash(script, { env });
}

test('jira extract: single [TICKET] in title', () => {
  const r = extractTicket({ PR_TITLE: '[PROJ-123] Fix the thing', PR_BRANCH: 'main' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs['has-ticket'], 'true');
  assert.equal(r.outputs['ticket-id'], 'PROJ-123');
});

test('jira extract: multiple tickets join with commas', () => {
  const r = extractTicket({ PR_TITLE: '[PROJ-1][PROJ-22] two tickets', PR_BRANCH: 'main' });
  assert.equal(r.outputs['ticket-id'], 'PROJ-1,PROJ-22');
});

test('jira extract: falls back to branch name when title has none', () => {
  const r = extractTicket({ PR_TITLE: 'no ticket here', PR_BRANCH: 'user/PROJ-2342-some-feature' });
  assert.equal(r.outputs['has-ticket'], 'true');
  assert.equal(r.outputs['ticket-id'], 'PROJ-2342');
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

test('release: next-version handles a leading-zero patch (octal trap)', () => {
  // Bash reads 08/09 as invalid octal; without a base-10 guard the increment
  // silently fails and emits a duplicate version instead of bumping.
  const r = nextVersion('1.2.08');
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs['new-version'], '1.2.9');
  assert.equal(nextVersion('1.2.09').outputs['new-version'], '1.2.10');
  assert.equal(nextVersion('0.0.08').outputs['new-version'], '0.0.9');
});

test('release: next-version normalizes leading zeros in major/minor', () => {
  // A malformed tag with leading zeros should still yield clean semver.
  assert.equal(nextVersion('1.08.2').outputs['new-version'], '1.8.3');
  assert.equal(nextVersion('1.2.007').outputs['new-version'], '1.2.8');
});

// --------------------------------------------------------------------------
// create-release-on-merge.yaml — "Resolve the version to release"
// The single place that decides what gets tagged, in both modes: the caller's
// `version` input when it is set, otherwise the computed patch bump. Also the
// only tag-collision check, which is what makes a no-bump merge a quiet no-op
// instead of a red X on the default branch.
// --------------------------------------------------------------------------
function resolve({ supplied = '', computed = '', tags = '' } = {}) {
  const script = runScript(loadWorkflow('create-release-on-merge'), { id: 'resolve' });
  return runBash(script, {
    env: { SUPPLIED_VERSION: supplied, COMPUTED_VERSION: computed, __GIT_TAGS: tags },
  });
}

test('release resolve: auto mode releases the computed version', () => {
  const r = resolve({ computed: '1.4.10', tags: '1.4.9' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs.version, '1.4.10');
  assert.equal(r.outputs.released, 'true');
});

test('release resolve: a supplied version is used verbatim', () => {
  const r = resolve({ supplied: '2.0.0', tags: '1.9.9' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs.version, '2.0.0');
  assert.equal(r.outputs.released, 'true');
});

// The auto-mode steps are `if: inputs.version == ''` skipped when the caller
// supplies a version, so COMPUTED_VERSION arrives empty. Pinned because a
// regression here would silently release the wrong number rather than fail.
test('release resolve: a supplied version wins over a computed one', () => {
  assert.equal(resolve({ supplied: '3.1.4', computed: '1.0.1' }).outputs.version, '3.1.4');
  assert.equal(resolve({ supplied: '3.1.4', computed: '' }).outputs.version, '3.1.4');
});

test('release resolve: an existing tag is a no-op, not a failure', () => {
  const r = resolve({ supplied: '1.4.9', tags: ['1.4.8', '1.4.9'].join('\n') });
  assert.equal(r.code, 0, 'a merge that did not bump must not red-X main');
  assert.equal(r.outputs.released, 'false');
  assert.equal(r.outputs.version, '1.4.9', 'the version is reported even when nothing was released');
  assert.match(r.stdout, /::notice::Tag 1\.4\.9 already exists/);
});

test('release resolve: auto mode also skips a tag the semver scan missed', () => {
  const r = resolve({ computed: '1.4.10', tags: '1.4.10' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs.released, 'false');
});

test('release resolve: a v-prefixed tag is a different ref', () => {
  // The scan strips a `v` to find the LATEST tag, but the ref this step is about
  // to create is the bare string, so `v1.2.3` must not block `1.2.3`.
  const r = resolve({ supplied: '1.2.3', tags: 'v1.2.3' });
  assert.equal(r.outputs.released, 'true');
});

test('release resolve: a non-semver supplied version is rejected', () => {
  for (const bad of ['1.2', 'v1.2.3', '1.2.3-rc1', 'main', '']) {
    const r = resolve({ supplied: bad, computed: bad });
    assert.equal(r.code, 1, `expected '${bad}' to be rejected`);
    assert.match(r.stderr, /is not a plain X\.Y\.Z version/);
  }
});

test('release resolve: a shell-injecting version is rejected, not executed', () => {
  const r = resolve({ supplied: '1.2.3; touch /tmp/pwned' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /is not a plain X\.Y\.Z version/);
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

test('mark-pr-to-review: a failing Slack POST does not red-X the job', () => {
  const script = runScript(loadWorkflow('mark-pr-to-review'), { name: 'Send notification to Slack' });
  const r = runBash(script, {
    env: {
      __CURL_FAIL: '1', // simulate Slack 5xx / rate limit
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/abc',
      PR_NR: '123',
      PR_URL: 'https://github.com/org/repo/pull/123',
      PR_TITLE: 'A normal title',
      PR_AUTHOR: 'alice',
      PR_ADDITIONS: '10',
      PR_DELETIONS: '3',
      REPO_NAME: 'org/repo',
    },
  });
  assert.equal(r.code, 0, 'a Slack outage must not fail the caller check');
  assert.equal(r.posts.length, 1, 'the POST was still attempted');
  assert.match(r.stderr, /continuing without failing the job/);
});

test('mark-pr-to-review: an empty webhook URL is skipped, not crashed on', () => {
  const script = runScript(loadWorkflow('mark-pr-to-review'), { name: 'Send notification to Slack' });
  const r = runBash(script, {
    env: {
      SLACK_WEBHOOK_URL: '',
      PR_NR: '123',
      PR_URL: 'https://github.com/org/repo/pull/123',
      PR_TITLE: 'A normal title',
      PR_AUTHOR: 'alice',
      PR_ADDITIONS: '10',
      PR_DELETIONS: '3',
      REPO_NAME: 'org/repo',
    },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.posts.length, 0, 'no POST attempted without a webhook URL');
  assert.match(r.stderr, /empty; skipping/);
});

// slack_mention is what keeps one team's Slack handle out of every other
// consumer's channel, so both the set and unset shapes are pinned here.
test('mark-pr-to-review: slack_mention prefixes the message when set', () => {
  const script = runScript(loadWorkflow('mark-pr-to-review'), { name: 'Send notification to Slack' });
  const r = runBash(script, {
    env: {
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/abc',
      SLACK_MENTION: '@some-team',
      PR_NR: '123',
      PR_URL: 'https://github.com/org/repo/pull/123',
      PR_TITLE: 'A normal title',
      PR_AUTHOR: 'alice',
      PR_ADDITIONS: '10',
      PR_DELETIONS: '3',
      REPO_NAME: 'org/repo',
    },
  });
  assert.equal(r.code, 0, r.stderr);
  const text = JSON.parse(r.posts[0].data).blocks[0].text.text;
  assert.ok(text.startsWith('@some-team: :rocket:'), `mention should lead the message, got: ${text}`);
});

test('mark-pr-to-review: an unset slack_mention leaves no stray separator', () => {
  const script = runScript(loadWorkflow('mark-pr-to-review'), { name: 'Send notification to Slack' });
  const r = runBash(script, {
    env: {
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/abc',
      SLACK_MENTION: '',
      PR_NR: '123',
      PR_URL: 'https://github.com/org/repo/pull/123',
      PR_TITLE: 'A normal title',
      PR_AUTHOR: 'alice',
      PR_ADDITIONS: '10',
      PR_DELETIONS: '3',
      REPO_NAME: 'org/repo',
    },
  });
  assert.equal(r.code, 0, r.stderr);
  const text = JSON.parse(r.posts[0].data).blocks[0].text.text;
  assert.ok(text.startsWith(':rocket:'), `no mention means no prefix, got: ${text}`);
  assert.doesNotMatch(text, /buzok/i, 'no internal team handle is baked into the reusable workflow');
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
  assert.equal(records[0].status_icon, ':white_check_mark:', 'falls back to the universal default icon');
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
  assert.equal(records[0].status_icon, ':hourglass_flowing_sand:');
});

test('notify-slack: caller-supplied status icons override the universal defaults', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'build-pr-list' });
  const fixtures = [
    { match: 'pulls/1/reviews', body: [] },
    {
      match: 'pulls/1',
      body: {
        number: 1, title: 'A', user: { login: 'alice' }, additions: 1, deletions: 1,
        html_url: 'https://github.com/org/repo/pull/1', head: { sha: 'sha1' }, requested_reviewers: [],
      },
    },
    { match: 'issues/1/events', body: [] },
    { match: 'commits/sha1/status', body: { state: 'success' } },
  ];
  const r = runBash(script, {
    env: {
      GH_TOKEN: 'x',
      REPO_NAME: 'org/repo',
      PR_NUMBERS: '1',
      STATUS_ICON_SUCCESS: ':green_with_check:',
      STATUS_ICON_FAILURE: ':red_with_cross:',
      STATUS_ICON_PENDING: ':yellow_pending:',
    },
    now: sec('2026-06-30T00:00:00Z'),
    curlFixtures: fixtures,
  });
  assert.equal(r.code, 0, r.stderr);
  const records = JSON.parse(r.exportedEnv.PR_RECORDS);
  assert.equal(records[0].status_icon, ':green_with_check:');
});

// --------------------------------------------------------------------------
// notify-slack.yaml — API-error resilience. Every GET uses `curl -s` (not -f),
// so a rate limit / 5xx / bad-creds response arrives as a non-array body with
// exit 0. Under `set -eo pipefail` an unguarded jq filter on that body aborts
// the whole scheduled run. These cover the shapes GitHub actually returns when
// throttled ({"message": ...}) or when a call transiently fails (null/empty).
// --------------------------------------------------------------------------
test('notify-slack: fetch-prs survives a rate-limited (non-array) PRs response', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'fetch-prs' });
  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo' },
    curlFixtures: [{ match: 'pulls?state=open', body: { message: 'API rate limit exceeded' } }],
  });
  assert.equal(r.code, 0, 'a throttled PRs API must not crash the digest');
  assert.equal(r.outputs['pr-numbers'].trim(), '', 'degrades to no PRs, not a red X');
});

test('notify-slack: fetch-prs survives an empty/null PRs response (5xx / network)', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'fetch-prs' });
  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo' },
    curlFixtures: [{ match: 'pulls?state=open', body: null }],
  });
  assert.equal(r.code, 0, 'a null body must not crash the iterate-over-array jq');
  assert.equal(r.outputs['pr-numbers'].trim(), '');
});

test('notify-slack: build-pr-list survives a rate-limited reviews response', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'build-pr-list' });
  const now = sec('2026-06-30T00:00:00Z');
  const fixtures = [
    // reviews errored -> treat as "no approval" so the PR still surfaces.
    { match: 'pulls/1/reviews', body: { message: 'API rate limit exceeded' } },
    {
      match: 'pulls/1',
      body: {
        number: 1, title: 'A', user: { login: 'alice' }, additions: 1, deletions: 1,
        html_url: 'https://github.com/org/repo/pull/1', head: { sha: 'sha1' }, requested_reviewers: [],
      },
    },
    { match: 'issues/1/events', body: [] },
    { match: 'commits/sha1/status', body: { state: 'success' } },
  ];
  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo', PR_NUMBERS: '1' },
    now,
    curlFixtures: fixtures,
  });
  assert.equal(r.code, 0, 'a throttled reviews call must not crash the approval jq');
  const records = JSON.parse(r.exportedEnv.PR_RECORDS);
  assert.equal(records.length, 1, 'unknown approval state keeps the PR in the digest');
  assert.equal(records[0].number, 1);
});

test('notify-slack: build-pr-list skips a PR whose detail call errored', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'build-pr-list' });
  const now = sec('2026-06-30T00:00:00Z');
  const fixtures = [
    { match: 'pulls/1/reviews', body: [] },
    // detail errored -> no numeric id, so the PR is skipped rather than
    // emitting an all-null Slack line.
    { match: 'pulls/1', body: { message: 'API rate limit exceeded' } },
    { match: 'issues/1/events', body: [] },
    { match: 'commits', body: { state: 'success' } },
  ];
  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo', PR_NUMBERS: '1' },
    now,
    curlFixtures: fixtures,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.exportedEnv.PR_RECORDS), [], 'no garbage record for an unfetchable PR');
});

test('notify-slack: build-pr-list survives an errored events response (no wait time)', () => {
  const script = runScript(loadWorkflow('notify-slack'), { id: 'build-pr-list' });
  const now = sec('2026-06-30T00:00:00Z');
  const fixtures = [
    { match: 'pulls/1/reviews', body: [] },
    {
      match: 'pulls/1',
      body: {
        number: 1, title: 'A', user: { login: 'alice' }, additions: 1, deletions: 1,
        html_url: 'https://github.com/org/repo/pull/1', head: { sha: 'sha1' }, requested_reviewers: [],
      },
    },
    { match: 'issues/1/events', body: { message: 'Not Found' } },
    { match: 'commits/sha1/status', body: { state: 'success' } },
  ];
  const r = runBash(script, {
    env: { GH_TOKEN: 'x', REPO_NAME: 'org/repo', PR_NUMBERS: '1' },
    now,
    curlFixtures: fixtures,
  });
  assert.equal(r.code, 0, 'an errored events call must not crash the labeled-at jq');
  const records = JSON.parse(r.exportedEnv.PR_RECORDS);
  assert.equal(records.length, 1);
  assert.equal(records[0].waiting, '', 'no labeled-at means no wait time, not a crash');
});

// --------------------------------------------------------------------------
// check-changelog.yaml — "Check the changelog"
// Naive mode asserts the file moved against the base branch. Versioned mode
// also asserts it carries a heading naming the version being released.
// --------------------------------------------------------------------------
function checkChangelog({
  diff = 'CHANGELOG.md',
  files = {},
  version = '',
  baseRef = 'main',
  path = 'CHANGELOG.md',
  skipLabel = 'skip-changelog',
} = {}) {
  const script = runScript(loadWorkflow('check-changelog'), { id: 'check-changelog' });
  return runBash(script, {
    cwd: sandbox(files),
    now: sec('2026-08-18T00:00:00Z'),
    env: {
      BASE_REF: baseRef,
      CHANGELOG_PATH: path,
      VERSION: version,
      SKIP_LABEL: skipLabel,
      __GIT_DIFF_FILES: diff,
    },
  });
}

test('changelog: an untouched changelog fails, naming the skip label', () => {
  const r = checkChangelog({ diff: ['README.md', 'src/app.py'].join('\n') });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /::error::CHANGELOG\.md was not updated/);
  assert.match(r.stderr, /'skip-changelog' label/, 'tells the contributor the way out');
});

test('changelog: the skip label named in the message is the configured one', () => {
  // The label is an input, so a consumer with their own label must not be told
  // to apply ours.
  const r = checkChangelog({ diff: 'README.md', skipLabel: 'no-changelog-needed' });
  assert.match(r.stderr, /'no-changelog-needed' label/);
});

test('changelog: a touched changelog passes in naive mode', () => {
  const r = checkChangelog({ diff: ['CHANGELOG.md', 'src/app.py'].join('\n') });
  assert.equal(r.code, 0, r.stderr);
});

test('changelog: matches the path exactly, not as a substring', () => {
  // `-x` on the grep: a diff touching docs/CHANGELOG.md.bak must not satisfy a
  // check on CHANGELOG.md.
  const r = checkChangelog({ diff: ['docs/CHANGELOG.md', 'CHANGELOG.md.bak'].join('\n') });
  assert.equal(r.code, 1);
});

test('changelog: a custom changelog_path is honoured on both checks', () => {
  const r = checkChangelog({
    path: 'docs/CHANGES.md',
    diff: 'docs/CHANGES.md',
    version: '1.2.3',
    files: { 'docs/CHANGES.md': '# Changes\n\n## 1.2.3 - 2026-08-18\n- did a thing\n' },
  });
  assert.equal(r.code, 0, r.stderr);
});

test('changelog: versioned mode requires a heading for that version', () => {
  const files = { 'CHANGELOG.md': '# Changelog\n\n## 1.2.2 - 2026-08-01\n- older\n' };
  const r = checkChangelog({ version: '1.2.3', files });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /has no heading for version '1\.2\.3'/);
  assert.match(r.stderr, /## 1\.2\.3 - 2026-08-18/, 'suggests a heading with today’s date');
});

test('changelog: versioned mode accepts the heading styles people actually write', () => {
  const headings = [
    '## 1.2.3',
    '## 1.2.3 - 2026-08-18',
    '## 1.2.3 (2026-08-18)',
    '## [1.2.3] - 2026-08-18',
    '## v1.2.3',
    '### 1.2.3',
    '##   1.2.3',
  ];
  for (const heading of headings) {
    const r = checkChangelog({
      version: '1.2.3',
      files: { 'CHANGELOG.md': `# Changelog\n\n${heading}\n- did a thing\n` },
    });
    assert.equal(r.code, 0, `expected "${heading}" to match: ${r.stderr}`);
  }
});

test('changelog: a heading for a longer version is not a match', () => {
  // The trailing guard is what keeps 0.0.21 from being satisfied by an entry
  // for 0.0.210 or 0.0.21.1 — both real shapes in a repo that ships often.
  for (const heading of ['## 0.0.210', '## 0.0.21.1', '## 0.0.2']) {
    const r = checkChangelog({
      version: '0.0.21',
      files: { 'CHANGELOG.md': `# Changelog\n\n${heading}\n- did a thing\n` },
    });
    assert.equal(r.code, 1, `expected "${heading}" not to satisfy 0.0.21`);
  }
});

test('changelog: dots in the version stay literal', () => {
  const r = checkChangelog({
    version: '1.2.3',
    files: { 'CHANGELOG.md': '# Changelog\n\n## 1x2x3 - 2026-08-18\n- did a thing\n' },
  });
  assert.equal(r.code, 1, 'an unescaped dot would make this a false pass');
});

test('changelog: a bare version mention in prose is not a heading', () => {
  const r = checkChangelog({
    version: '1.2.3',
    files: { 'CHANGELOG.md': '# Changelog\n\nBumped to 1.2.3 in this release.\n' },
  });
  assert.equal(r.code, 1);
});

test('changelog: a non-pull_request event fails with an actionable message', () => {
  // github.base_ref is empty outside a pull request, and the git range would
  // otherwise blow up as "unknown revision" inside someone else's workflow.
  const r = checkChangelog({ baseRef: '' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /called from a pull_request trigger/);
});

// --------------------------------------------------------------------------
// actions/read-pyproject-version — "Read the version from pyproject.toml"
// --------------------------------------------------------------------------
// tomllib is stdlib from Python 3.11. CI runners have it; a machine still on an
// older system python does not, and skipping beats a confusing local failure in
// a repo that is otherwise Node-only.
const hasTomllib = spawnSync('python3', ['-c', 'import tomllib'], { stdio: 'ignore' }).status === 0;
const needsTomllib = hasTomllib ? {} : { skip: 'python3 on this machine has no tomllib (needs 3.11+)' };

function readVersion({ files = {}, path = 'pyproject.toml', requireSemver = 'true' } = {}) {
  const script = runScript(loadAction('read-pyproject-version'), { id: 'read' });
  return runBash(script, {
    cwd: sandbox(files),
    env: { PYPROJECT_PATH: path, REQUIRE_SEMVER: requireSemver },
  });
}

// The whole reason this uses tomllib rather than a grep: `version` appears three
// times in this file and only one of them is the project's.
const REALISTIC_PYPROJECT = `[build-system]
requires = ["hatchling>=1.0"]
build-backend = "hatchling.build"

[project]
name = "demo"
version = "1.4.2"
dependencies = ["requests>=2.31", "packaging==24.1"]

[tool.poetry]
version = "9.9.9"
`;

test('pyproject: reads [project].version, not the first version-looking line', needsTomllib, () => {
  const r = readVersion({ files: { 'pyproject.toml': REALISTIC_PYPROJECT } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs.version, '1.4.2');
});

test('pyproject: a custom path is read', needsTomllib, () => {
  const r = readVersion({
    path: 'packages/tool/pyproject.toml',
    files: { 'packages/tool/pyproject.toml': '[project]\nversion = "0.1.0"\n' },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs.version, '0.1.0');
});

test('pyproject: a missing file points at the checkout, not at TOML', () => {
  const r = readVersion();
  assert.equal(r.code, 1);
  assert.match(r.stderr, /has to run actions\/checkout/);
});

test('pyproject: a dynamic version says so instead of crashing', needsTomllib, () => {
  const r = readVersion({
    files: { 'pyproject.toml': '[project]\nname = "demo"\ndynamic = ["version"]\n' },
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /declares no \[project\] version/);
  assert.match(r.stderr, /setuptools-scm/, 'names the likely cause');
});

test('pyproject: malformed TOML reports the parse error, not a traceback', needsTomllib, () => {
  const r = readVersion({ files: { 'pyproject.toml': '[project\nversion = "1.0.0"\n' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /is not valid TOML/);
  assert.doesNotMatch(r.stderr, /Traceback/);
});

test('pyproject: a non-X.Y.Z version is rejected by default', needsTomllib, () => {
  const r = readVersion({ files: { 'pyproject.toml': '[project]\nversion = "1.4.2rc1"\n' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /is not a plain X\.Y\.Z version/);
  assert.match(r.stderr, /require_semver/, 'names the input that relaxes it');
});

test('pyproject: require_semver=false passes a prerelease through', needsTomllib, () => {
  const r = readVersion({
    files: { 'pyproject.toml': '[project]\nversion = "1.4.2rc1"\n' },
    requireSemver: 'false',
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.outputs.version, '1.4.2rc1');
});
