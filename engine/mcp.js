import { existsSync, readFileSync } from 'node:fs';

export function loadMcpServers(file) {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8')).mcpServers ?? {};
}

// The register is policy: one server per capability, versions pinned, GitHub
// read-only. A server being configured somewhere else grants nothing.
export function mcpPolicyProblems(servers, allowed) {
  const problems = [];
  for (const [name, server] of Object.entries(servers)) {
    if (!allowed.includes(name)) problems.push(`"${name}" is not in the allowed list`);
    if (server.command === 'npx') {
      const pkg = (server.args ?? []).find((a) => !a.startsWith('-'));
      if (!pkg || !/^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+$/.test(pkg)) {
        problems.push(`"${name}" must pin an exact package version (got "${pkg ?? 'none'}")`);
      }
    }
  }
  const github = servers.github;
  if (github && github.headers?.['X-MCP-Readonly'] !== 'true') problems.push('"github" must send X-MCP-Readonly: true');
  return problems;
}

export function pickServers(servers, names) {
  const picked = {};
  for (const name of names) {
    if (!servers[name]) throw new Error(`MCP server "${name}" is not configured in .mcp.json`);
    picked[name] = servers[name];
  }
  return picked;
}

export function envNamesFor(servers) {
  const names = new Set();
  for (const match of JSON.stringify(servers).matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) names.add(match[1]);
  return [...names];
}
