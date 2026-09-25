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
| Runners | Own API runner (Node `fetch` plus OpenAPI contract checks), Playwright 1.63, own WebDriver client with Appium 3 on Android | Allowlisted commands only, no shell, same command gives the same result |
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

Phases 0 to 4 are complete. The API lane has run end to end with real agents on the included demo shop (`projects/demo-shop`):

| Stage | What happened |
|---|---|
| PRD | The PRD Author drafted 4 requirements; the independent PRD Critic raised 14 issues; all were answered before approval |
| Test design | 28 cases from the Test Designer; the Edge Case Hunter added 6 and raised 3 open questions instead of guessing |
| Automation | First attempt rejected at the gate (invented placeholder syntax); rework produced 34 literal tests |
| Calibration | Failed closed on the first build: 4 tests exposed a real defect (unvalidated `product_id`) |
| Regression | Triage filed 4 findings in one root-cause cluster; the blind reviewer (Opus 5.5) rejected the release |
| After the fix | 34/34 pass, 16/16 criteria met, all 7 seeded faults caught; released with named risks |

Phase 2, the web lane, then ran the same pipeline on the shopping page:

| Stage | What happened |
|---|---|
| PRD | 9 requirements; the PRD Critic raised 22 issues, including invented behaviour and an unagreed merge gate |
| Test design | 46 cases plus 7 from the Edge Case Hunter; 3 dropped as not implementable or contradicting the PRD |
| Automation | Rework once to add keyboard, viewport, layout and request actions; 49 declarative tests |
| Calibration | Fault runs now stop at the first failure (35 minutes down to 2); 5/5 UI faults caught |
| Blind review | Caught a runner bug: only the first browser was counted, hiding failures in Firefox and WebKit. Fixed with an exact integrity check against Playwright's own totals |
| Release | 49/49 in Chromium, Firefox, WebKit and a Pixel 7 viewport; axe-core WCAG 2.2 AA clean; released with named risks |

Every step's evidence is sealed per run. Decisions made during development are recorded as made by Claude on behalf of the QA Lead, never as the QA Lead.

Phase 3, the mobile lane, ran the pipeline in real Chrome on an Android 15 emulator through Appium 3:

| Stage | What happened |
|---|---|
| PRD | Written with the web PRD as context, citing its criteria by ID; 7 critique issues resolved |
| Test design | First attempt rejected: the agents were not given the PRD it cites. Rework produced 39 cases plus 4 edge cases |
| Automation and calibration | Calibration failed closed; the healthy build had touch targets of 64x35 and 178x33 CSS px, below the 48x48 minimum |
| Regression | 4 findings, blind reviewer rejected; the fix passed 40/40 and the web visual check caught the layout change it caused |
| Certification | Mobile 40/40 with 4/4 faults, web 49/49 with 5/5, API 37/37 with 7/7 |

Phase 4, the always-on layer, turned runs into an operating platform:

| Capability | First result |
|---|---|
| Result history and flake detection | 28 runs, 123 tests, 0 flaky |
| Coverage map and drift alert | 52/52 criteria passing, no drift |
| Dashboard | All four quality targets from real data; escape rate 10 percent, shown in red |
| Performance, load and security scans | Lighthouse 100/100/96, k6 p95 0.8 ms over 896,180 requests; security scan found no security headers, then passed after the fix; ZAP blocked without Docker |
| Escape analysis | ESC-001 traced to a manual case nobody ran; the defect is now a seeded fault caught by a new automated test |
| Exploratory agent | 162 audited browser actions on money and quantities, no contradiction found |
| Golden run | Full suite plus API and web calibration in one command |
| CI and nightly | GitHub Actions workflows; nightly on a self-hosted Mac, never on pull requests |

## Documentation

`docs/engine.md` · `docs/security.md` · `docs/gates.md` · `docs/quality-targets.md` · `docs/test-design-techniques.md` · `docs/prd-standard.md` · `docs/conventions.md`
