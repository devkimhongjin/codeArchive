# Dashboard GitHub upload and automatic commit

Issue #44 follow-up to #155; owner requested automatic solution commit ON/OFF. Integrator-owned contract for `apps/web` and `apps/api`. No Extension, shared capture schema, OAuth scopes, dependencies or deployment settings change.

## Manual upload

The optional archive panel loads the current personal GitHub App installation only after the user opens it. Select a repository (public/private shown), an unprotected branch, and an existing or new folder. Browse complete folder listings; override the file path/message if needed. The server produces a ten-minute, session-bound confirmation with exact code, file, message and repository visibility. Check transmission and visibility-risk consent, plus explicit public disclosure for public repositories. The UI submits the intent ID and consent only, never replacement code. A failed/uncertain send offers status lookup, never automatic resend. Changing the source version or target discards the preview and consent.

## Automatic authorization

- Default OFF. Separate from login, import auto-sync, manual upload, and community publishing. No local-storage preference and no automatic resumption after refresh/login.
- ON requires explicit automatic-code-transfer and visibility-risk consent, plus public-upload consent for a public repository. Store the exact immutable installation/repository IDs, owner/name, privacy, branch head, and folder prefix. Revalidate these with GitHub before activation and before every write.
- Only while the initiating Dashboard page is visible, signed in, and has enabled auto-sync with an active Extension connection. Page hide, page close, offline, disconnect, OFF or logout stops the client. Other tabs may inspect/stop a run but cannot adopt it. A new server session cannot tick the old run.
- There is **no background worker or scheduler**. The page requests at most one item at a time, with ten seconds between completed requests. Each accepted tick renews a 60-second server lease; an expired lease cannot be renewed. Closing a tab sends a best-effort keepalive OFF. If that cannot reach the server, final-write checks reject work after lease expiry. A request already transmitting may finish; no claim of instantaneous network cancellation or code recall.
- Client-generated run UUIDs make enable/stop ordering safe: OFF creates a durable tombstone even if it arrives before enable. No response or stale enable can reactivate that ID. Only one STARTING/ACTIVE run per account. New ON requires a new UUID and fresh consent.
- Select only `accepted_capture=true`, `result=ACCEPTED`, server `created_at > enabled_at`, and browser `observed_at >= enabled_at AND <= now`. Old records and late imports of old captures are excluded; client clock skew can conservatively exclude a capture. This is browser-observed provenance, not an official judge attestation. Manual upload remains available for otherwise eligible historical captures.
- Layout: `[folder/]platform/problemNumber/Solution.extension`, standard `Add platform problemNumber solution` message. No overwrite, backfill, rebase, or retry. A duplicate problem/path, protected branch, branch move, changed privacy/name/ownership, source edit/delete, or permission error pauses the run.
- A successful commit advances only this run's expected head to its own new commit. External head changes stop it. After OFF the UI requires a fresh branch selection before another manual/automatic run.

## API and persistence

Authenticated/private/no-store `/api/v1/integrations/github/auto-commit`:

| Method | Path | Contract |
|---|---|---|
| GET | `/` or `/{runId}` | Current/latest account run or one owned run; never resume it |
| POST | `/{runId}/enable` | `{target:{installationId,repositoryId,branch,expectedCommitSha,folder,privateRepository,fullName},confirmAutomatic,acknowledgeVisibilityRisk,confirmPublicUpload}` |
| POST | `/{runId}/tick` | Server selects at most one new capture; no client source ID/code |
| POST | `/{runId}/stop` | OFF tombstone; remains usable with provider feature flags OFF |

Responses contain `runId,state,target,enabledAt,leaseUntil,errorCode,lastResult`; target IDs serialize as decimal strings. State is OFF/STARTING/ACTIVE/PAUSED. Last result includes status and the server-validated commit SHA/link, never source text. No App installation URL is fabricated when deployment has no configured integration.

V9 adds `github_auto_runs` and `github_auto_attempts`. Auto attempts durably claim `(user_id,solution_id)` before provider preparation. No source text/tokens are stored in either table or logged. Attempts survive source/session deletion; account deletion cascades. ATTEMPTED/UNKNOWN are never reclaimed and block new automatic runs pending operator investigation. This slice deliberately provides no unsafe “clear uncertain result” button. A normal error before transmission marks REJECTED and pauses; it is not automatically retried on later ON.

Manual and automatic consent/ledgers remain distinct. Both use `GitHubCommitExecutor`: bounded provider slots, fresh personal-installation verification, conditional `createCommitOnBranch(expectedHeadOid)` single-file creation, current source/version/hash, active session, all three feature flags, and final source/session locks. Automatic execution additionally locks and rechecks the active run before sending. OFF serializes against this lock: a completed OFF response prevents later sends, but cannot undo a write that already started. Durable attempt claims survive transaction rollback/process crash. Unknown provider/persistence outcomes never trigger retries. Existing #155 HTTP provider safeguards remain unchanged.

## Verification and rollout boundary

Use synthetic GitHub provider responses, real PostgreSQL 17 via CI, and local browser fixtures. Cover consent/default OFF, new versus historical records, account/session isolation, stale lease, stop-before-enable, stop during preflight, concurrent ticks, edited/deleted sources, uncertain outcomes, and unchanged archive/local capture state. Keep existing manual commit regression tests green after extracting the shared writer.

This code does **not** enable any GitHub App flags or install/configure an App, does not send user source to GitHub, and does not apply V9 to a live database. API/Web deployment of an exact reviewed develop commit and live App permission/source-transfer acceptance remain separate owner-approved runtime actions. Production and #86 cleanup are outside this slice.
