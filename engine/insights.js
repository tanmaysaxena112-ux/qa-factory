import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';
import { loadPrdIndex, projectPrds } from './prd.js';

const lastCommitTime = (repoRoot, path) => {
  const out = spawnSync('git', ['log', '-1', '--format=%ct', '--', path], { cwd: repoRoot, encoding: 'utf8' });
  return out.status === 0 && out.stdout.trim() ? Number(out.stdout.trim()) : null;
};

const testFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)) : []);

// Requirements x surfaces: cases, automated tests and the latest status of each.
export function coverageMap({ repoRoot, project, schemas, history }) {
  const latest = new Map();
  for (const r of history) latest.set(`${r.surface}:${r.test_id}`, r.status);
  const automated = new Map();
  for (const surface of ['api', 'web', 'mobile']) {
    for (const file of testFiles(join(project.dir, surface, 'tests'))) {
      for (const t of JSON.parse(readFileSync(file, 'utf8')).tests) automated.set(t.test_id, surface);
    }
  }
  const rows = [];
  for (const file of projectPrds(repoRoot, project.name)) {
    const prd = loadPrdIndex(file, schemas);
    const casesFile = join(project.dir, 'cases', `${prd.prd_id}.cases.yaml`);
    const cases = existsSync(casesFile) ? YAML.parse(readFileSync(casesFile, 'utf8')).cases : [];
    for (const req of prd.requirements) {
      for (const ac of req.acceptance_criteria) {
        const citing = cases.filter((c) => c.criteria.includes(ac.id));
        const tests = citing.filter((c) => automated.has(c.id));
        const statuses = tests.map((c) => latest.get(`${c.surface}:${c.id}`) ?? 'NEVER_RUN');
        rows.push({
          prd_id: prd.prd_id,
          requirement: req.id,
          risk: req.risk,
          criterion: ac.id,
          cases: citing.length,
          manual: citing.filter((c) => c.manual).length,
          automated: tests.length,
          latest: statuses.includes('FAIL') ? 'FAIL' : statuses.length && statuses.every((s) => s === 'PASS') ? 'PASS' : statuses.length ? 'MIXED' : 'NOT_AUTOMATED',
        });
      }
    }
  }
  return rows;
}

// A PRD edited after its cases or tests were last updated may have moved on
// without them.
export function drift({ repoRoot, project }) {
  const findings = [];
  for (const file of projectPrds(repoRoot, project.name)) {
    const prdId = file.split('/').pop().replace(/\.md$/, '');
    const prdTime = lastCommitTime(repoRoot, relative(repoRoot, file));
    const followers = [join(project.dir, 'cases', `${prdId}.cases.yaml`), ...['api', 'web', 'mobile'].map((s) => join(project.dir, s, 'tests', `${prdId}.json`))].filter(existsSync);
    for (const f of followers) {
      const t = lastCommitTime(repoRoot, relative(repoRoot, f));
      if (prdTime && t && prdTime > t) findings.push({ prd_id: prdId, stale: relative(repoRoot, f), prd_changed: new Date(prdTime * 1000).toISOString(), follower_changed: new Date(t * 1000).toISOString() });
    }
  }
  return findings;
}
