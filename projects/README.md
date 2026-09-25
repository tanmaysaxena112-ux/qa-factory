# Projects

Each project the QA Factory tests lives in its own folder. The platform outside this folder never names a client, product or environment.

```
projects/<project>/
├── project.yml        environments, hosts, devices, risk rules
├── MISSION.md         what the product is and what it must never become
├── intake/            grooming notes
├── prd/               PRD-<SLUG>.md and generated indexes
├── cases/             approved test cases
├── api/               Newman collections and environments
├── web/               Playwright project
├── mobile/            WebdriverIO + Appium (submodule)
├── faults/            seeded fault library for calibration
└── knowledge/         impact map, known issues
```

Client projects belong in separate private repositories that follow this layout. This repository only holds demo projects built against public practice applications.

Holdout scenarios never live here. They stay outside every agent's reach.
