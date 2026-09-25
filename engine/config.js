import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(repoRoot = REPO_ROOT) {
  return JSON.parse(readFileSync(join(repoRoot, 'qa.config.json'), 'utf8'));
}

// Definitions (schemas, agents, workflows) come from the repository. Run data
// (evidence, logs, database) can live elsewhere, which keeps tests hermetic.
export function resolvePaths({ repoRoot = REPO_ROOT, dataRoot = process.env.QA_DATA_ROOT || repoRoot } = {}) {
  return {
    repoRoot,
    dataRoot,
    schemas: join(repoRoot, 'schemas'),
    agents: join(repoRoot, 'agents'),
    workflows: join(repoRoot, 'workflows'),
    hooks: join(repoRoot, '.claude', 'hooks'),
    mcpConfig: join(repoRoot, '.mcp.json'),
    cli: join(repoRoot, 'cli', 'bin', 'qa.js'),
    evidence: join(dataRoot, 'evidence'),
    logs: join(dataRoot, 'logs'),
    db: join(dataRoot, 'qa.sqlite'),
  };
}
