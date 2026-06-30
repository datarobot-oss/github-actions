// Runs an extracted `run:` block the way GitHub does (`bash -eo pipefail`),
// with deterministic offline stubs for curl/gh/date on PATH, and with
// $GITHUB_OUTPUT / $GITHUB_ENV wired to temp files that we parse back out.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplate } from './github-script.mjs';

const STUBS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'stubs');

// Parse the `key=value` and `key<<DELIM ... DELIM` heredoc forms that GitHub
// accepts in $GITHUB_OUTPUT / $GITHUB_ENV.
function parseEnvFile(text) {
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    const heredoc = line.match(/^([A-Za-z_][A-Za-z0-9_]*)<<(.+)$/);
    if (heredoc) {
      const [, key, delim] = heredoc;
      const buf = [];
      i++;
      while (i < lines.length && lines[i] !== delim) buf.push(lines[i++]);
      out[key] = buf.join('\n');
      continue;
    }
    const eq = line.indexOf('=');
    if (eq !== -1) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/**
 * Run a bash `run:` block.
 *  - script: the bash string (from runScript()).
 *  - env: extra environment variables (the resolved `env:` block of the step).
 *  - templateVars: values for any `${{ }}` expressions embedded in the bash.
 *  - now: pin "now" (epoch seconds) for deterministic date math.
 *  - curlFixtures: [{match, body}] served to GET curls by URL substring.
 * Returns { code, stdout, stderr, outputs, exportedEnv, posts }.
 */
export function runBash(script, { env = {}, templateVars = {}, now, curlFixtures = [] } = {}) {
  const rendered = renderTemplate(script, templateVars);
  const dir = mkdtempSync(join(tmpdir(), 'wf-bash-'));
  const scriptPath = join(dir, 'step.sh');
  const outPath = join(dir, 'github_output');
  const envPath = join(dir, 'github_env');
  const capturePath = join(dir, 'curl_capture');
  writeFileSync(scriptPath, rendered);
  writeFileSync(outPath, '');
  writeFileSync(envPath, '');

  const result = spawnSync('bash', ['-eo', 'pipefail', scriptPath], {
    encoding: 'utf8',
    env: {
      PATH: `${STUBS_DIR}:${process.env.PATH}`,
      GITHUB_OUTPUT: outPath,
      GITHUB_ENV: envPath,
      __CURL_CAPTURE: capturePath,
      __CURL_FIXTURES: JSON.stringify(curlFixtures),
      ...(now !== undefined ? { __NOW_EPOCH: String(now) } : {}),
      ...env,
    },
  });

  const posts = existsSync(capturePath)
    ? readFileSync(capturePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    outputs: parseEnvFile(readFileSync(outPath, 'utf8')),
    exportedEnv: parseEnvFile(readFileSync(envPath, 'utf8')),
    posts,
  };
}
