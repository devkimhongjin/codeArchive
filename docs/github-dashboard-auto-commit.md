# Dashboard GitHub upload and automatic commit

Issue #44 follow-up to #155/#156, refined by Issue #159. Dashboard remains the authority for GitHub target, consent, server run/lease, and provider writes. Issue #159 permits the capture-only Extension popup to display sanitized automation state and send limited ON/OFF intent only; it does not move GitHub ownership into the Extension.

## Manual upload

The optional archive panel loads the current personal GitHub App installation only after the user opens it. Select a repository (public/private shown), an unprotected branch, and an existing or new folder. Browse complete folder listings; override the file path/message if needed. The server produces a ten-minute, session-bound confirmation with exact code, file, message and repository visibility. Check transmission and visibility-risk consent, plus explicit public disclosure for public repositories. The UI submits the intent ID and consent only, never replacement code. A failed/uncertain send offers status lookup, never automatic resend. Changing the source version or target discards the preview and consent.

## Automatic authorization

- Default OFF. Separate from login, import auto-sync, manual upload, and community publishing. The existing automatic authorization does not become valid merely because the Extension popup requests ON.
- ON requires explicit automatic-code-transfer and visibility-risk consent, plus public-upload consent for a public repository. Dashboard stores the exact immutable installation/repository IDs, owner/name, privacy, branch head, and folder prefix. Those target values never cross into the Extension automation control plane.
- Immediately before activation, Dashboard re-reads the selected installation/repository/branch target from GitHub and refreshes the latest branch HEAD as the new expected HEAD. Revalidate target/HEAD again before every write according to the existing conditional-write contract.
- The initiating Dashboard page may be foreground **or background/hidden**. Visibility alone is not an ineligibility condition. The page must still exist, remain signed in, have authoritative auto-sync ON, maintain the single eligible Extension connection, remain online, and keep the current GitHub target/consent/run/lease valid.
- `pagehide`, tab close, navigation away, logout/session expiry/account change, Extension disconnect, offline, explicit OFF, multiple Dashboard tabs, target conflict/change, lease failure, or an uncertain GitHub outcome stop automatic execution. A new server session cannot tick an old run.
- There is **no background worker or scheduler**. The live Dashboard page requests at most one item at a time, with ten seconds between completed requests. Each accepted tick renews a 60-second server lease; an expired lease cannot be renewed. Closing/navigating the tab sends a best-effort OFF when possible. If that cannot reach the server, final-write checks reject work after lease expiry. A request already transmitting may finish; no claim of instantaneous network cancellation or code recall.
- Browser background timer throttling must not be worked around by weakening the lease, conditional-write, or no-retry guarantees. Real Chrome acceptance must prove at least one background lease-renewal/tick cycle. If the current 60-second lease cannot survive normal background behavior, the client must fail safe and a separate Integrator/Service Builder design is required before changing the lease.
- Client-generated run UUIDs make enable/stop ordering safe: OFF creates a durable tombstone even if it arrives before enable. No response or stale enable can reactivate that ID. Only one STARTING/ACTIVE run per account. New ON requires a new UUID and fresh consent.
- Select only `accepted_capture=true`, `result=ACCEPTED`, server `created_at > enabled_at`, and browser `observed_at >= enabled_at AND <= now`. Old records and late imports of old captures are excluded; client clock skew can conservatively exclude a capture. This is browser-observed provenance, not an official judge attestation. Manual upload remains available for otherwise eligible historical captures.
- Layout: `[folder/]platform/problemNumber/Solution.extension`, standard `Add platform problemNumber solution` message. No overwrite, backfill, rebase, force push, or automatic retry. A duplicate problem/path, protected branch, branch move, changed privacy/name/ownership, source edit/delete, or permission error pauses the run.
- A successful commit advances only this run's expected head to its own new commit. External head changes stop it. After OFF, Dashboard requires fresh branch/target confirmation and HEAD refresh before another manual/automatic run; popup state never silently resumes or reuses stale target/run state.

## Extension popup control boundary — Issue #159

The popup control is a metadata-only intent/control surface over the existing exact-origin Dashboard Port.

Extension -> Dashboard may send only:

```text
CODEARCHIVE_AUTOMATION_STATE_REQUEST
CODEARCHIVE_AUTOMATION_SET_REQUEST { automation: "GITHUB_AUTO_COMMIT", enabled }
CODEARCHIVE_AUTOMATION_SAFETY_STOP { errorCode: "MULTIPLE_DASHBOARD_TABS" }
```

Dashboard -> Extension may publish only the shared sanitized automation state. The GitHub portion exposed to Extension is limited to booleans such as `githubAutoCommitEnabled` and `githubTargetConfigured` plus fixed safe error codes. Do not send installation/repository IDs, owner/name, repository name, branch, folder, target SHA, account identity, consent detail, token/cookie/OAuth material, source, title, or problem URL.

Popup ON is intent, not consent. Dashboard handles it as follows:

1. require auto-sync authoritative ON;
2. require current authenticated single-tab Dashboard context and online Extension connection;
3. require an already configured GitHub target;
4. re-read target metadata and latest branch HEAD from GitHub;
5. require automatic-code-transfer and visibility-risk consent;
6. for a public repository, require the existing public-upload disclosure consent;
7. require no unresolved `UNKNOWN`/ATTEMPTED state that blocks safe execution;
8. only then create/enable a new run and publish authoritative ON.

If any requirement is missing, keep authoritative state OFF and publish only the applicable fixed error code such as `GITHUB_TARGET_REQUIRED`, `GITHUB_CONSENT_REQUIRED`, `PUBLIC_REPOSITORY_CONSENT_REQUIRED`, `GITHUB_TARGET_CHANGED`, or `GITHUB_OUTCOME_UNKNOWN`. The Extension never fabricates or repairs those conditions.

Popup OFF stops new client ticks immediately and uses the existing server `autoStop` flow when a run exists. After OFF is confirmed, captures accepted afterward are not automatically uploaded to GitHub. If auto-sync remains ON they may still be synchronized to the Main API. An external write already dispatched before OFF may finish and cannot be recalled. A later ON still requires Dashboard-side fresh target/branch confirmation and HEAD refresh; the popup never receives or persists those values.

## Multiple Dashboard tabs — fail closed

Automatic GitHub writing must never choose one of multiple connected Dashboard tabs arbitrarily.

When 2+ exact-origin Dashboard Ports are detected:

- Extension sends the fixed `MULTIPLE_DASHBOARD_TABS` safety-stop signal and invalidates automatic source-transfer capability/session state;
- Dashboard invalidates pending drain and stops any active GitHub auto-run;
- authoritative popup state becomes OFF with fixed guidance;
- no tab adopts or resumes another tab's run;
- closing the extra tab does not auto-resume. The user must explicitly enable again after returning to one eligible Dashboard tab.

This rule complements the server's one-active-run/account constraint and prevents competing browser drains/writers before they reach the server boundary.

## API and persistence

Authenticated/private/no-store `/api/v1/integrations/github/auto-commit`:

| Method | Path | Contract |
|---|---|---|
| GET | `/` or `/{runId}` | Current/latest account run or one owned run; never resume it |
| POST | `/{runId}/enable` | `{target:{installationId,repositoryId,branch,expectedCommitSha,folder,privateRepository,fullName},confirmAutomatic,acknowledgeVisibilityRisk,confirmPublicUpload}` |
| POST | `/{runId}/tick` | Server selects at most one new capture; no client source ID/code |
| POST | `/{runId}/stop` | OFF tombstone; remains usable with provider feature flags OFF |

Responses contain `runId,state,target,enabledAt,leaseUntil,errorCode,lastResult`; target IDs serialize as decimal strings. State is OFF/STARTING/ACTIVE/PAUSED. Last result includes status and the server-validated commit SHA/link, never source text. No App installation URL is fabricated when deployment has no configured integration.

V9 adds `github_auto_runs` and `github_auto_attempts`. Auto attempts durably claim `(user_id,solution_id)` before provider preparation. No source text/tokens are stored in either table or logged. Attempts survive source/session deletion; account deletion cascades. ATTEMPTED/UNKNOWN are never reclaimed and block new automatic runs pending operator investigation. This contract deliberately provides no unsafe “clear uncertain result” button. A normal error before transmission marks REJECTED and pauses; it is not automatically retried on later ON.

Manual and automatic consent/ledgers remain distinct. Both use `GitHubCommitExecutor`: bounded provider slots, fresh personal-installation verification, conditional `createCommitOnBranch(expectedHeadOid)` single-file creation, current source/version/hash, active session, all three feature flags, and final source/session locks. Automatic execution additionally locks and rechecks the active run before sending. OFF serializes against this lock: a completed OFF response prevents later sends, but cannot undo a write that already started. Durable attempt claims survive transaction rollback/process crash. Unknown provider/persistence outcomes never trigger retries. Existing #155 HTTP provider safeguards remain unchanged.

## Verification and rollout boundary

Use synthetic GitHub provider responses, real PostgreSQL 17 via CI where applicable, and local browser fixtures. Cover consent/default OFF, popup intent without consent/target, fresh target/HEAD revalidation, new versus historical records, account/session isolation, background visibility, stale lease, multiple Dashboard tabs, stop-before-enable, stop during preflight, concurrent ticks, edited/deleted sources, uncertain outcomes, and unchanged archive/local capture state. Keep existing manual commit regression tests green.

Real Chrome acceptance for Issue #159 additionally requires a non-sensitive test repository/branch and proves:

- one background Dashboard tab can maintain at least one lease-renewal/tick cycle while all other eligibility remains valid;
- one accepted capture produces at most one GitHub commit;
- GitHub auto OFF prevents later captures from being uploaded while auto-sync may remain ON;
- 2+ Dashboard tabs fail closed and never produce competing automatic commits;
- UNKNOWN/uncertain outcomes are not retried;
- Extension control payloads contain no GitHub target/account/source data.

This contract change does **not** enable GitHub App flags, install/configure an App, send user source to GitHub, change V9, alter API/DB/runtime configuration, expand browser/origin permissions, deploy beta, package the Extension, touch `master`, or authorize Production. Merge and beta runtime actions remain separate owner approval gates.

## Issue #177 superseding contract — fully closed Dashboard

Issue #177 adds a separate future execution generation for the literal state **Dashboard closed**, meaning no Dashboard document, tab, or external Port exists. This section supersedes the page-owned statements above only after the durable replacement generation is implemented, explicitly enabled, and accepted in exact-beta Real Chrome. Until then, the current #159 page-owned behavior remains normative and `pagehide`/disconnect still stops automatic execution.

### Durable execution ownership

The replacement flow is:

```text
ACCEPTED
→ Extension local IndexedDB commit
→ narrow append-only capture relay
→ Main API idempotent ingest
→ durable server automation worker
→ fresh GitHub target/HEAD validation
→ conditional create-only commit
```

The Main API/worker owns durable automatic execution, GitHub target state, consent state, attempt/lease state, provider validation, and GitHub writes. GitHub App credentials and short-lived installation tokens remain server-only. The Extension never receives GitHub credentials, repository write authority, target values, provider HEAD authority, or retry authority.

A server worker alone is not sufficient: while every Dashboard document is closed, newly captured source exists only in Extension local storage. Therefore the replacement generation requires the separately specified, narrowly scoped capture-relay grant. The relay is only a source delivery mechanism; it is not a GitHub automation credential.

### Durable automation state

The server persists only the background-continuation state needed for the current account/device automation generation:

- source-transfer enabled state;
- GitHub auto-commit enabled state;
- server-validated installation/repository/branch/folder target plus target generation/version;
- automatic source-transfer consent and GitHub visibility-risk consent;
- public-repository consent bound to current repository privacy/target generation;
- `enabledAt` or an equivalent monotonic automation generation boundary;
- durable worker run/attempt/lease state and terminal uncertainty state.

A persisted provider HEAD is never perpetual write authority. Before every GitHub mutation the server re-reads/revalidates the installation, repository ownership, privacy, branch/protection state and fresh HEAD, then uses the existing conditional create-only writer. No overwrite, rebase, force push, historical backfill, or automatic retry of uncertain work is introduced.

### New-capture-only invariant

Automatic GitHub eligibility is based on immutable original capture provenance and the current server ON generation, not on the time a delayed relay first reaches the server. A record captured before the current GitHub-auto ON generation is never automatically committed merely because it is ingested later. #166 manual pending recovery may still import historical pending records into Main API, but that import does not convert them into GitHub auto-backfill candidates.

### Lifecycle and pagehide

For the replacement durable generation:

- closing/navigating the Dashboard tears down page-local Port/capability, timers, requests, and any legacy page lease;
- `pagehide` does **not** by itself clear already confirmed durable source-transfer/GitHub-auto intent;
- explicit OFF stops new local relay immediately and must persist server OFF/revocation when reachable;
- if global OFF cannot be confirmed, UI/state must distinguish local stop from server revocation pending;
- logout/account switch revokes the device/account relay grant and disables the old account automation generation; stale responses cannot reactivate it;
- offline capture remains local and may relay only after connectivity returns and the same grant/generation is still valid;
- worker restart reconstructs work only from durable state/attempt ledger; `UNKNOWN` remains terminal and is never automatically retried;
- target, ownership, privacy, permission, branch/protection or generation mismatch fails closed.

The current `GitHubAutoCommit.tsx` page-owned run is not converted into an always-running owner by deleting its cleanup. Long-lived execution moves to the server only after the replacement worker exists.

### Multiple tabs and writer exclusivity

Dashboard tabs become controllers of durable state rather than competing execution owners. Multiple pages must not create multiple writers. Target/enable mutations require server generation/version checks and fail closed on stale/conflicting state. The existing #159 single-Port rule continues to protect Dashboard↔Extension source-capability operations while that bridge is used, but the durable worker never selects an arbitrary Dashboard tab as writer.

During migration there must be an explicit server-controlled execution mode/generation gate with two mutually exclusive modes:

- `PAGE_OWNED`: current #159 browser tick/60-second lease behavior;
- `DURABLE_SERVER`: #177 relay + worker behavior.

For one account/automation generation, exactly one mode may own GitHub execution. Enabling `DURABLE_SERVER` must first make page-owned execution ineligible and invalidate/stop any page-owned run before the worker can claim new work. Rollback reverses ownership only after durable worker claims are stopped/expired and must not reuse stale target/HEAD/run state. A fresh generation and fresh provider validation are required after every ownership transition.

No Web/Extension implementation may infer this handoff locally. The server feature/migration gate is authoritative and must prevent dual writers across deploy skew, browser refresh, worker restart, or rollback.

### #177 exact-beta acceptance

The replacement generation is not accepted until a reviewed exact `develop` beta proves in real Chrome:

1. GitHub auto is explicitly enabled and the relay/device context is provisioned while Dashboard is authenticated.
2. Every Dashboard document is fully closed.
3. A real ACCEPTED submission is committed to Extension IndexedDB.
4. The relay sends that capture exactly/idempotently to Main API while no Dashboard document exists.
5. The durable worker processes it and produces at most one conditional GitHub commit.
6. A pre-ON historical capture is not automatically committed when later relayed/imported.
7. explicit OFF/revocation, logout/account switch, offline/reconnect and Extension restart remain fail closed.
8. API/worker restart does not duplicate work or retry `UNKNOWN`.
9. target/privacy/permission/branch change stops before an unsafe provider write.
10. migration mode proves there is never both a page-owned writer and durable worker for the same generation.

Issue #86 remains blocked until this replacement E2E succeeds. This contract does not authorize a Render worker/service, environment/secret mutation, GitHub App permission mutation, Extension manifest/host permission expansion, beta deployment, `master`/Production, or cleanup. Each remains a separate owner gate.