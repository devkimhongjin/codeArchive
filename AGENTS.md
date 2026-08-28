# CodeArchive Agent Instructions

## Source of truth

- Read `docs/codearchive-development-spec.md` before planning cross-component work.
- Use `docs/extension-dashboard-handoff-design.md` as the normative client trust-boundary and Extension → Dashboard synchronization contract while the capture-only transition is active.
- Use `docs/dashboard-beta-scope.md` as the current product/deployment-scope decision for the ~20-user Dashboard beta. It clarifies current implementation priority without deleting long-term development-spec goals.
- Use `docs/agent-architecture.md` for role ownership, handoffs, model routing, and escalation.
- Treat the implementation as the current state and the development specification as the target state. Report drift instead of silently changing either one.
- Current Main API MVP runtime baseline: **Java 21 + Spring Boot 3.5.16 + Gradle 8.14.3**. This supersedes the former Issue #31 Spring Boot 4.1.0 freeze by explicit owner decision during Issue #33 / PR #47. Do not mix a framework/runtime major upgrade into feature work; any future baseline change requires an explicit Integrator decision and dedicated stabilization evidence.

## Current delivery priority

Issue #31 (`[MVP] SWEA archive + GitHub login + backend sync + AI assistance (~20-user beta)`) remains the umbrella, but the owner decision recorded on 2026-08-28 changes the client boundary: the Extension is capture-only; Web Dashboard owns login, synchronization, authenticated Main API persistence, management, AI, and external integrations. This decision overrides older issue wording and specification sections where they require Extension OAuth or direct API synchronization.

Dashboard responsibility ownership is broader than the current Dashboard implementation slice. For this beta, treat Dashboard as the lightweight static Web successor to the existing Extension `archive.html` / `전체 풀이 보기` UX. Start from archive/problem-group/submission/detail management and add auth, synchronization, AI, statistics, and integrations only through bounded work when required. Do not infer a large admin portal, a new always-running Dashboard server, or an unnecessary dependency stack merely because Dashboard ultimately owns those capabilities. Preserve the existing Extension archive page as local/offline fallback through replacement E2E and Issue #86 sequencing.

The current delivery goal is one end-to-end SWEA beta that can be distributed to roughly 20 testers. Follow this order unless the project integrator records a new decision:

1. Preserve and harden SWEA PASS capture → Extension IndexedDB without Dashboard, login, or server availability.
2. Freeze the exact-origin Extension → Dashboard bridge, capture schema, cursor/ack protocol, and auto-sync lifecycle in `docs/extension-dashboard-handoff-design.md` plus approved shared types.
3. Implement the Extension bridge/capability/pending page/ACK runtime without binding an unapproved or fabricated Dashboard origin.
4. Bootstrap the lightweight archive-style static Web Dashboard, then obtain its real development/beta HTTPS origin only through a separately approved provider provisioning/deployment gate.
5. After that exact origin is known and separately approved for `externally_connectable`, finish the Extension origin binding and independently review the bridge.
6. Implement GitHub login/session, Extension connection, and Dashboard-owned automatic synchronization: while a signed-in Dashboard has user-enabled auto-sync and an active Extension connection, newly captured records are pulled, validated, bulk-upserted through the Dashboard session, and acknowledged automatically. When the Dashboard is closed/disconnected/logged out, records remain local and are caught up automatically on the next eligible connection.
7. Verify offline capture → Dashboard reconnect/login → automatic pending drain → idempotent server persistence in real Chrome.
8. Only after replacement E2E passes, remove Extension OAuth, CodeArchive tokens, direct API sync, AI/external-integration UI, and unnecessary browser permissions in a separate cleanup slice.
9. Continue user-scoped AI artifacts and deployed multi-user beta acceptance from the Dashboard.

Already completed for this MVP: SWEA capture/local archive UX through #40. Issue #32 automatic SWEA performance collection was intentionally discontinued; execution time and memory remain optional manual fields. GitHub repository upload (#44) and public sharing/leaderboards (#45) are post-MVP work and must not block the sequence above.

Preserve the local-first invariant throughout the MVP: SWEA capture, IndexedDB persistence, browsing, editing, export, and delete must still work when the Dashboard, login, API, database, or AI service is unavailable.

### Extension trust boundary

- The Extension automatically detects accepted solutions and stores capture records locally.
- The Extension must not authenticate CodeArchive users, start GitHub OAuth, store CodeArchive/GitHub tokens, call the Main API, call AI providers, or decide which server account owns a record.
- The Extension may expose a narrowly scoped exact-origin browser bridge to the Dashboard. That bridge is data transport, not server synchronization ownership.
- The Dashboard initiates and owns the browser connection. The Extension may notify an already-connected Dashboard that local capture state changed; it must not create arbitrary web connections itself.
- Source-code pages may be read through the bridge only after the Dashboard has an authenticated user, auto-sync/import is explicitly enabled by the user for that session/account context, and the bridge has issued a valid ephemeral capability.
- Logout, account change, tab/origin change, port disconnect, capability expiry, or terminal acknowledgement invalidates the active sync capability. A newly authenticated account must establish a new eligible sync session before code is transferred.
- Acknowledgement never deletes the local capture. Local deletion remains a separate explicit user action.

## Ownership

- The project integrator owns the plan, shared contracts, cross-component decisions, environment policy, and final integration.
- The client builder owns `apps/extension/**` and `apps/web/**`.
- The service builder owns `apps/api/**`, `apps/analysis/**`, and `infra/**`.
- `packages/shared-types/**`, root config, `.github/**`, and `docs/**` are shared boundaries. Change them only with project-integrator approval.
- The quality reviewer normally performs read-only review and must not silently fix the code it reviews.

## Working rules

1. Start with the smallest change that completes the current phase.
2. Before editing, state the owned paths, shared-boundary changes, acceptance checks, and known risks.
3. Do not let two agents edit the same path concurrently.
4. Use artifacts for handoffs: plan, changed paths, contract diff, test evidence, risks, and follow-up work.
5. Preserve local-first behavior: Extension capture, storage, browsing, and export must not require a running Dashboard or API.
6. Keep problem statements, credentials, tokens, cookies, API keys, and full source code out of logs unless the specification explicitly permits the data and the user has consented.
7. Treat transmission of captured source code from Extension to Dashboard as an explicit product consent boundary. Do not silently enable it for a new authenticated account context.
8. External uploads, development/beta deployment, production deployment, destructive migrations, token-scope changes, browser/origin permission expansion, secret rotation, and cost-bearing external actions require explicit user approval immediately before execution.
9. When a lower-tier agent encounters a cross-component decision, security boundary, schema migration, conflicting requirement, environment-policy change, or two failed attempts, stop and escalate to the project integrator.
10. For the current Dashboard beta, distinguish responsibility ownership from slice scope. Prefer the smallest static archive-style client and introduce extra frameworks, compute resources, analytics/admin surfaces, or integration features only when a bounded requirement justifies them.

## Branch and deployment flow

### Development and beta

- Implement feature and fix work on bounded branches and merge it into `develop` through a pull request.
- Treat `develop` as the integration branch **and the source branch for development/beta runtime validation**.
- Development/beta deployments must use an exact reviewed `develop` commit. They are external runtime actions and require explicit owner approval immediately before deployment.
- Keep provider auto-deploy disabled unless a later explicit owner decision changes that policy.
- Development/beta deployment does not authorize production deployment and does not imply production readiness.

### Production

- Treat `master` as the production/deployable branch. Do not use it for routine development or beta iteration.
- Promote a production candidate only through a same-repository `develop` → `master` pull request after the intended `develop` commit has passed the required development/beta acceptance.
- Do not open production release pull requests to `master` from a fork or any branch other than the same repository's `develop`.
- Protect `master` by requiring the `Master Release Source / require-develop` check before merge.
- Obtain explicit owner approval immediately before the `develop` → `master` merge.
- After that merge, obtain a new and separate explicit owner approval immediately before production deployment of the exact `master` commit.
- Never deploy Production from `develop`.

If the repository currently has only development/beta provider resources, keep them as development/beta resources. Creating or converting provider resources for Production is a separate architecture/cost/runtime decision and must not be inferred from a release merge.

## Validation

Run the narrowest relevant checks first, then broader checks when available.

- TypeScript workspace: `pnpm typecheck`, `pnpm test`, `pnpm build`
- Main API: from `apps/api`, run `./gradlew test`
- Analysis API: from `apps/analysis`, run `pytest`
- Infrastructure: `docker compose -f infra/compose.yaml config`

Some workspace packages are still placeholders. If a root command cannot run because a package has not yet been initialized, report that as an expected repository gap; do not fabricate a passing result.

For the capture-only transition, real-Chrome acceptance must cover at least:

- offline/local capture with Dashboard closed;
- exact-origin Dashboard connection;
- authenticated user enables automatic synchronization;
- new capture triggers automatic pending drain while connected;
- reconnect drains captures accumulated while disconnected;
- API partial failure acknowledges only successful/duplicate records;
- repeated sync creates no duplicate `(userId, clientRecordId)` server records;
- logout/account change stops the old sync session before further source transfer;
- Extension stores no CodeArchive/GitHub token and makes no Main API request.

## Definition of done

A handoff is acceptable only when requirements are traced to the specification and active design contract, changed paths stay within ownership, relevant tests pass or blockers are evidenced, security/privacy/consent effects are stated, environment impact is stated, and documentation or contracts are updated when behavior changes.

## ChatGPT Work role Skills

When a CodeArchive role Skill is explicitly invoked, use exactly that one role for the chat. Do not invoke another role Skill or spawn subagents. Persist handoffs in the GitHub issue or pull request using `docs/work-skill-workflow.md`.
