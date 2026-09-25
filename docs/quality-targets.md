# Quality targets

Testing cannot prove software has no defects. These numbers make thoroughness measurable. They are tracked from the first run.

| Target | Definition | Goal | How it is measured |
|---|---|---|---|
| Requirement coverage | Acceptance criteria with a passing test on every relevant surface, divided by all acceptance criteria | 100% | Coverage check at the test case gate; a hard gate |
| Fault detection rate | Seeded faults caught, divided by seeded faults injected | 99% or more | Calibration against the project's seeded fault library |
| Verdict accuracy | Passes confirmed correct in the QA Lead's weekly audit, divided by passes audited | 99% or more | Random 5% sample of passed tests each week |
| Defect escape rate | Defects found after QA approval, divided by all defects found | Under 1% | Monthly, from escape analysis; a long-term goal |

Supporting measures:

- Flake rate: tests whose result changes without a code change.
- Reviewer agreement: how often the blind reviewer's verdict matches the QA Lead's.
- Cost per run: from the engine's per-step cost record.

Every escaped defect produces a root cause, a regression test and, where it exposes a gap in technique, a new entry in `docs/test-design-techniques.md`.
