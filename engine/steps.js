import { isAbsolute, join, relative, resolve } from 'node:path';
import { loadAgent } from './agents.js';
import { minimalEnv, spawnCapture } from './exec.js';
import { envNamesFor, loadMcpServers, mcpPolicyProblems, pickServers } from './mcp.js';
import { splitCommand, substitute } from './template.js';
import { startLocalApp } from '../runners/app.js';
import { loadProject, projectEnv } from '../runners/project.js';

function resolveCommand(tokens, allowlist, paths) {
  const permitted = allowlist.some((prefix) => prefix.every((part, i) => tokens[i] === part));
  if (!permitted) throw new Error(`Command "${tokens.slice(0, 2).join(' ')}" is not on the runner allowlist`);
  if (tokens[0] === 'qa') return [process.execPath, ['--no-warnings=ExperimentalWarning', paths.cli, ...tokens.slice(1)]];
  return [tokens[0], tokens.slice(1)];
}

export async function runStep({ step, ctx, runId, config, paths, evidence, schemas }) {
  const tokens = splitCommand(step.run).map((t) => substitute(t, ctx));
  const [command, args] = resolveCommand(tokens, config.runner.allowlist, paths);
  const timeoutMs = (step.timeout_seconds ?? config.runner.timeoutSeconds) * 1000;
  const env = minimalEnv({ QA_DATA_ROOT: paths.dataRoot, QA_RUN_ID: runId, QA_STEP_ID: step.id }, step.env ?? []);
  const proc = await spawnCapture(command, args, { cwd: paths.repoRoot, env, timeoutMs });

  const dir = `steps/${step.id}`;
  const stdoutFile = evidence.write(runId, `${dir}/stdout.txt`, proc.stdout);
  const stderrFile = evidence.write(runId, `${dir}/stderr.txt`, proc.stderr);
  evidence.write(runId, `${dir}/exit.json`, {
    argv: tokens,
    exit_code: proc.code,
    timed_out: proc.timedOut,
    truncated: proc.truncated,
    duration_ms: proc.durationMs,
  });
  const files = { stdout_file: stdoutFile, stderr_file: stderrFile };

  if (proc.spawnError) return { status: 'failed', error: `Could not start "${tokens[0]}": ${proc.spawnError}`, files };
  if (proc.timedOut) return { status: 'failed', error: `Timed out after ${timeoutMs} ms`, files };
  if (proc.truncated) return { status: 'failed', error: 'Output exceeded the capture limit; write results to files instead', files };
  if (proc.code !== 0) return { status: 'failed', error: `Exited with code ${proc.code}`, files };

  if (!step.output) return { status: 'completed', output: null, files };
  let output;
  try {
    output = JSON.parse(proc.stdout);
  } catch {
    return { status: 'failed', error: `Declared output ${step.output} but stdout is not JSON`, files };
  }
  const check = schemas.validate(step.output, output);
  if (!check.ok) return { status: 'failed', error: `Output does not match ${step.output}: ${check.errors.join('; ')}`, files };
  return { status: 'completed', output, files };
}

function confine(dir, paths) {
  const abs = resolve(isAbsolute(dir) ? dir : join(paths.repoRoot, dir));
  const inside = [paths.repoRoot, paths.dataRoot].some((root) => {
    const rel = relative(root, abs);
    return !rel.startsWith('..') && !isAbsolute(rel);
  });
  if (!inside) throw new Error(`Agent working directory must be inside the platform: ${dir}`);
  return abs;
}

function agentSettings(paths) {
  const hook = (file) => [{ matcher: '*', hooks: [{ type: 'command', command: `node "${join(paths.hooks, file)}"` }] }];
  return {
    permissions: { deny: ['Read(**/.env)', 'Read(**/.env.*)'] },
    hooks: { PreToolUse: hook('guard.js'), PostToolUse: hook('audit.js') },
  };
}

// An agent step can ask for the project's app to run for its duration, for
// example an exploratory session. The browser server is then limited to that
// origin and writes its screenshots into the step's evidence.
export async function agentStep(args) {
  const { step, ctx, paths } = args;
  if (!step.app) return agentStepInner(args);
  const project = loadProject(paths.repoRoot, substitute(step.app.project, ctx));
  const env = projectEnv(project, step.app.env ? substitute(step.app.env, ctx) : 'dev');
  const app = await startLocalApp(paths.repoRoot, env.local_app);
  if (!app.ok) return { status: 'failed', error: `BLOCKED: app unavailable: ${app.detail}` };
  try {
    return await agentStepInner({ ...args, ctx: { ...ctx, app: { url: app.baseUrl, build: app.build } } });
  } finally {
    await app.stop();
  }
}

async function agentStepInner({ step, ctx, runId, config, paths, evidence, schemas, provider }) {
  const agent = loadAgent(paths.agents, step.agent);
  const allServers = loadMcpServers(paths.mcpConfig);
  const problems = mcpPolicyProblems(pickServers(allServers, agent.mcp), config.mcp.allowed);
  if (problems.length) return { status: 'failed', error: `MCP policy: ${problems.join('; ')}` };
  const servers = JSON.parse(JSON.stringify(pickServers(allServers, agent.mcp)));
  if (ctx.app && servers.playwright) {
    servers.playwright.args = [...servers.playwright.args, '--allowed-origins', new URL(ctx.app.url).origin, '--output-dir', evidence.runDir(runId) + `/steps/${step.id}/browser`];
  }

  const dir = `steps/${step.id}`;
  const cwd = confine(step.cwd ? substitute(step.cwd, ctx) : evidence.runDir(runId), paths);
  const prompt = substitute(step.prompt, ctx, { fence: true });
  const schema = schemas.bundle(step.output);
  const mcpFile = evidence.write(runId, `${dir}/mcp.json`, { mcpServers: servers });
  const settingsFile = evidence.write(runId, `${dir}/settings.json`, agentSettings(paths));

  const args = provider.buildArgs({
    system: agent.system,
    prompt,
    tools: agent.tools,
    mcpServers: agent.mcp,
    mcpFile,
    settingsFile,
    schema,
    model: agent.model,
    maxCostUsd: agent.max_cost_usd,
  });
  const env = minimalEnv(
    { TERM: 'dumb', QA_AGENT_ROLE: agent.name, QA_RUN_ID: runId, QA_STEP_ID: step.id, QA_DATA_ROOT: paths.dataRoot },
    envNamesFor(servers),
  );
  evidence.write(runId, `${dir}/invocation.json`, { provider: provider.name, agent: agent.name, model: agent.model, cwd, args });

  const timeoutMs = (step.timeout_seconds ?? config.agent.timeoutSeconds) * 1000;
  const result = await provider.invoke({ args, cwd, env, timeoutMs });
  const costUsd = result.costUsd ?? 0;
  if (result.raw !== undefined) evidence.write(runId, `${dir}/agent-result.json`, result.raw);
  if (!result.ok) return { status: 'failed', error: result.error, costUsd };
  if (costUsd > agent.max_cost_usd) return { status: 'failed', error: `Cost ${costUsd} exceeded the cap of ${agent.max_cost_usd}`, costUsd };

  const check = schemas.validate(step.output, result.output);
  if (!check.ok) return { status: 'failed', error: `Output does not match ${step.output}: ${check.errors.join('; ')}`, costUsd };
  evidence.write(runId, `${dir}/output.json`, result.output);
  return { status: 'completed', output: result.output, costUsd };
}
