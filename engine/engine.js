import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendAudit } from './audit.js';
import { loadConfig, resolvePaths } from './config.js';
import { createEvidence } from './evidence.js';
import { createClaudeProvider } from './providers/claude.js';
import { createStubProvider } from './providers/stub.js';
import { loadSchemas } from './schemas.js';
import { agentStep, runStep } from './steps.js';
import { openStore } from './store.js';
import { loadWorkflow, stepKind } from './workflow.js';

const TERMINAL = new Set(['completed', 'failed', 'rejected']);

function selectProvider(config, env) {
  const name = env.QA_AGENT_PROVIDER ?? config.agent.provider;
  if (name === 'claude') return createClaudeProvider();
  if (name === 'stub') {
    if (!env.QA_AGENT_STUB_DIR) throw new Error('QA_AGENT_STUB_DIR is required for the stub provider');
    return createStubProvider({ dir: env.QA_AGENT_STUB_DIR });
  }
  throw new Error(`Unknown agent provider "${name}"`);
}

export function createEngine({ repoRoot, dataRoot, env = process.env } = {}) {
  const paths = resolvePaths({ repoRoot, dataRoot });
  const config = loadConfig(paths.repoRoot);
  const schemas = loadSchemas(paths.schemas);
  const store = openStore(paths.db);
  const evidence = createEvidence(paths.evidence);
  const audit = (entry) => appendAudit(paths.logs, { source: 'engine', ...entry });
  let provider;
  const getProvider = () => (provider ??= selectProvider(config, env));

  const isHalted = () => store.getControl('halt') === 'on';
  const frozenWorkflow = (runId) => JSON.parse(readFileSync(join(evidence.runDir(runId), 'workflow.json'), 'utf8'));

  // Step records hold { value, files }. Templates see ${steps.<id>.output...}
  // for the value and ${steps.<id>.stdout_file} and similar for evidence files.
  function context(run) {
    const steps = {};
    for (const s of store.getSteps(run.id)) {
      if (s.status === 'completed') steps[s.step_id] = { output: s.output?.value ?? null, ...(s.output?.files ?? {}) };
    }
    return { params: run.params, run: { id: run.id, dir: evidence.runDir(run.id) }, steps };
  }

  function finish(runId, status, error = null) {
    for (const s of store.getSteps(runId)) {
      if (['pending', 'waiting'].includes(s.status)) store.setStepStatus(runId, s.step_id, 'skipped');
    }
    store.setRunStatus(runId, status, error);
    const run = store.getRun(runId);
    evidence.write(runId, 'run-summary.json', {
      run_id: runId,
      workflow: run.workflow,
      status,
      error,
      cost_usd: run.cost_usd,
      steps: store.getSteps(runId).map(({ step_id, kind, status: st, error: err, cost_usd, started_at, ended_at }) => ({
        step_id, kind, status: st, error: err, cost_usd, started_at, ended_at,
      })),
      decisions: store.getSteps(runId).map((s) => store.getDecision(runId, s.step_id)).filter(Boolean),
    });
    evidence.seal(runId);
    audit({ event: 'run_end', run: runId, status, error });
  }

  async function executeStep(run, workflow, stepId) {
    const step = workflow.steps.find((s) => s.id === stepId);
    const record = store.getStep(run.id, stepId);
    if (['completed', 'skipped'].includes(record.status)) return record.status;
    const kind = stepKind(step);

    if (kind === 'gate') {
      const decision = store.getDecision(run.id, stepId);
      if (!decision) {
        store.setStepStatus(run.id, stepId, 'waiting');
        audit({ event: 'gate_waiting', run: run.id, step: stepId });
        return 'waiting';
      }
      const value = { decision: decision.decision, approver: decision.approver, reason: decision.reason, decided_at: decision.decided_at };
      store.finishStep(run.id, stepId, { status: decision.decision === 'approve' ? 'completed' : 'failed', output: { value, files: null } });
      return decision.decision === 'approve' ? 'completed' : 'rejected';
    }

    store.startStep(run.id, stepId);
    audit({ event: 'step_start', run: run.id, step: stepId, kind, agent: step.agent });
    const args = { step, ctx: context(run), runId: run.id, config, paths, evidence, schemas };
    let result;
    try {
      result = kind === 'run' ? await runStep(args) : await agentStep({ ...args, provider: getProvider() });
    } catch (e) {
      result = { status: 'failed', error: e.message };
    }
    store.finishStep(run.id, stepId, {
      status: result.status,
      output: { value: result.output ?? null, files: result.files ?? null },
      error: result.error ?? null,
      costUsd: result.costUsd ?? 0,
    });
    if (result.costUsd) store.addRunCost(run.id, result.costUsd);
    audit({ event: 'step_end', run: run.id, step: stepId, kind, status: result.status, error: result.error, cost_usd: result.costUsd ?? 0 });
    return result.status;
  }

  async function execute(runId) {
    const workflow = frozenWorkflow(runId);
    store.setRunStatus(runId, 'running');
    for (const layer of workflow.layers) {
      if (isHalted()) {
        store.setRunStatus(runId, 'halted', 'Platform halted; run qa unhalt then qa resume');
        audit({ event: 'run_halted', run: runId });
        return status(runId);
      }
      const run = store.getRun(runId);
      const outcomes = await Promise.all(layer.map((id) => executeStep(run, workflow, id)));
      if (outcomes.includes('failed')) {
        finish(runId, 'failed', 'A step failed');
        return status(runId);
      }
      if (outcomes.includes('rejected')) {
        finish(runId, 'rejected', 'Rejected at a QA Lead gate');
        return status(runId);
      }
      const cost = store.getRun(runId).cost_usd;
      if (workflow.max_cost_usd && cost > workflow.max_cost_usd) {
        finish(runId, 'failed', `Run cost ${cost} exceeded the cap of ${workflow.max_cost_usd}`);
        return status(runId);
      }
      if (outcomes.includes('waiting')) {
        store.setRunStatus(runId, 'paused', 'Waiting for QA Lead approval');
        return status(runId);
      }
    }
    finish(runId, 'completed');
    return status(runId);
  }

  function status(runId) {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    return { ...run, steps: store.getSteps(runId), evidence: evidence.runDir(runId) };
  }

  function waitingGate(runId) {
    const run = store.getRun(runId);
    if (!run) throw new Error(`Unknown run ${runId}`);
    if (run.status !== 'paused') throw new Error(`${runId} is ${run.status}, not waiting for approval`);
    const gate = store.getSteps(runId).find((s) => s.status === 'waiting');
    if (!gate) throw new Error(`${runId} has no gate waiting for a decision`);
    return gate;
  }

  // Agents run with QA_AGENT_ROLE set. A decision can never come from one.
  function assertHuman() {
    if (env.QA_AGENT_ROLE) throw new Error('Decisions can only be made by a person, not by an agent');
  }

  return {
    paths,
    schemas,
    store,
    evidence,
    isHalted,

    async start(name, params = {}) {
      if (isHalted()) throw new Error('Platform is halted; run qa unhalt first');
      const workflow = loadWorkflow(name, { workflowsDir: paths.workflows, schemas, agentsDir: paths.agents });
      const resolved = {};
      for (const key of Object.keys(params)) if (!(key in workflow.params)) throw new Error(`Unknown param "${key}" for ${name}`);
      for (const [key, spec] of Object.entries(workflow.params)) {
        const value = params[key] ?? spec.default;
        if (value === undefined && spec.required) throw new Error(`Missing required param "${key}" for ${name}`);
        if (value !== undefined) resolved[key] = value;
      }
      const runId = store.nextRunId();
      evidence.init(runId);
      evidence.write(runId, 'workflow.json', workflow);
      evidence.write(runId, 'params.json', resolved);
      store.createRun({ id: runId, workflow: name, params: resolved, steps: workflow.steps.map((s) => ({ id: s.id, kind: stepKind(s) })) });
      audit({ event: 'run_start', run: runId, workflow: name });
      return execute(runId);
    },

    async approve(runId, { approver, reason } = {}) {
      assertHuman();
      if (!approver) throw new Error('An approver identity is required');
      const gate = waitingGate(runId);
      store.recordDecision({ runId, stepId: gate.step_id, decision: 'approve', approver, reason });
      audit({ event: 'gate_decision', run: runId, step: gate.step_id, decision: 'approve', approver });
      return execute(runId);
    },

    async reject(runId, { approver, reason } = {}) {
      assertHuman();
      if (!approver) throw new Error('An approver identity is required');
      if (!reason) throw new Error('A reason is required to reject');
      const gate = waitingGate(runId);
      store.recordDecision({ runId, stepId: gate.step_id, decision: 'reject', approver, reason });
      store.finishStep(runId, gate.step_id, { status: 'failed', output: { value: { decision: 'reject', approver, reason }, files: null } });
      audit({ event: 'gate_decision', run: runId, step: gate.step_id, decision: 'reject', approver });
      finish(runId, 'rejected', `Rejected by ${approver}: ${reason}`);
      return status(runId);
    },

    async resume(runId) {
      const run = store.getRun(runId);
      if (!run) throw new Error(`Unknown run ${runId}`);
      if (run.status !== 'halted') throw new Error(`${runId} is ${run.status}; only halted runs resume`);
      if (isHalted()) throw new Error('Platform is still halted; run qa unhalt first');
      return execute(runId);
    },

    status,
    list: (limit) => store.listRuns(limit),

    halt() {
      assertHuman();
      store.setControl('halt', 'on');
      audit({ event: 'halt' });
    },

    unhalt() {
      assertHuman();
      store.setControl('halt', 'off');
      audit({ event: 'unhalt' });
    },

    isTerminal: (runId) => TERMINAL.has(store.getRun(runId)?.status),
    close: () => store.close(),
  };
}
