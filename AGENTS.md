# CodeArchive Agent Instructions

## Source of truth

- Read `docs/codearchive-development-spec.md` before planning cross-component work.
- Use `docs/agent-architecture.md` for role ownership, handoffs, model routing, and escalation.
- Treat the implementation as the current state and the development specification as the target state. Report drift instead of silently changing either one.
- Current known drift: the specification recommends Spring Boot 3, while `apps/api/build.gradle` currently declares Spring Boot 4.1.0. For the current SWEA MVP, Issue #31 freezes Spring Boot 4.1.0; specification alignment is deferred to stabilization after the MVP.

## Current delivery priority

Issue #31 (`[MVP] SWEA end-to-end archive + backend sync + AI assistance`) overrides the broader section 23.0 sequencing until the SWEA MVP is complete.

The current delivery goal is one end-to-end SWEA MVP before Phase 4 platforms, Web Dashboard expansion, authentication, integrations, statistics, or recommendations. Follow this order unless the project integrator records a new decision:

1. #32 — trusted SWEA ACCEPTED execution-time/memory evidence and local record extension.
2. #40 — Extension saved-record provenance, bounded popup list, full archive view, and code-copy UX.
3. #33 — Spring Main API + PostgreSQL solution persistence.
4. #34 — local-first Extension record → Main API synchronization.
5. #35 — FastAPI/OpenAI AI artifact backend for explicit approach/design, commented-code, and code-review requests.
6. #36 — Extension AI buttons and artifact UI.
7. #37 — real Chrome + local backend end-to-end acceptance.

Preserve the local-first invariant throughout the MVP: SWEA capture and IndexedDB persistence must still succeed when the API or AI service is unavailable. Do not begin another coding platform while Issue #31 is open unless the project integrator explicitly reprioritizes it.

## Ownership

- The project integrator owns the plan, shared contracts, cross-component decisions, and final integration.
- The client builder owns `apps/extension/**` and `apps/web/**`.
- The service builder owns `apps/api/**`, `apps/analysis/**`, and `infra/**`.
- `packages/shared-types/**`, root workspace configuration, `.github/**`, and `docs/**` are shared boundaries. Change them only with project-integrator approval.
- The quality reviewer normally performs read-only review and must not silently fix the code it reviews.

## Working rules

1. Start with the smallest change that completes the current phase.
2. Before editing, state the owned paths, shared-boundary changes, acceptance checks, and known risks.
3. Do not let two agents edit the same path concurrently.
4. Use artifacts for handoffs: plan, changed paths, contract diff, test evidence, risks, and follow-up work.
5. Preserve local-first behavior: extension capture, storage, browsing, and export must not require a running API during the prototype phases.
6. Keep problem statements, credentials, tokens, cookies, API keys, and full source code out of logs unless the specification explicitly permits the data and the user has consented.
7. External uploads, production deployment, destructive migrations, token-scope changes, and permission expansion require explicit user approval immediately before execution.
8. When a lower-tier agent encounters a cross-component decision, security boundary, schema migration, conflicting requirement, or two failed attempts, stop and escalate to the project integrator.

## Validation

Run the narrowest relevant checks first, then broader checks when available.

- TypeScript workspace: `pnpm typecheck`, `pnpm test`, `pnpm build`
- Main API: from `apps/api`, run `./gradlew test`
- Analysis API: from `apps/analysis`, run `pytest`
- Infrastructure: `docker compose -f infra/compose.yaml config`

Some workspace packages are still placeholders. If a root command cannot run because a package has not yet been initialized, report that as an expected repository gap; do not fabricate a passing result.

## Definition of done

A handoff is acceptable only when requirements are traced to the specification, changed paths stay within ownership, relevant tests pass or blockers are evidenced, security/privacy effects are stated, and documentation or contracts are updated when behavior changes.


## ChatGPT Work role Skills

When a CodeArchive role Skill is explicitly invoked, use exactly that one role for the chat. Do not invoke another role Skill or spawn subagents. Persist handoffs in the GitHub issue or pull request using `docs/work-skill-workflow.md`.
