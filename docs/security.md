# Security

## Agent containment

Every agent is started with:

| Control | Effect |
|---|---|
| `--restricted` | No command-running tools, no web fetch, no user or project settings, file tools confined to the working directory, bypass mode refused |
| Working directory = the run's evidence folder | The agent can read only that run's evidence. Verified: a read of a file outside the folder is denied. |
| `--tools` from the role file | Only the listed built-in tools exist |
| `--strict-mcp-config` + a per-step MCP file | Only the role's MCP servers exist |
| `--settings` with guard and audit hooks | Every tool call is checked before and logged after |
| `--permission-mode dontAsk`, `--permission-prompts none` | Nothing is approved interactively |
| `--no-session-persistence` | No transcript is saved for later sessions to read |
| `--max-budget-usd` from the role file | Spend cap per call |
| Minimal environment | Only PATH, HOME and similar, plus variables the role's MCP servers need |

Agent roles may never list `Bash`, `WebFetch`, `WebSearch` or sub-agent tools; the loader refuses them.

## Web runner

Web tests are data compiled into Playwright specs; every value enters the generated code through JSON encoding, so test content cannot become code. Specs run in a cache folder inside the repository and every generated file is copied into the run's evidence. Browsers run headless against the local app only. Screenshots cannot be redacted, which is why only dev and UAT test accounts may ever appear in a web session.

## Guard hook

`.claude/hooks/guard.js` runs before every tool call, for agents and for interactive sessions in this repository.

- Everyone: no `.env` files, SSH or cloud credentials; no `rm`, force-push, hard reset, `git clean`, branch force-delete, remote branch delete, `gh pr merge`, `sudo` or database drops.
- Agents additionally: commands must match the runner allowlist with no shell operators; `qa approve`, `reject`, `halt` and `unhalt` are refused; files that define the rules (`CLAUDE.md`, `.claude/`, `schemas/`, `agents/`, `workflows/`, `qa.config.json`, `.mcp.json`, `.githooks/`) cannot be edited.
- For agents, the call is written to the audit log before it runs. If the log cannot be written, the call is refused.

## Audit

`logs/agent-calls.jsonl`: engine events (run start, step start and end, gate decisions, halt) and hook events (every tool call before and after, with a hash of the result). All lines are redacted.

## Secrets

Workflows name environment variables (`env: [NAME]`). Runner steps receive only those names. Agents never receive them unless an MCP server they use needs one. Redaction runs on every file and log line before it is written: known token formats, `Bearer` values, `password=` style pairs and the values of any environment variable whose name marks it as secret.

## MCP register

| Server | Access | Notes |
|---|---|---|
| github | Read-only (`X-MCP-Readonly: true`) | Token from `GITHUB_MCP_TOKEN`, a fine-grained read-only token |
| playwright | `@playwright/mcp@0.0.82`, headless, isolated profile | Exploration only, never suite execution. Its origin allowlist is not a security boundary, so only dev and UAT credentials may exist in its sessions. |
| figma | Read-only use | Design input |
| context7 | Read-only | Library documentation |

Versions are pinned; upgrades are pull requests. `qa doctor` fails on any server outside this list, an unpinned package or a GitHub server without the read-only header.

Not adopted: Filesystem MCP (built-in file tools cover it), duplicate Figma and ClickUp servers, Exa, Ref, sequential-thinking, IDE code execution, Claude in Chrome, mail and chat servers, Postman, memory or vector servers.

## Approval gate on a free GitHub plan

Private repositories on the free plan cannot use branch protection. `.githooks/pre-push` blocks pushes to `main` unless the person pushing sets `QA_LEAD_PUSH=yes`. Agents cannot set it: the guard refuses any command that does not start with an allowlisted program. Enable with `git config core.hooksPath .githooks`; `qa doctor` warns when it is not set.
