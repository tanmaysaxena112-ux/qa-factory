# Decision record

Each decision states the context, the choice and what it costs. Newest last.

## D-001: Own engine instead of an existing workflow engine

**Context.** A studied open-source agent workflow engine ran every AI step with permission checks off, inherited the host environment into agents, stored project variables in plain text, pasted untrusted issue text unfenced into prompts, and shipped twenty breaking changes in six releases.

**Decision.** A small engine in plain Node, copying the good designs: typed step output, per-step MCP limits, gates, stub-based workflow tests.

**Cost.** Resume, scheduling and run state had to be written here.

## D-002: Claude Code restricted mode for agent containment

**Context.** Agents must not run commands, reach the network or read beyond what the engine gives them. A blind reviewer must be blind by construction.

**Decision.** Every agent runs with `--restricted`, `--strict-mcp-config`, a per-step MCP file, engine-supplied settings with guard and audit hooks, and its working directory set to a folder the engine staged. A probe confirmed a read outside that folder is denied.

**Cost.** Agents cannot write files. All agent output is structured JSON; the engine writes it.

## D-003: Own API runner instead of Newman

**Context.** Newman 6.2.2, the latest release, brings 19 known vulnerabilities through its dependency tree, one critical (`handlebars`) and ten high. npm's only remedy is a downgrade to 4.6.1. The QA Factory test format is its own, so Newman added a large attack surface for no capability.

**Decision.** `runners/api.js` executes `qa.apitests.v1` specs with Node's built-in `fetch`, checks every response against the OpenAPI contract, and writes `qa.result.v1` evidence. Zero added dependencies.

**Cost.** No direct import of existing Postman collections. A converter can be added if a project needs one.

## D-004: Agents never write to the repository

**Context.** An agent that edits PRDs, cases or tests directly could change what it is judged against.

**Decision.** Agents return JSON. After the QA Lead approves a gate, a runner step (`qa promote`) writes approved output into `projects/<name>/`. Changes reach `main` only through a commit the QA Lead pushes.

**Cost.** One extra step per artefact.

## D-005: Node 24 LTS, exact model IDs, current mobile stack

**Context.** A live check on 2026-09-25 found Node 23 past end of life, `node:sqlite` still marked "release candidate" in Node 24 and 26, model aliases (`sonnet`, `haiku`) that move when new models ship, WebdriverIO 8 out of LTS since August 2025, and the current Android driver requiring Appium 3.

**Decision.** Node 24 LTS is the floor (`engines >=24`, `qa doctor` fails other lines); move to Node 26 after it becomes LTS on 2026-10-28 and rerun the suite, since `node:sqlite` may still change. Agent roles name exact model IDs (`claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-opus-5-5`) so a run is reproducible. The mobile lane targets WebdriverIO 9 and Appium 3. Reporting targets Allure 3 (pure Node). Load testing, when adopted, targets k6 v2.

**Cost.** Model upgrades become deliberate pull requests rather than silent changes.

## D-006: Declarative web tests compiled to Playwright

**Context.** Agent-written Playwright code would be arbitrary code in the repository, hard to review and able to do anything the test process can do.

**Decision.** Web tests are data (`qa.webtests.v1`) with a fixed action list. The runner compiles them into Playwright specs, inserting every value through JSON encoding, and runs them with the Playwright test runner across four engine and viewport projects. Accessibility uses axe-core; visual checks use Playwright screenshots against QA Lead approved baselines. When the format cannot express a case, the case stays manual and is reported, rather than approximated.

**Cost.** New interaction kinds need a platform change. The first web automation run showed eight cases that needed keyboard, viewport, layout and mid-test request actions, which were added.

## D-007: Independent review found a runner integrity bug

**Context.** RUN-2026-0925-015 reported 47/47 web tests passing. The blind reviewer, reading Playwright's raw output, saw WEB-CART-43 fail in Firefox and WebKit. Playwright's JSON report holds one spec entry per project; the runner read only the first, which was Chromium. Calibration RUN-2026-0925-014 was affected the same way.

**Decision.** The runner counts every project's entry, requires every requested browser to report, and refuses to produce results unless its failed-run count equals Playwright's own `stats.unexpected`. A regression test runs a test that passes in Chromium and fails in WebKit and requires FAIL. Browser exceptions exist only as declared `skip_browsers` entries with a reason from the PRD, recorded in evidence. The affected calibration was superseded by RUN-2026-0925-016.

**Cost.** None beyond the fix. This is the case the blind reviewer exists for: a self-graded pipeline would have released on a false 47/47.
