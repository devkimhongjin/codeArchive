# CodeArchive Agent Instructions

## Source of truth

- Read `docs/codearchive-development-spec.md` before planning cross-component work.
- Use `docs/agent-architecture.md` for role ownership, handoffs, model routing, and escalation.
- Treat the implementation as the current state and the development specification as the target state. Report drift instead of silently changing either one.
- Current Main API MVP runtime baseline: **Java 21 + Spring Boot 3.5.16 + Gradle 8.14.3**. This supersedes the former Issue #31 Spring Boot 4.1.0 freeze by explicit owner decision during Issue #33 / PR #47. Do not mix a framework/runtime major upgrade into feature work; any future baseline change requires an explicit Integrator decision and dedicated stabilization evidence.

## Current delivery priority

Issue #31 (`[MVP] SWEA archive + GitHub login + backend sync + AI assistance (~20-user beta)`) overrides the broader section 23.0 sequencing until the SWEA MVP beta is complete.

The current delivery goal is one end-to-end SWEA beta that can be distributed to roughly 20 testers. Authentication and user-scoped persistence are now part of the MVP because server-side records and AI artifacts must not mix across users. Follow this order unless the project integrator records a new decision:

1. #43 — GitHub App login + CodeArchive user/session identity foundation.
2. #33 — authenticated user-scoped Spring Main API + PostgreSQL solution persistence.
3. #34 — local-first Extension record → authenticated deployed Main API synchronization.
4. #35 — user-scoped FastAPI/OpenAI AI artifact backend with a minimal beta cost/abuse guard.
5. #36 — Extension GitHub login, sync state, AI buttons, and artifact UI.
6. #37 — deployed HTTPS beta + multi-user real Chrome acceptance.

Already completed for this MVP: SWEA capture/local archive UX through #40. Issue #32 automatic SWEA performance collection was intentionally discontinued; execution time and memory remain optional manual fields. GitHub repository upload (#44) and public sharing/leaderboards (#45) are post-MVP work and must not block the sequence above.

Preserve the local-first invariant throughout the MVP: SWEA capture, IndexedDB persistence, browsing, editing, export, and delete must still work when login, API, database, or AI service is unavailable. Do not begin another coding platform while Issue #31 is open unless the project integrator explicitly reprioritizes it.

## Ownership

- The project integrator owns the plan, shared contracts, cross-component decisions, and final integration.
- The client builder owns `apps/extension/**` and `apps/web/**`.
- The service builder owns `apps/api/**`, `apps/analysis/**`, and `infra/**`.
- `packages/shared-types/**`, root config, `.github/**`, and `docs/**` are shared boundaries. Change them only with project-integrator approval.
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

## Branch and deployment flow

- Implement feature and fix work on bounded branches and merge it into `develop` through a pull request.
- Treat `develop` as the integration branch. Do not deploy the beta or production services from it.
- Promote releases only through a `develop` -> `master` pull request. Do not open release pull requests to `master` from any other branch.
- Treat `master` as the deployable branch. Keep provider auto-deploy disabled and deploy manually only after the release pull request is approved and merged.
- Obtain explicit user approval immediately before the `develop` -> `master` merge and again immediately before the external deployment action.

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
