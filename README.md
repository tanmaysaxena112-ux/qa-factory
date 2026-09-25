# QA Factory

An AI QA department run by one human QA Lead.

> Agents reason. Runners execute. Files prove. A blind reviewer judges. The human decides.

AI agents write and review tests fast, but an agent that grades its own work, skips a step or reports a result it never produced is worse than no automation. QA Factory is built so that cannot happen: a deterministic engine owns the process, agents are contained, every result is backed by sealed evidence, and every release decision is made by a person.

## How it works

```
PRD → critique → test cases → edge case hunt → automation → calibration
    → plan → execution → evidence → triage → blind review → report → QA Lead
```

| Layer | Job | Can it be talked out of the rules? |
|---|---|---|
| Engine | Runs workflow steps in order, holds gates, records everything | No. Plain code reading a validated workflow file. |
| Agents | Write PRDs, test cases, triage failures, review evidence | Contained: restricted Claude Code, no shell, only named MCP servers, confined to one folder |
| Runners | Own API runner (Node `fetch` plus OpenAPI contract checks), Playwright, WebdriverIO 9 + Appium 3 | Allowlisted commands only, no shell, same command gives the same result |
| Evidence | Every output of every run | Redacted, written once, hashed and sealed; tampering is detected |
| QA Lead | Approves gates, merges, releases | The only one who can. Agents are refused by the engine and by hooks. |

## What makes it trustworthy

- **Containment is tested, not assumed.** Agents run in Claude Code restricted mode with their working directory set to the run's evidence folder. A probe agent told to read a file outside that folder is denied by Claude Code itself.
- **Contracts, not prose.** Every agent output is validated against a strict JSON Schema. A result without an artefact is `NOT_RUN`; a missing capability is `BLOCKED`; an unprovable field reads `UNKNOWN`.
- **No invented expected results.** Every test case cites the acceptance criterion it proves. Undefined behaviour goes back to the PRD as an open question.
- **Measured thoroughness.** Requirement coverage, fault detection rate from seeded faults, verdict accuracy from human audit, and defect escape rate. See `docs/quality-targets.md`.
- **Everything audited.** Every agent tool call is logged before and after it runs. If the log cannot be written, the call is refused.

## Quick start

Requirements: Node 24 LTS, Claude Code 2.1.248 or later (restricted mode), GitHub CLI.

```bash
npm install
npm test
npm run qa -- doctor
npm run qa -- run selftest            # pauses at the QA Lead gate
npm run qa -- approve RUN-YYYY-MMDD-001
npm run qa -- evidence verify RUN-YYYY-MMDD-001
```

## Status

Phase 0, the foundation, is complete: engine, contracts, containment, hooks, evidence sealing and health checks. Next: the API lane end to end on a public demo application.

## Documentation

`docs/engine.md` · `docs/security.md` · `docs/gates.md` · `docs/quality-targets.md` · `docs/test-design-techniques.md` · `docs/prd-standard.md` · `docs/conventions.md`
