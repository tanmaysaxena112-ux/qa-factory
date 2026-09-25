import { spawnCapture } from '../exec.js';

// Restricted mode is the core of agent containment: no command-running tools,
// no user or project settings, file tools confined to the working directory,
// and bypassPermissions refused. Only the MCP servers and settings passed here
// exist for the agent.
export function buildClaudeArgs({ system, prompt, tools, mcpServers, mcpFile, settingsFile, schema, model, maxCostUsd }) {
  const args = [
    '-p', prompt,
    '--restricted',
    '--strict-mcp-config',
    '--mcp-config', mcpFile,
    '--settings', settingsFile,
    '--tools', tools.join(','),
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--output-format', 'json',
    '--no-session-persistence',
    '--system-prompt', system,
    '--model', model,
    '--max-budget-usd', String(maxCostUsd),
  ];
  const allowed = [...tools, ...mcpServers.map((s) => `mcp__${s}`)];
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  if (schema) {
    const { $id, $schema, title, ...shape } = schema;
    args.push('--json-schema', JSON.stringify(shape));
  }
  return args;
}

export function parseLooseJson(text) {
  const trimmed = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('Agent returned no JSON object');
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function createClaudeProvider({ binary = 'claude' } = {}) {
  return {
    name: 'claude',
    buildArgs: buildClaudeArgs,
    async invoke({ args, cwd, env, timeoutMs }) {
      const proc = await spawnCapture(binary, args, { cwd, env, timeoutMs });
      if (proc.spawnError) return { ok: false, error: `Could not start Claude Code: ${proc.spawnError}`, raw: proc.stderr };
      if (proc.timedOut) return { ok: false, error: `Agent timed out after ${timeoutMs} ms`, raw: proc.stdout };
      let raw;
      try {
        raw = JSON.parse(proc.stdout);
      } catch {
        return { ok: false, error: `Claude Code returned non-JSON output (exit ${proc.code})`, raw: `${proc.stdout}\n${proc.stderr}` };
      }
      const costUsd = Number(raw.total_cost_usd ?? 0);
      if (raw.is_error || proc.code !== 0) {
        return { ok: false, error: `Agent failed: ${raw.subtype ?? 'error'} ${raw.result ?? ''}`.trim(), raw, costUsd };
      }
      try {
        const output = raw.structured_output ?? parseLooseJson(raw.result);
        return { ok: true, output, raw, costUsd };
      } catch (e) {
        return { ok: false, error: e.message, raw, costUsd };
      }
    },
  };
}
