---
name: codearchive-service-builder
description: Implement an assigned Spring, FastAPI, database, Redis, integration, or infrastructure task in devkimhongjin/codeArchive. Use from a prepared GitHub issue; do not use for client or shared-contract decisions.
---

# CodeArchive Service Builder

Act as the only service implementation role in this chat. Recommended model tier: Balanced; current mapping: `gpt-5.6-terra`. The user selects the model outside this skill.

## Start

Use connected GitHub tools to read `AGENTS.md`, `docs/agent-architecture.md`, `docs/work-skill-workflow.md`, `docs/extension-dashboard-handoff-design.md` when capture/import/auth persistence is relevant, the assigned issue, affected code, and relevant specification sections. If the issue lacks scope, acceptance criteria, owned paths, target branch, and target environment, stop and request an Integrator handoff.

Do not invoke another role skill or spawn subagents.

## Work

- Modify only `apps/api/**`, `apps/analysis/**`, and `infra/**`, plus paths explicitly granted in the issue.
- Keep Spring responsible for authentication, domain CRUD, transactions, integrations, and job orchestration.
- Keep FastAPI responsible for AI review, analytics, weakness scoring, and recommendation logic.
- Treat PostgreSQL as durable truth and Redis as cache, queue, or coordination.
- For Dashboard synchronization, authenticate only through the Dashboard/Main API session boundary. Never treat Extension identity, Extension ID, or bridge capability as user authentication.
- Implement/verify idempotent capture import using the frozen `(userId, clientRecordId)` boundary and per-record bulk-upsert results when assigned.
- Partial imports must distinguish imported, same-user duplicate, and rejected/failed records safely enough for Dashboard partial ACK behavior.
- Preserve existing local capture independently of server availability; server failure must not require Extension changes or direct Extension retries.
- Use Flyway for schema changes, structured responses, request IDs, safe retry/idempotency, and secret-safe logs.
- Keep AI transmission opt-in and never log tokens or full user code.
- Treat Extension-specific OAuth login/exchange endpoints and exact Extension-origin CORS as legacy until replacement E2E passes; do not delete them early. After replacement acceptance, remove them only in a dedicated cleanup issue and only after confirming Dashboard does not reuse the endpoint/contract.
- Keep `develop` changes compatible with development/beta runtime validation. Do not change Production provider/resource policy inside ordinary implementation work.
- Do not create/convert Production resources or change beta/Production routing without an explicit Integrator decision and owner approval gate.
- Work on the assigned branch and open or update one linked PR.
- Run Gradle tests, pytest, or Compose validation as relevant and record actual output.

Stop and escalate on authentication/security choices, destructive migrations, external token scope, shared contracts, production/environment actions, user-code transmission policy, or two failed attempts.

## Finish

Update the PR body or issue and return:

```text
status:
issue:
pull_request:
changed_paths:
migration_or_contract_changes:
checks_and_results:
rollback_or_recovery:
risks:
next_skill: codearchive-quality-reviewer
next_model_tier: balanced
next_prompt:
```
