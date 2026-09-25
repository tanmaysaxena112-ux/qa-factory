import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildClaudeArgs } from './claude.js';

// Replays recorded agent answers from files, at zero cost. Used to test
// workflow logic without calling a model. Arguments are built exactly as the
// real provider builds them, so tests can prove the containment flags.
export function createStubProvider({ dir }) {
  return {
    name: 'stub',
    buildArgs: buildClaudeArgs,
    async invoke({ env }) {
      const role = env.QA_AGENT_ROLE;
      const step = env.QA_STEP_ID;
      const file = [join(dir, `${role}.${step}.json`), join(dir, `${role}.json`)].find(existsSync);
      if (!file) return { ok: false, error: `No stub answer for agent "${role}" step "${step}" in ${dir}` };
      const answer = JSON.parse(readFileSync(file, 'utf8'));
      if (answer.error) return { ok: false, error: answer.error, raw: answer, costUsd: answer.cost_usd ?? 0 };
      return { ok: true, output: answer.output, raw: { stub: true, ...answer }, costUsd: answer.cost_usd ?? 0 };
    },
  };
}
