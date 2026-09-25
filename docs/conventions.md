# Conventions

| Item | Format | Example |
|---|---|---|
| Run | `RUN-YYYY-MMDD-NNN` | `RUN-2026-0925-001` |
| Root cause cluster | `RC-YYYY-MMDD-NN` | `RC-2026-0925-01` |
| PRD | `PRD-<FEATURE-SLUG>`, uppercase | `PRD-CHECKOUT` |
| Requirement | `REQ-###`, sequential within a PRD, permanent | `REQ-004` |
| Acceptance criterion | `AC-###.n` | `AC-004.2` |
| Edge case | `EC-###.n` | `EC-004.1` |
| Open question | `OQ-###.n` | `OQ-004.3` |
| Test | `<API\|WEB\|MOB>-<FEATURE>-<NN>` | `API-CHECKOUT-07` |
| Finding | `F-NN`, scoped to a run | `F-03` |
| Schema | `qa.<contract>.v<n>` | `qa.result.v1` |
| Agent role file | `agents/<kebab-case-role>.md` | `agents/blind-reviewer.md` |
| Workflow file | `workflows/<kebab-case>.yaml` | `workflows/api-regression.yaml` |
| Agent branch | `agent/<run-id>-<slug>` | `agent/RUN-2026-0925-001-login-tests` |
| Project folder | `projects/<kebab-case>/` | `projects/demo-shop/` |

Requirement IDs are never renamed or reused. A changed requirement is superseded (`superseded_by`) and the change is recorded in the PRD revision history.

Risk levels: `high` when a requirement involves money, login and permissions, data loss or compliance (reasons recorded as `money`, `auth`, `data_loss`, `compliance`); otherwise `medium` or `low`.
