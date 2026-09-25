import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from '../engine/config.js';

export const CLI = join(REPO_ROOT, 'cli', 'bin', 'qa.js');

export function tempDir(t, prefix = 'qa-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function stubAnswers(t, answers) {
  const dir = tempDir(t, 'qa-stub-');
  for (const [name, body] of Object.entries(answers)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(body));
  return dir;
}

export const selftestAnswer = {
  output: { schema: 'qa.selftest.v1', schema_count: 7, summary: 'The listing names 7 schemas.' },
  cost_usd: 0.01,
};

export function stubEnv(stubDir, extra = {}) {
  return { ...process.env, QA_AGENT_PROVIDER: 'stub', QA_AGENT_STUB_DIR: stubDir, ...extra };
}

export function runHook(file, input, env = {}) {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, '.claude', 'hooks', file)], {
    input: JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: result.status, stderr: result.stderr };
}

export function runCli(args, env) {
  const result = spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', CLI, ...args], { env, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
