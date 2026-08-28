# CodeArchive Agent Instructions

## Source of truth

- Read `docs/codearchive-development-spec.md` before planning cross-component work.
- Use `docs/agent-architecture.md` for role ownership, handoffs, model routing, and escalation.
- Treat the implementation as the current state and the development specification as the target state. Report drift instead of silently changing either one.
- Current Main API MVP runtime baseline: **Java 21 + Spring Boot 3.5.16 + Gradle 8.14.3**. This supersedes the former Issue #31 Spring Boot 4.1.0 freeze by explicit owner decision during Issue #33 / PR #47. Do not mix a framework/runtime major upgrade into feature work; any future baseline change requires an explicit Integrator decision and dedicated stabilization evidence.

## Current delivery priority

Issue #31 (`[MVP] SWEA archive + GitHub login + backend sync + AI assistance (~20-user beta)`) remains the umbrella, but the owner decision recorded on 2026-08-28 changes the client boundary: the Extension is capture-only; Web Dashboard owns login, Extension import, backend synchronization, management, AI, and external integrations. This decision overrides older issue wording and section 23.0 where they require Extension OAuth or direct API sync.

The current delivery goal is one end-to-end SWEA beta that can be distributed to roughly 20 testers. Authentication and user-scoped persistence are now part of the MVP because server-side records and AI artifacts must not mix across users. Follow this order unless the project integrator records a new decision:

1. Preserve and harden SWEA capture → Extension IndexedDB without login or server availability.
2. Implement GitHub login in Web Dashboard using the existing user/session foundation.
3. Freeze the Extension → Dashboard paginated import/ack contract in `docs/extension-dashboard-handoff-design.md` and shared types.
4. Implement Dashboard-owned authenticated bulk import into the deployed Main API.
5. Remove Extension OAuth, backend tokens, direct API sync, AI/external-integration UI, and unnecessary browser permissions after the replacement path passes real-Chrome acceptance.
6. Continue user-scoped AI artifacts and deployed multi-user beta acceptance from the Dashboard.

Already completed for this MVP: SWEA capture/local archive UX through #40. Issue #32 automatic SWEA performance collection was intentionally discontinued; execution time and memory remain optional manual fields. GitHub repository upload (#44) and public sharing/leaderboards (#45) are post-MVP work and must not block the sequence above.

Preserve the local-first invariant throughout the MVP: SWEA capture, IndexedDB persistence, browsing, editing, export, and delete must still work when the Dashboard, login, API, database, or AI service is unavailable. The Extension must not authenticate users, store CodeArchive tokens, or call the Main API. Do not begin another coding platform while Issue #31 is open unless the project integrator explicitly reprioritizes it.

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
- Promote releases only through a same-repository `develop` -> `master` pull request. Do not open release pull requests to `master` from a fork or any other branch.
- Treat `master` as the deployable branch. Keep provider auto-deploy disabled and deploy manually only after the release pull request is approved and merged.
- Protect `master` by requiring the `Master Release Source / require-develop` check before merge.
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
