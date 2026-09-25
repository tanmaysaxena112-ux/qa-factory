# Engine

The engine is ordinary code, not AI. It reads a workflow, starts each step, checks each output, holds each gate and records everything. It cannot be persuaded to skip a step.

## Workflow files

`workflows/<name>.yaml`, validated against `schemas/qa.workflow.v1.json`. Unknown keys fail the load.

```yaml
schema: qa.workflow.v1
name: example
max_cost_usd: 1.0            # run-level spend cap
params:
  env: { required: true, description: dev or uat }
steps:
  - id: execute
    run: qa api run --project demo --env ${params.env}
    env: [DEMO_API_TOKEN]    # names only; values come from the environment
  - id: triage
    needs: [execute]
    agent: bug-investigator
    prompt: Classify the failures in ${steps.execute.stdout_file}.
    output: qa.finding.v1
  - id: decision
    needs: [triage]
    gate: qa-lead
```

### Step kinds

| Kind | Key | What happens |
|---|---|---|
| Runner | `run` | An allowlisted command runs without a shell. Output goes to `evidence/<run>/steps/<id>/`. Non-zero exit fails the step. Never retried silently. |
| Agent | `agent`, `prompt`, `output` | Claude Code starts in restricted mode with only the role's tools and MCP servers, confined to the run's evidence folder. Output must match the `output` schema. |
| Gate | `gate: qa-lead` | The run pauses until `qa approve` or `qa reject`. The decision, approver and time are recorded. |

### References

| Reference | Value |
|---|---|
| `${params.<name>}` | A declared parameter |
| `${run.id}`, `${run.dir}` | Run ID and evidence folder |
| `${steps.<id>.output...}` | A completed dependency's output |
| `${steps.<id>.stdout_file}` | A runner step's stdout file |

A step may only reference its own dependencies. In prompts, step values are wrapped in `<data>` tags so they are never read as instructions.

## Agent roles

`agents/<role>.md`: YAML front matter plus the role's instructions.

```yaml
---
name: blind-reviewer
description: Independent verdict from evidence only
tools: [Read, Grep, Glob]
mcp: []
model: sonnet
max_cost_usd: 2
---
```

`Bash`, `WebFetch`, `WebSearch` and sub-agent tools are refused at load time.

## Commands and exit codes

| Command | Purpose |
|---|---|
| `qa doctor [--json] [--offline]` | Health check |
| `qa schemas [--json]` | List contracts |
| `qa workflow list`, `qa workflow validate [name]` | Workflows |
| `qa run <workflow> [--param k=v]` | Start a run |
| `qa status [run-id] [--json]` | Inspect runs |
| `qa approve <run-id> [--reason]`, `qa reject <run-id> --reason` | QA Lead decision |
| `qa halt`, `qa unhalt`, `qa resume <run-id>` | Platform stop switch |
| `qa evidence verify <run-id>` | Check sealed evidence |
| `qa prd validate --project <p>`, `qa prd index --file <f>` | PRD standard and machine index |
| `qa cases validate --project <p>` | Oracles, coverage on every surface, high-risk depth |
| `qa api validate`, `qa api run`, `qa api rerun` | API tests: automation gate, execution, spot re-execution |
| `qa calibrate --project <p>` | Healthy build passes, every seeded fault caught, wrong build blocks |
| `qa stage --to <folder> <path>...` | Stage exactly the files a contained agent may see |
| `qa promote --step <id> --to <path>` | Write approved agent output into the project, only after a QA Lead approval |

## Phase 1 workflows

| Workflow | Stages |
|---|---|
| `prd` | Stage intake, PRD Author, stage, PRD Critic, QA Lead, promote, validate |
| `design-cases` | Validate PRD, Test Designer, Edge Case Hunter, QA Lead, promote merged cases, coverage check |
| `automate` | Validate cases, Automation agent, QA Lead, promote, automation gate, calibration |
| `api-regression` | Planner, execution, re-execution, triage and blind review in parallel, Reporter, QA Lead |
| `calibrate` | Re-certify a suite without agents |

| Exit code | Meaning |
|---|---|
| 0 | Completed |
| 1 | Failed |
| 2 | Usage or validation error |
| 3 | Rejected at a gate |
| 10 | Waiting for QA Lead approval |
| 11 | Halted |

Exit codes describe the run, so CI never mistakes a pause for success.

## Evidence

Each run gets `evidence/<run-id>/`. Files are redacted before writing, written once and never overwritten. When the run ends, every file is hashed into `MANIFEST.json` and made read-only. `qa evidence verify` detects any change, deletion or late addition.

## Approver identity

`qa approve` records `QA_APPROVER` if set, otherwise `<user>@<host>`. Decisions are refused inside any process started for an agent.
