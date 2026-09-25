# Gates

Every gate blocks progress. None has an exception.

| # | Stage | Gate | Enforced by |
|---|---|---|---|
| 1 | Intake | Grooming complete; project `MISSION.md` exists | QA Lead |
| 2 | PRD | Validator passes; zero open questions; every requirement has at least one acceptance criterion; high-risk requirements name their risk reasons | `qa.prd.v1` schema, PRD validator (phase 1), merge by QA Lead |
| 3 | PRD critique | Every gap raised by the PRD Critic is answered or recorded as an open question | QA Lead |
| 4 | Test cases | Every acceptance criterion has a case on every relevant surface; every case cites its oracle | Coverage check (phase 1), QA Lead approval |
| 5 | Edge case hunt | Technique checklist complete for high-risk requirements; undefined behaviour returned to the PRD | QA Lead approval |
| 6 | Automation | Each test names its case ID; pull request merged by the QA Lead | Validator, pre-push gate |
| 7 | Calibration | Fault detection rate at or above target; a suite that misses seeded faults is fixed first | `qa calibrate` (phase 1) |
| 8 | Test plan | `qa doctor` and `qa preflight` pass, otherwise the run is `BLOCKED` | Engine |
| 9 | Execution | Runners only; results written to files | Engine allowlist |
| 10 | Evidence | Every result cites an artefact; missing capability is `BLOCKED` | `qa.result.v1` schema, sealing |
| 11 | Triage | Unprovable fields read `UNKNOWN`; "environment" needs evidence | `qa.finding.v1` schema |
| 12 | Blind review | Verdict is one of six values; at least one pass and one fail re-run; two reviewers for high risk | `qa.review.v1` schema, containment |
| 13 | Report | Every number cites a file | Reporter checks (phase 1) |
| 14 | QA Lead decision | Recorded approve or reject with identity and time | Engine gate |
| 15 | Escape analysis | Proposals only; the QA Lead accepts each one | QA Lead |

Rework after `REWORK_REQUIRED` is capped at two cycles, then escalates to the QA Lead.

A release cannot be approved with risks while a manual case covering a high-risk requirement or a security-relevant edge case is unexecuted. The case is run by a person and its result recorded first, or the release is refused. Added after escape ESC-001.
