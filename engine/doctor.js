import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listAgents, loadAgent } from './agents.js';
import { loadConfig, resolvePaths } from './config.js';
import { minimalEnv, spawnCapture } from './exec.js';
import { loadMcpServers, mcpPolicyProblems } from './mcp.js';
import { loadSchemas } from './schemas.js';
import { listWorkflows, loadWorkflow } from './workflow.js';

const PASS = 'PASS';
const WARN = 'WARN';
const FAIL = 'FAIL';

async function tool(command, args) {
  return spawnCapture(command, args, { env: minimalEnv(), timeoutMs: 20000 });
}

async function probe(url) {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    return res.status < 500 ? { ok: true, detail: `HTTP ${res.status}` } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e.cause?.code ?? e.message };
  }
}

export async function runDoctor({ repoRoot, dataRoot, network = true } = {}) {
  const paths = resolvePaths({ repoRoot, dataRoot });
  const config = loadConfig(paths.repoRoot);
  const checks = [];
  const add = (name, status, detail, fix) => checks.push({ name, status, detail, ...(fix ? { fix } : {}) });

  const [major, minor] = process.versions.node.split('.').map(Number);
  // Only LTS lines are supported. Node 23 reached end of life on 2025-06-01.
  if (major < 24 || major % 2 === 1) add('Node version', FAIL, `${process.versions.node} is not a supported LTS line`, 'Install Node 24 LTS: brew install node@24');
  else add('Node version', PASS, `${process.versions.node} (LTS line)`);

  try {
    await import('node:sqlite');
    add('SQLite (node:sqlite)', PASS, 'available');
  } catch (e) {
    add('SQLite (node:sqlite)', FAIL, e.message, 'Use Node 22.13 or later');
  }

  const git = await tool('git', ['--version']);
  if (git.code === 0) add('git', PASS, git.stdout.trim());
  else if (/xcode/i.test(git.stderr)) add('git', FAIL, 'Xcode licence not accepted', 'sudo xcodebuild -license accept');
  else add('git', FAIL, git.stderr.trim() || git.spawnError || 'not available', 'Install git');

  if (git.code === 0) {
    const hooksPath = await spawnCapture('git', ['config', '--get', 'core.hooksPath'], { cwd: paths.repoRoot, env: minimalEnv() });
    if (hooksPath.stdout.trim() === '.githooks') add('git hooks', PASS, 'core.hooksPath = .githooks');
    else add('git hooks', WARN, 'the pre-push approval gate is not active', 'git config core.hooksPath .githooks');
  }

  const gh = await tool('gh', ['api', 'user', '--jq', '.login']);
  if (gh.spawnError) add('GitHub account', FAIL, 'gh CLI not installed', 'brew install gh');
  else if (gh.code !== 0) add('GitHub account', WARN, 'not logged in or offline', 'gh auth login');
  else if (gh.stdout.trim() !== config.github.owner) {
    add('GitHub account', FAIL, `active account is ${gh.stdout.trim()}, expected ${config.github.owner}`, `gh auth switch --user ${config.github.owner}`);
  } else add('GitHub account', PASS, gh.stdout.trim());

  const claude = await tool('claude', ['--help']);
  if (claude.spawnError) add('Claude Code', FAIL, 'claude CLI not found', 'Install Claude Code');
  else if (!claude.stdout.includes('--restricted') || !claude.stdout.includes('--strict-mcp-config')) {
    add('Claude Code', FAIL, 'this version lacks --restricted or --strict-mcp-config', 'Update Claude Code');
  } else {
    const version = await tool('claude', ['--version']);
    add('Claude Code', PASS, `${version.stdout.trim()}, restricted mode available`);
  }

  let schemas;
  try {
    schemas = loadSchemas(paths.schemas);
    add('Schemas', PASS, `${schemas.ids.length} compiled: ${schemas.ids.join(', ')}`);
  } catch (e) {
    add('Schemas', FAIL, e.message);
  }

  const agentProblems = [];
  for (const name of listAgents(paths.agents)) {
    try {
      loadAgent(paths.agents, name);
    } catch (e) {
      agentProblems.push(e.message);
    }
  }
  add('Agent definitions', agentProblems.length ? FAIL : PASS, agentProblems.join('; ') || `${listAgents(paths.agents).length} valid`);

  if (schemas) {
    const problems = [];
    for (const name of listWorkflows(paths.workflows)) {
      try {
        loadWorkflow(name, { workflowsDir: paths.workflows, schemas, agentsDir: paths.agents });
      } catch (e) {
        problems.push(e.message);
      }
    }
    add('Workflows', problems.length ? FAIL : PASS, problems.join('; ') || `${listWorkflows(paths.workflows).length} valid`);
  }

  const servers = loadMcpServers(paths.mcpConfig);
  const policy = mcpPolicyProblems(servers, config.mcp.allowed);
  add('MCP policy', policy.length ? FAIL : PASS, policy.join('; ') || `${Object.keys(servers).join(', ')} configured, versions pinned, GitHub read-only`);

  if (network) {
    for (const [name, server] of Object.entries(servers)) {
      if (!server.url) {
        add(`MCP ${name}`, PASS, `local server (${server.command} ${(server.args ?? []).find((a) => !a.startsWith('-'))}), started on demand`);
        continue;
      }
      const result = await probe(server.url);
      add(`MCP ${name}`, result.ok ? PASS : WARN, `${server.url} ${result.detail}`, result.ok ? undefined : 'Capability degraded; runs that need it report BLOCKED');
    }
  }

  const settingsFile = join(paths.repoRoot, '.claude', 'settings.json');
  const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
  const hookText = JSON.stringify(settings.hooks ?? {});
  const hooksOk = ['guard.js', 'audit.js'].every((f) => hookText.includes(f) && existsSync(join(paths.hooks, f)));
  add('Safety hooks', hooksOk ? PASS : FAIL, hooksOk ? 'guard and audit wired in .claude/settings.json' : 'guard or audit hook missing', hooksOk ? undefined : 'Restore .claude/settings.json');

  try {
    for (const dir of [paths.evidence, paths.logs]) {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
    }
    add('Data folders', PASS, `evidence and logs writable under ${paths.dataRoot}`);
  } catch (e) {
    add('Data folders', FAIL, e.message);
  }

  return { ok: !checks.some((c) => c.status === FAIL), checks };
}
