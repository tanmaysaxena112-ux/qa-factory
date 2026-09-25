import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SURFACES = ['api', 'web', 'mobile'];

// Records a finished run's results and re-executions so flakiness and trends
// come from exact history, not recollection.
export function ingestRun({ store, evidenceDir, run }) {
  for (const surface of SURFACES) {
    const file = join(evidenceDir, surface, 'main', 'results.json');
    if (!existsSync(file)) continue;
    const results = JSON.parse(readFileSync(file, 'utf8'));
    const rerunFile = join(evidenceDir, surface, 'rerun', 'comparison.json');
    const reruns = existsSync(rerunFile) ? JSON.parse(readFileSync(rerunFile, 'utf8')) : [];
    store.recordResults(run.id, { project: run.params.project, surface, commitSha: run.commit_sha, results, reruns });
  }
}

// A test is flaky when, on the same commit, it produced different outcomes, or
// when a re-execution did not reproduce its result.
export function flakiness(history, reruns) {
  const byKey = new Map();
  for (const r of history) {
    if (!['PASS', 'FAIL'].includes(r.status)) continue;
    const key = `${r.surface}:${r.test_id}`;
    const entry = byKey.get(key) ?? { surface: r.surface, test_id: r.test_id, runs: 0, byCommit: new Map() };
    entry.runs += 1;
    const commit = r.commit_sha ?? 'unknown';
    entry.byCommit.set(commit, new Set([...(entry.byCommit.get(commit) ?? []), r.status]));
    byKey.set(key, entry);
  }
  const flaky = [];
  for (const entry of byKey.values()) {
    // Runs without a recorded commit cannot be compared: the product may have
    // changed between them, which is a fix, not flakiness.
    const mixedCommits = [...entry.byCommit.entries()].filter(([c, statuses]) => c !== 'unknown' && statuses.size > 1).map(([c]) => c);
    const unreproduced = reruns.filter((x) => x.surface === entry.surface && x.test_id === entry.test_id && x.original !== x.rerun);
    if (mixedCommits.length || unreproduced.length) {
      flaky.push({ surface: entry.surface, test_id: entry.test_id, runs: entry.runs, mixed_commits: mixedCommits, unreproduced_reruns: unreproduced.map((x) => x.run_id) });
    }
  }
  return { tests: byKey.size, flaky, rate: byKey.size ? flaky.length / byKey.size : 0 };
}
