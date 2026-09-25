#!/usr/bin/env node
// PreToolUse hook. Runs for interactive sessions in this repository and for
// every agent the engine starts. Exit code 2 blocks the tool call.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendAudit } from '../../engine/audit.js';
import { loadConfig, REPO_ROOT } from '../../engine/config.js';
import { splitCommand } from '../../engine/template.js';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const tool = input.tool_name ?? '';
const args = input.tool_input ?? {};
const role = process.env.QA_AGENT_ROLE;

function block(reason) {
  process.stderr.write(`Blocked by QA Factory guard: ${reason}\n`);
  process.exit(2);
}

const SECRET_PATH = /(^|[/\\])(\.env(?!\.example\b)(\.[^/\\]*)?|\.ssh|\.aws|\.gnupg|\.netrc|id_(rsa|ed25519|ecdsa)[^/\\]*)([/\\]|$)/i;
// In a shell command a secret file can follow a space, a quote or an equals sign.
const SECRET_IN_COMMAND = /(^|[\s/\\'"=<])(\.env(?!\.example\b)(\.[^\s/\\'"]*)?|\.ssh|\.aws|\.gnupg|\.netrc|id_(rsa|ed25519|ecdsa)[^\s/\\'"]*)([\s/\\'"]|$)/i;
const GOVERNANCE_PATH = /(^|[/\\])(CLAUDE\.md|AGENTS\.md|qa\.config\.json|\.mcp\.json|\.claude|\.githooks|schemas|agents|workflows)([/\\]|$)/;

const DESTRUCTIVE = [
  [/(^|[\s;&|(])rm\s/, 'deleting files is a QA Lead action'],
  [/(^|[\s;&|(])rmdir\s/, 'deleting folders is a QA Lead action'],
  [/\bfind\b[^\n]*\s-delete\b/, 'deleting files is a QA Lead action'],
  [/\bgit\s+push\b[^\n]*(\s--force\b|\s-f\b|--force-with-lease)/, 'force-push is not allowed'],
  [/\bgit\s+push\b[^\n]*\s--delete\b/, 'deleting remote branches is a QA Lead action'],
  [/\bgit\s+reset\s+--hard\b/, 'hard reset discards work'],
  [/\bgit\s+clean\b/, 'git clean deletes untracked files'],
  [/\bgit\s+branch\s+-D\b/, 'force-deleting a branch loses unpushed commits'],
  [/\bgh\s+pr\s+merge\b/, 'merging is a QA Lead action'],
  [/\bgh\s+repo\s+delete\b/, 'deleting a repository is a QA Lead action'],
  [/\bsudo\b/, 'sudo is not allowed'],
  [/\bdrop\s+(table|database)\b/i, 'database deletion is a QA Lead action'],
];

const pathFields = ['file_path', 'path', 'notebook_path', 'pattern', 'glob'];
for (const field of pathFields) {
  if (typeof args[field] === 'string' && SECRET_PATH.test(args[field])) block(`"${args[field]}" may contain secrets`);
}

if (tool === 'Bash') {
  const command = String(args.command ?? '');
  if (SECRET_IN_COMMAND.test(command)) block('the command touches a file that may contain secrets');
  for (const [pattern, reason] of DESTRUCTIVE) if (pattern.test(command)) block(reason);
}

if (role) {
  // Agents never hold a shell; this is defence in depth behind restricted mode.
  if (tool === 'Bash') {
    let tokens;
    try {
      tokens = splitCommand(String(args.command ?? ''));
    } catch (e) {
      block(e.message);
    }
    const { runner } = loadConfig();
    if (!runner.allowlist.some((prefix) => prefix.every((part, i) => tokens[i] === part))) {
      block(`"${tokens.slice(0, 2).join(' ')}" is not on the allowlist`);
    }
    if (tokens[0] === 'qa' && ['approve', 'reject', 'halt', 'unhalt'].includes(tokens[1])) block('decisions belong to the QA Lead');
  }
  const writes = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool);
  if (writes && GOVERNANCE_PATH.test(String(args.file_path ?? args.notebook_path ?? ''))) {
    block('agents may not change the rules they are judged by');
  }
  // Record the intent before the call. If the audit log cannot be written,
  // the call does not happen.
  try {
    const dataRoot = process.env.QA_DATA_ROOT || REPO_ROOT;
    appendAudit(join(dataRoot, 'logs'), {
      source: 'hook',
      phase: 'pre',
      role,
      run: process.env.QA_RUN_ID,
      step: process.env.QA_STEP_ID,
      tool,
      input: JSON.stringify(args).slice(0, 2000),
    });
  } catch (e) {
    block(`audit log unavailable: ${e.message}`);
  }
}

process.exit(0);
