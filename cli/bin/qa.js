#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { userInfo, hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { resolvePaths } from '../../engine/config.js';
import { runDoctor } from '../../engine/doctor.js';
import { createEngine } from '../../engine/engine.js';
import { loadSchemas } from '../../engine/schemas.js';
import { listWorkflows, loadWorkflow } from '../../engine/workflow.js';
import { createEvidence } from '../../engine/evidence.js';

// Exit codes describe the run, not the command, so CI never mistakes a pause
// or a rejection for success.
const EXIT = { completed: 0, failed: 1, usage: 2, rejected: 3, paused: 10, halted: 11 };

const HELP = `qa: QA Factory command line

  qa doctor [--json] [--offline]      Check the platform is safe and ready
  qa schemas [--json]                 List contract schemas
  qa workflow list                    List workflows
  qa workflow validate [name]         Validate one or all workflows
  qa run <workflow> [--param k=v]     Start a run
  qa status [run-id] [--json]         Show one run, or recent runs
  qa approve <run-id> [--reason text] Approve the gate a run is waiting at
  qa reject <run-id> --reason text    Reject the gate and stop the run
  qa resume <run-id>                  Continue a halted run
  qa halt | qa unhalt                 Stop or allow new work platform-wide
  qa evidence verify <run-id>         Check sealed evidence against its manifest

Exit codes: 0 completed, 1 failed, 2 usage error, 3 rejected, 10 waiting for approval, 11 halted`;

function approverIdentity() {
  return process.env.QA_APPROVER || `${userInfo().username}@${hostname()}`;
}

function printRun(run, json) {
  if (json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }
  console.log(`${run.id}  ${run.workflow}  ${run.status.toUpperCase()}  cost $${run.cost_usd.toFixed(4)}`);
  for (const s of run.steps) {
    const note = s.error ? `  ${s.error}` : '';
    console.log(`  ${s.status.padEnd(9)} ${s.kind.padEnd(5)} ${s.step_id}${note}`);
  }
  console.log(`  evidence: ${run.evidence}`);
  if (run.status === 'paused') console.log(`\nWaiting for you: qa approve ${run.id}  or  qa reject ${run.id} --reason "..."`);
  if (run.status === 'halted') console.log(`\nHalted: qa unhalt, then qa resume ${run.id}`);
}

const exitFor = (run) => EXIT[run.status] ?? EXIT.failed;

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      param: { type: 'string', multiple: true, default: [] },
      reason: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (!command || values.help) {
    console.log(HELP);
    return command ? 0 : EXIT.usage;
  }

  if (command === 'doctor') {
    const report = await runDoctor({ network: !values.offline });
    const engine = createEngine();
    if (engine.isHalted()) report.checks.push({ name: 'Halt switch', status: 'WARN', detail: 'platform is halted', fix: 'qa unhalt' });
    engine.close();
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const c of report.checks) {
        console.log(`${c.status.padEnd(4)}  ${c.name.padEnd(22)} ${c.detail}`);
        if (c.fix && c.status !== 'PASS') console.log(`      ${''.padEnd(22)} fix: ${c.fix}`);
      }
      console.log(report.ok ? '\nqa doctor: ready' : '\nqa doctor: NOT READY. Fix every FAIL before an orchestrated run.');
    }
    return report.ok ? 0 : EXIT.failed;
  }

  if (command === 'schemas') {
    const schemas = loadSchemas(resolvePaths().schemas);
    if (values.json) console.log(JSON.stringify({ count: schemas.ids.length, schemas: schemas.ids }));
    else schemas.ids.forEach((id) => console.log(id));
    return 0;
  }

  if (command === 'workflow') {
    const paths = resolvePaths();
    const [sub, name] = rest;
    if (sub === 'list') {
      listWorkflows(paths.workflows).forEach((w) => console.log(w));
      return 0;
    }
    if (sub === 'validate') {
      const schemas = loadSchemas(paths.schemas);
      let failed = false;
      for (const w of name ? [name] : listWorkflows(paths.workflows)) {
        try {
          const wf = loadWorkflow(w, { workflowsDir: paths.workflows, schemas, agentsDir: paths.agents });
          console.log(`valid    ${w}  (${wf.steps.length} steps, ${wf.layers.length} layers)`);
        } catch (e) {
          failed = true;
          console.log(`INVALID  ${w}  ${e.message}`);
        }
      }
      return failed ? EXIT.failed : 0;
    }
    console.error('Usage: qa workflow list | qa workflow validate [name]');
    return EXIT.usage;
  }

  if (command === 'evidence') {
    const [sub, runId] = rest;
    if (sub !== 'verify' || !runId) {
      console.error('Usage: qa evidence verify <run-id>');
      return EXIT.usage;
    }
    const result = createEvidence(resolvePaths().evidence).verify(runId);
    console.log(result.ok ? `${runId}: evidence intact (${result.files} files)` : `${runId}: EVIDENCE PROBLEM\n  ${result.problems.join('\n  ')}`);
    return result.ok ? 0 : EXIT.failed;
  }

  const engine = createEngine();
  try {
    if (command === 'run') {
      const [name] = rest;
      if (!name) {
        console.error('Usage: qa run <workflow> [--param key=value]');
        return EXIT.usage;
      }
      const params = {};
      for (const pair of values.param) {
        const i = pair.indexOf('=');
        if (i < 1) throw new Error(`Invalid --param "${pair}", expected key=value`);
        params[pair.slice(0, i)] = pair.slice(i + 1);
      }
      const run = await engine.start(name, params);
      printRun(run, values.json);
      return exitFor(run);
    }
    if (command === 'status') {
      const [runId] = rest;
      if (runId) {
        const run = engine.status(runId);
        printRun(run, values.json);
        return 0;
      }
      const runs = engine.list(20);
      if (values.json) console.log(JSON.stringify(runs, null, 2));
      else if (!runs.length) console.log('No runs yet.');
      else runs.forEach((r) => console.log(`${r.id}  ${r.workflow.padEnd(20)} ${r.status.padEnd(9)} $${r.cost_usd.toFixed(4)}`));
      return 0;
    }
    if (command === 'approve' || command === 'reject') {
      const [runId] = rest;
      if (!runId) {
        console.error(`Usage: qa ${command} <run-id>${command === 'reject' ? ' --reason "..."' : ''}`);
        return EXIT.usage;
      }
      const decision = { approver: approverIdentity(), reason: values.reason };
      const run = command === 'approve' ? await engine.approve(runId, decision) : await engine.reject(runId, decision);
      printRun(run, values.json);
      return exitFor(run);
    }
    if (command === 'resume') {
      const run = await engine.resume(rest[0]);
      printRun(run, values.json);
      return exitFor(run);
    }
    if (command === 'halt' || command === 'unhalt') {
      engine[command]();
      console.log(command === 'halt' ? 'Halted. New runs and continuations are blocked.' : 'Unhalted. Runs may start.');
      return 0;
    }
    console.error(`Unknown command "${command}"\n\n${HELP}`);
    return EXIT.usage;
  } finally {
    engine.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(`qa: ${error.message}`);
    process.exit(EXIT.usage);
  },
);
