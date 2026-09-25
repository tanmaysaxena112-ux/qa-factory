import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

const ALLOWED_KEYS = new Set(['name', 'description', 'tools', 'mcp', 'model', 'max_cost_usd']);
// Tools that run code or reach the network are never granted to an agent.
// Execution belongs to runners; outbound calls belong to named MCP servers.
const FORBIDDEN_TOOLS = new Set(['Bash', 'PowerShell', 'REPL', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit']);

export function parseAgent(text, source) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${source}: missing front matter`);
  const meta = YAML.parse(match[1]) ?? {};
  for (const key of Object.keys(meta)) if (!ALLOWED_KEYS.has(key)) throw new Error(`${source}: unknown key "${key}"`);
  for (const key of ['name', 'description', 'model']) {
    if (typeof meta[key] !== 'string' || !meta[key]) throw new Error(`${source}: "${key}" is required`);
  }
  if (!Array.isArray(meta.tools)) throw new Error(`${source}: "tools" must be a list`);
  if (!Array.isArray(meta.mcp)) throw new Error(`${source}: "mcp" must be a list`);
  for (const tool of meta.tools) if (FORBIDDEN_TOOLS.has(tool)) throw new Error(`${source}: tool "${tool}" is not allowed for agents`);
  if (typeof meta.max_cost_usd !== 'number' || meta.max_cost_usd <= 0) throw new Error(`${source}: "max_cost_usd" must be a positive number`);
  const system = match[2].trim();
  if (!system) throw new Error(`${source}: the role instructions are empty`);
  return { ...meta, system };
}

export function loadAgent(agentsDir, name) {
  const file = join(agentsDir, `${name}.md`);
  if (!existsSync(file)) throw new Error(`Unknown agent "${name}"`);
  const agent = parseAgent(readFileSync(file, 'utf8'), `agents/${name}.md`);
  if (agent.name !== name) throw new Error(`agents/${name}.md: name must be "${name}"`);
  return agent;
}

export function listAgents(agentsDir) {
  return readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
}
