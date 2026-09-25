# PRD standard

The PRD is the single source of truth for a feature. Where it disagrees with any other artefact, the PRD is correct until amended by pull request.

## Location and identity

`projects/<project>/prd/PRD-<SLUG>.md`. The machine index (`qa.prd.v1`) is generated from it and never edited by hand.

Front matter: `prd_id`, `project`, `title`, `status`, and optionally `surfaces` (for example `[web]`). Coverage is required on the PRD's surfaces, or on every project surface when none are named.

## Required sections

1. Summary: the problem, who has it, and the outcome wanted.
2. Scope: in scope, and out of scope.
3. Requirements: each `REQ-###` has a title, a risk level, risk reasons when high, and at least one acceptance criterion.
4. Acceptance criteria: `AC-###.n`, each observable and testable. "Works well" is not a criterion; "returns 201 and the order appears in the list" is.
5. Edge cases: `EC-###.n`, each with its defined behaviour.
6. Open questions: `OQ-###.n`. An approved PRD has none.
7. Design references: Figma frames, API specification.
8. Revision history: every change, including superseded requirements.

## Rules

- A requirement without an acceptance criterion is not a requirement.
- No behaviour is invented. If grooming notes and the design do not establish it, it is an open question.
- Requirement IDs are permanent. Supersede, never rename.
- Status `approved` is set only by the QA Lead merging the pull request.
- No placeholder text in an approved PRD.
