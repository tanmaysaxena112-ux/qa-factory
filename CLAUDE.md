# QA Factory

An AI QA department run by one human QA Lead. It turns an approved PRD into tested, evidenced and independently reviewed results. It serves every project the Lead takes on; nothing outside `projects/<name>/` may name a client, product or environment.

## Governing principle

Agents reason. Runners execute. Files prove. A blind reviewer judges. The human decides.

No result counts unless it was read back from an artefact on disk. A claim without a cited artefact is struck.

## Pipeline

Grooming → PRD → PRD critique → test cases → edge case hunt → automation → calibration → test plan → execution → evidence → triage → blind review → report → QA Lead decision → escape analysis.

Every stage is gated. Full gate definitions: `docs/gates.md`.

## Hard rules

1. No test case against a PRD that is not approved (merged by the QA Lead).
2. No automated test without an existing, approved test case.
3. No agent invents an expected result. Every case cites its oracle: the acceptance criterion it comes from. Undefined behaviour becomes an open question on the PRD.
4. A missing capability is `BLOCKED`, never `PASS` or `FAIL`. A result with no artefact is `NOT_RUN`.
5. Unknown is a valid value. A defect field that evidence cannot fill reads `UNKNOWN`. Never fabricate reproduction steps.
6. The blind reviewer receives only the evidence folder, the requirement and its checklist. Never another agent's reasoning.
7. Rework is capped at two cycles, then it escalates to the QA Lead.
8. Only the QA Lead approves gates, merges to `main`, deletes anything or touches configuration.
9. Dev and UAT only. Never production.
10. Secrets never enter model context. Steps name an environment variable; the runner resolves it.
11. Do not rename a requirement ID. Supersede it and record the change.
12. Bluetooth and other hardware flows are manual and reported as manual.

Rules that code can enforce live in code: hooks in `.claude/hooks/`, validators in `engine/`, schemas in `schemas/`. Do not restate them as prose here.

## Where things live

| Concern | Path |
|---|---|
| Engine | `engine/` |
| `qa` CLI | `cli/bin/qa.js` |
| Contract schemas | `schemas/qa.<contract>.v<n>.json` |
| Agent roles | `agents/<role>.md` |
| Workflows | `workflows/<name>.yaml` |
| Safety hooks | `.claude/hooks/` |
| MCP register | `.mcp.json` (policy in `docs/security.md`) |
| Per-project data | `projects/<name>/` |
| Evidence (not committed) | `evidence/<run-id>/` |
| Audit log (not committed) | `logs/agent-calls.jsonl` |

## Commands

```bash
npm test                                   # full test suite
npm run qa -- doctor                       # health check; must pass before any run
npm run qa -- run <workflow> --param k=v   # prd, design-cases, automate(-web|-mobile), api/web/mobile-regression, calibrate, scans, explore, escape-analysis, golden
npm run qa -- approve <run>                # QA Lead decision
npm run qa -- prd validate --project <p>   # PRD standard
npm run qa -- cases validate --project <p> # oracles and coverage
npm run qa -- api validate --project <p>   # every API test implements an approved case
npm run qa -- web validate --project <p>   # every web test implements an approved case
npm run qa -- mobile validate --project <p> # every mobile test implements an approved case
npm run qa -- dashboard --project <p>       # quality targets, calibration, coverage, runs
npm run qa -- run golden --param project=<p> # re-prove the platform after any upgrade
```

Full reference: `docs/engine.md`.

## Load when needed

- `docs/gates.md`: every gate and what blocks it
- `docs/conventions.md`: IDs, naming, branches
- `docs/security.md`: agent containment, MCP policy, secrets
- `docs/quality-targets.md`: the four measured targets
- `docs/test-design-techniques.md`: the edge case catalogue
- `docs/prd-standard.md`: how a PRD is written
- `docs/engine.md`: workflows, steps, exit codes

## Working agreement

Present the approach and get the QA Lead's approval before new agents, workflows, schema changes, MCP servers or CLI commands. Research first, propose second, implement third.

## Writing

Plain, precise English. No contractions. No filler. Comments explain a non-obvious reason, never what the code does.
