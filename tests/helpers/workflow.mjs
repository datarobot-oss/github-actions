// Loads a reusable workflow YAML from .github/workflows, or a composite action
// from actions/, and pulls the embedded `run:` (bash) and `with.script:`
// (github-script JS) blocks back out, so the tests exercise the EXACT code that
// ships in production. Nothing here mutates the files — they stay byte-for-byte
// what downstream repos consume.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');
const ACTIONS_DIR = join(REPO_ROOT, 'actions');

/** Parse a workflow file, e.g. loadWorkflow('backport'). */
export function loadWorkflow(name) {
  const file = join(WORKFLOWS_DIR, `${name}.yaml`);
  return yaml.load(readFileSync(file, 'utf8'));
}

/** Parse a composite action, e.g. loadAction('read-pyproject-version'). */
export function loadAction(name) {
  const file = join(ACTIONS_DIR, name, 'action.yaml');
  return yaml.load(readFileSync(file, 'utf8'));
}

/**
 * Flatten every step into one array. A workflow keeps its steps under each job;
 * a composite action keeps them under `runs.steps`, so both shapes feed the same
 * findStep/runScript selectors.
 */
export function allSteps(workflow) {
  if (Array.isArray(workflow.runs?.steps)) return workflow.runs.steps;
  return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

/**
 * Find a single step by its `id`, or by a substring of its `name`.
 * Throws if zero or more than one step matches, so a renamed step fails loud
 * instead of silently testing nothing.
 */
export function findStep(workflow, { id, name }) {
  const matches = allSteps(workflow).filter((step) => {
    if (id !== undefined) return step.id === id;
    if (name !== undefined) return (step.name ?? '').includes(name);
    return false;
  });
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 step matching ${JSON.stringify({ id, name })}, found ${matches.length}`,
    );
  }
  return matches[0];
}

/** The bash body of a `run:` step. */
export function runScript(workflow, selector) {
  const step = findStep(workflow, selector);
  if (typeof step.run !== 'string') {
    throw new Error(`step ${JSON.stringify(selector)} has no run: block`);
  }
  return step.run;
}

/** The JS body of an `actions/github-script` step (`with.script:`). */
export function githubScript(workflow, selector) {
  const step = findStep(workflow, selector);
  const script = step.with?.script;
  if (typeof script !== 'string') {
    throw new Error(`step ${JSON.stringify(selector)} has no with.script: block`);
  }
  return script;
}
