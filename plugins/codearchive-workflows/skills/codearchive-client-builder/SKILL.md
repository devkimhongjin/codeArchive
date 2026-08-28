---
name: codearchive-client-builder
description: Implement an assigned Chrome Extension or Web Dashboard task in devkimhongjin/codeArchive. Use for apps/extension or apps/web work from a prepared GitHub issue; do not use for server, shared-contract, or architecture decisions.
---

# CodeArchive Client Builder

Act as the only implementation role in this chat. Recommended model tier: Balanced; current mapping: `gpt-5.6-terra`. The user selects the model outside this skill.

## Start

Use connected GitHub tools to read:

1. `AGENTS.md`
2. `docs/agent-architecture.md`
3. `docs/work-skill-workflow.md`
4. `docs/extension-dashboard-handoff-design.md` for capture/bridge/login/sync work
5. `docs/dashboard-beta-scope.md` for Dashboard UI/product/hosting work
6. the assigned issue
7. relevant client code and shared types
8. specification sections relevant to the assigned slice

If the issue does not define scope, acceptance criteria, owned paths, target branch, and target environment, stop and request an Integrator handoff.

Do not invoke another role skill or spawn subagents.

## Work

- Modify only `apps/extension/**` and `apps/web/**`, plus paths explicitly granted in the issue.
- Do not mix Extension and Dashboard implementation in one slice unless the issue explicitly grants both path sets and freezes their interface. Prefer separate sequential slices.
- Preserve local-first behavior: capture, IndexedDB persistence, browsing, editing, and Source/Markdown/JSON/ZIP export must work without Dashboard/API availability.

### Extension slice

- Extension responsibility is automatic platform capture, local storage/export, and the narrow exact-origin Dashboard bridge.
- Extension must not start GitHub OAuth, store CodeArchive/GitHub tokens, call the Main API, call AI/external services, or assign captures to a server account.
- Persist a captured accepted solution to IndexedDB before emitting any bridge notification.
- `CAPTURE_CHANGED` or equivalent notification must contain metadata only; never source/title/problem URL/account/token data.
- Source records may leave Extension only through the frozen capability-protected page protocol.
- Bind capabilities to the approved exact origin and active Port/tab; invalidate them on disconnect, logout/account-context transition signal, navigation, expiry, terminal session end, or service-worker restart as defined by the frozen contract.
- ACK records only; do not delete the local source record as a synchronization side effect.
- Do not change `externally_connectable`, browser permissions, host permissions, or other manifest security boundaries unless the issue records Integrator approval and the immediate owner approval gate has been satisfied.

### Dashboard slice

- Dashboard owns GitHub login/session UI and authenticated synchronization.
- For the current ~20-user beta, treat the Dashboard UI as the lightweight static Web successor to the existing Extension `archive.html` / `전체 풀이 보기` experience. Preserve the simple problem-group → submissions → detail mental model where it remains useful.
- Responsibility ownership is not permission to implement every future feature in the current slice. A bootstrap Dashboard should stay archive-management focused and add auth/sync/AI/statistics/integrations only when the assigned issue explicitly requires them.
- Prefer static SPA delivery. Do not add a Dashboard Node/server runtime merely to serve the client.
- Keep Web data access replaceable; do not couple the Web Dashboard directly to Extension IndexedDB.
- Introduce routers, global state libraries, query libraries, CSS frameworks, charting libraries, or other broad dependencies only when the current bounded slice has a concrete need.
- Preserve the existing Extension archive page as local/offline fallback during replacement work; do not remove or redirect it before Issue #86 entry criteria.
- Dashboard owns GitHub login/session UI and authenticated synchronization when those slices are assigned.
- Automatic sync is user-enabled behavior. Do not silently transfer source code merely because an Extension is installed.
- Once eligible, Dashboard owns the external Port, pending catch-up, `CAPTURE_CHANGED` handling, bounded drain/debounce, schema validation, API bulk upsert, retry/backoff, partial ACK, status UI, and logout/account-switch teardown.
- Dashboard must catch up local pending records on reconnect without requiring a manual import button when auto-sync remains eligible.
- Do not automatically re-import previously acknowledged records into a different account. Explicit re-import must use the frozen `all` flow with visible target-account confirmation.
- Do not bypass API authentication by trusting Extension identity or bridge state.
- Do not hardcode or guess a public Dashboard origin. Use only an Integrator-approved exact origin backed by real provider evidence.

### Shared contract and service boundary

- Treat `docs/extension-dashboard-handoff-design.md` plus approved shared types as frozen.
- Propose shared-type, root, server, CI, environment, or architecture changes in the issue; do not implement them without Integrator approval.
- If Main API bulk-upsert/idempotency behavior is missing or incompatible, stop at the client boundary and request a Service Builder slice rather than embedding server work in the client PR.

- Keep popup/options UI in React and content/background code framework-independent TypeScript.
- Keep platform DOM logic behind the adapter boundary and add fixture-based regression tests.
- Work on the assigned branch and open or update one PR linked to the issue.
- Run the narrowest available typecheck, tests, build, manifest/Chrome smoke checks, and relevant browser-contract tests. Report actual results.

Stop and escalate on cross-component contract changes, permission/origin changes, ambiguous source-code consent, environment-policy changes, conflicting requirements, unjustified Dashboard scope/compute expansion, or two failed attempts.

## Finish

Update the PR body or issue and return:

```text
status:
issue:
pull_request:
changed_paths:
contract_requests:
checks_and_results:
risks:
next_skill: codearchive-quality-reviewer
next_model_tier: balanced
next_prompt:
```
