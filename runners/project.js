import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

export function loadProject(repoRoot, name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name ?? '')) throw new Error(`Invalid project name "${name}"`);
  const dir = join(repoRoot, 'projects', name);
  const file = join(dir, 'project.yml');
  if (!existsSync(file)) throw new Error(`Unknown project "${name}"`);
  const doc = YAML.parse(readFileSync(file, 'utf8'));
  if (doc.name !== name) throw new Error(`projects/${name}/project.yml: name must be "${name}"`);
  return { ...doc, dir };
}

export function projectEnv(project, envName) {
  const env = project.envs?.[envName];
  if (!env) throw new Error(`Project ${project.name} has no environment "${envName}"`);
  if (!['dev', 'uat'].includes(envName)) throw new Error('Tests run against dev or UAT only');
  return env;
}

export function listFiles(dir, pattern) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => pattern.test(f)).sort().map((f) => join(dir, f)) : [];
}
