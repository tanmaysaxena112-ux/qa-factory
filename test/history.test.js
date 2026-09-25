import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flakiness } from '../engine/history.js';

const row = (run, test_id, status, commit_sha) => ({ run_id: run, surface: 'api', test_id, status, commit_sha });

test('different outcomes on the same commit are flaky', () => {
  const report = flakiness([row('R1', 'API-A-01', 'PASS', 'abc'), row('R2', 'API-A-01', 'FAIL', 'abc'), row('R1', 'API-A-02', 'PASS', 'abc')], []);
  assert.equal(report.tests, 2);
  assert.deepEqual(report.flaky.map((f) => f.test_id), ['API-A-01']);
  assert.equal(report.rate, 0.5);
});

test('a result that changes after a code change is a fix, not flakiness', () => {
  const report = flakiness([row('R1', 'API-A-01', 'FAIL', 'abc'), row('R2', 'API-A-01', 'PASS', 'def')], []);
  assert.equal(report.flaky.length, 0);
});

test('runs without a recorded commit are never compared', () => {
  const report = flakiness([row('R1', 'API-A-01', 'FAIL', null), row('R2', 'API-A-01', 'PASS', null)], []);
  assert.equal(report.flaky.length, 0);
});

test('a re-execution that does not reproduce is flaky', () => {
  const report = flakiness([row('R1', 'API-A-01', 'FAIL', 'abc')], [{ run_id: 'R1', surface: 'api', test_id: 'API-A-01', original: 'FAIL', rerun: 'PASS' }]);
  assert.deepEqual(report.flaky[0].unreproduced_reruns, ['R1']);
});
