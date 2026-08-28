# Dashboard beta product scope

## Decision

For the current CodeArchive MVP beta (roughly 20 users), the Web Dashboard is a **lightweight static Web SPA that succeeds the existing Extension `archive.html` / `전체 풀이 보기` experience**.

This document defines the current product and deployment scope for Dashboard work. It does not change the frozen Extension ↔ Dashboard synchronization/security contract in `docs/extension-dashboard-handoff-design.md`.

## Responsibility ownership is not implementation priority

The Dashboard continues to own these responsibilities when their bounded slices are implemented:

- GitHub login and authenticated user/session context;
- Extension connection and user-enabled automatic synchronization;
- reconnect pending catch-up and `CAPTURE_CHANGED` pending drain;
- authenticated Main API calls, retry/backoff, bulk upsert, and partial ACK selection;
- logout/account-switch sync teardown;
- server-backed solution management;
- later AI, statistics, recommendation, GitHub/Notion, and other external integrations.

Owning those responsibilities does **not** mean the first Dashboard slice must implement all of them.

## Current beta product surface

Use the existing Extension archive experience as the primary UX reference:

```text
problem group
→ submission list
→ solution detail
```

The first useful Web Dashboard should stay small and focus on:

- CodeArchive archive shell;
- compact solution/problem list;
- concise metadata;
- solution detail/manage surface;
- empty/loading/error states;
- simple places for login, Extension connection, and synchronization status when useful for later slices.

Search/filter/sort may be added when they materially improve archive management, but they are not a reason to expand the application into an admin or analytics portal.

## Deliberately deferred from bootstrap

Unless a bounded issue specifically requires them, do not pull the following into the Dashboard bootstrap slice:

- full GitHub OAuth implementation;
- automatic synchronization engine;
- Main API persistence/retry;
- AI execution;
- statistics/weakness/recommendation suites;
- GitHub/Notion integration;
- admin console or generalized management portal;
- additional always-running Dashboard server runtime.

Long-term development-spec features remain valid future goals. This document only fixes their current implementation priority.

## Technical default for the small beta

- Prefer React + TypeScript + Vite workspace conventions already used by the repository.
- Prefer a static SPA and static-site hosting for Dashboard beta.
- Do not add a Dashboard Node/server process merely to serve the client.
- Introduce Router, global state libraries, query libraries, CSS frameworks, charting libraries, or similar dependencies only when the assigned slice has a concrete need.
- Keep Web data access replaceable so server-backed records and Extension bridge state can be wired later without coupling the UI directly to Extension IndexedDB.
- Never invent a deployment hostname. Freeze an exact Dashboard origin only from real provider evidence after separately approved provisioning.

## Transition and local fallback

The existing Extension `archive.html` remains available during the replacement transition for local/offline browsing and export.

Do not remove or redirect that local archive merely because the Web Dashboard exists. Any removal or reduction of the legacy/local surface follows the replacement-before-removal sequencing in Issue #86 after real-Chrome development/beta E2E proves the replacement flow.

## Hosting and cost

For the current small beta, prefer the least operationally expensive static-site option that fits the existing environment. The current plan is a static Dashboard in the existing Render hosting family unless a later Integrator decision records a better choice.

Provider provisioning/deployment remains a separate external approval gate. A static-site preference is not permission to create resources, deploy, change provider settings, or bind an Extension origin.

## Review expectations

Treat unjustified Dashboard scope growth as a review concern. Examples include:

- adding an always-running Dashboard server without a requirement;
- introducing large state/router/chart stacks before they are needed;
- implementing AI/statistics/admin surfaces in a bootstrap PR;
- hardcoding a guessed public origin;
- deleting the Extension local archive before replacement E2E;
- bundling hosting, manifest permission, deployment, release, or cleanup gates into a UI slice.

## Frozen architecture preserved

This product-scope decision does not change:

- Extension capture-only/local-first ownership;
- Dashboard-owned authentication and automatic synchronization;
- exact-origin Port/tab/origin-bound capability security;
- metadata-only change notification;
- `pending` normal auto-sync and explicit `all` recovery semantics;
- ACK receipt/local-retention behavior;
- `(userId, clientRecordId)` API idempotency;
- Issue #86 replacement-before-removal sequencing;
- `develop` as development/beta source and `master` as Production source;
- separate merge, deployment, permission/origin, release, and Production approval gates.
