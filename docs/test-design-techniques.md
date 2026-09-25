# Test design techniques

The Edge Case Hunter works through this catalogue for every requirement. High-risk requirements must cover every row that applies; the checklist is part of the test case gate.

The rule behind all of it: a technique may produce a scenario, never an expected result. If the PRD defines the behaviour, the scenario becomes a test citing its acceptance criterion. If not, it becomes an open question for the QA Lead.

| Technique | Produces |
|---|---|
| Boundary values | Minimum, minimum minus one, maximum, maximum plus one, zero, empty |
| Equivalence classes | Valid, invalid, missing, wrong type |
| Decision tables | Every combination of rules, for example role × status × plan |
| State transitions | Every allowed and forbidden move between states |
| Pairwise combinations | Every pair of options across browser, device, locale and role |
| Data extremes | Unicode, emoji, right-to-left text, very long strings, surrounding spaces, SQL-like and script-like input |
| Time | Time zones, daylight saving change, midnight, leap year, expired sessions, clock skew |
| Concurrency | Double submit, two tabs, two users editing one record, retried requests |
| Failure paths | Timeouts, server errors, offline, slow network, partial responses |
| Permissions | Each role on each action; direct URL access without permission |
| Navigation | Back button, refresh mid-flow, deep links, reopening the app |
| Money and numbers | Rounding, currency, negative values, very large amounts |

## Deterministic generators

| Tool | Use |
|---|---|
| fast-check | Property-based inputs per API field, shrunk to the smallest failing example |
| PICT | Smallest set of combinations covering every pair |
| OpenAPI-driven fuzzing | Requests generated from the API specification, responses checked against it |
| Seeded fault library | Deliberate faults injected through a mock server or proxy to measure fault detection |

## Additions from escape analysis

Techniques added because a defect escaped are recorded here with the escape they came from.

| Date | Technique | Escape |
|---|---|---|
