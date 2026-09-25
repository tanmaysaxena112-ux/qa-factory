const PLACEHOLDER = /\$\{([A-Za-z0-9_.-]+)\}/g;

export function references(text) {
  return [...String(text).matchAll(PLACEHOLDER)].map((m) => m[1]);
}

function lookup(ctx, path) {
  let value = ctx;
  for (const part of path.split('.')) {
    if (value === null || typeof value !== 'object' || !(part in value)) {
      throw new Error(`Unknown reference \${${path}}`);
    }
    value = value[part];
  }
  return value;
}

// With fence set, values that came from earlier steps are wrapped as data. Step
// output can contain text from untrusted sources and must never read as an
// instruction to the next agent.
export function substitute(text, ctx, { fence = false } = {}) {
  return String(text).replace(PLACEHOLDER, (_, path) => {
    const value = lookup(ctx, path);
    const rendered = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (fence && path.startsWith('steps.')) {
      return `\n<data source="${path}">\n${rendered}\n</data>\n`;
    }
    return rendered;
  });
}

// Tokenises a command without a shell. Shell operators are rejected rather than
// interpreted, so a substituted value can never chain a second command.
export function splitCommand(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let inToken = false;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else current += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inToken = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (c === '\n') throw new Error('Command may not contain a newline');
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
      continue;
    }
    if (';&|<>`'.includes(c) || (c === '$' && command[i + 1] === '(')) {
      throw new Error(`Command may not contain shell operator "${c}"`);
    }
    current += c;
    inToken = true;
  }
  if (quote) throw new Error('Unterminated quote in command');
  if (inToken) tokens.push(current);
  if (!tokens.length) throw new Error('Empty command');
  return tokens;
}
