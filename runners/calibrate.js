import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { runApiTests } from './api.js';

export const FAULT_DETECTION_TARGET = 0.99;

// Proves a suite can be trusted before anyone relies on it: a good build passes,
// every seeded fault is caught, and a wrong build identity blocks the run
// instead of producing results.
export async function calibrate({ repoRoot, project, envName, tests, schemas, sink, runId }) {
  const env = project.envs[envName];
  const faultEnv = env.local_app?.fault_env;
  if (!faultEnv) throw new Error(`Environment ${envName} has no local_app.fault_env; calibration needs a way to inject faults`);
  const faults = YAML.parse(readFileSync(join(project.dir, project.faults), 'utf8')).faults ?? [];
  const common = { repoRoot, project, envName, tests, schemas, sink, runId };

  const baseline = await runApiTests({ ...common, label: 'calibrate/baseline' });
  const baselinePassing = new Set(baseline.results.filter((r) => r.status === 'PASS').map((r) => r.test_id));
  const faultResults = [];
  for (const fault of faults) {
    const run = await runApiTests({ ...common, label: `calibrate/fault-${fault.id}`, appEnv: { [faultEnv]: fault.id } });
    // A fault is caught only by a test that passed on the healthy build. A test
    // that fails everywhere proves nothing about this fault.
    const failing = run.results.filter((r) => r.status === 'FAIL' && baselinePassing.has(r.test_id)).map((r) => r.test_id);
    faultResults.push({ id: fault.id, detected: failing.length > 0, failing_tests: failing });
  }
  const identity = await runApiTests({ ...common, label: 'calibrate/wrong-identity', expectedBuild: 'calibration-wrong-build' });
  const identityOk = identity.blocked === identity.total && identity.total > 0;

  const detected = faultResults.filter((f) => f.detected).length;
  const rate = faults.length ? detected / faults.length : 0;
  const record = {
    schema: 'qa.calibration.v1',
    project: project.name,
    baseline: {
      total: baseline.total,
      passed: baseline.pass,
      failing: baseline.results.filter((r) => r.status !== 'PASS').map((r) => r.test_id),
      ok: baseline.total > 0 && baseline.pass === baseline.total,
    },
    faults: faultResults,
    identity_check: { status: identityOk ? 'all tests BLOCKED on wrong build' : `expected all BLOCKED, got ${identity.blocked}/${identity.total}`, ok: identityOk },
    fault_detection_rate: Number(rate.toFixed(4)),
    target: FAULT_DETECTION_TARGET,
    ok: false,
  };
  record.ok = record.baseline.ok && identityOk && rate >= FAULT_DETECTION_TARGET;
  const check = schemas.validate('qa.calibration.v1', record);
  if (!check.ok) throw new Error(`Calibration record breaks its schema: ${check.errors.join('; ')}`);
  sink.write('calibration.json', record);
  return record;
}
