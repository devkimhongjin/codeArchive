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
