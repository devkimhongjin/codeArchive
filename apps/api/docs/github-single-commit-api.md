# Explicit single-solution commit — #44, slice 4

Builds on [upload preview](github-upload-preview-api.md). Only `apps/api/**` changes.
This implements a disabled server capability; no live App permission, credential, repository write,
user-source transmission or deployment is performed by this change. Dashboard controls come later.

## Gates and scope

`GITHUB_APP_CONTENTS_WRITE_ENABLED=false` by default, in addition to the existing App integration
and Contents-read gates. All three must be enabled for intent preparation or commit execution.
Status reads remain available when the write switch is disabled. Actual enabling, selected App/
installation/repository, Contents-write grant, credentials, V8 migration and exact beta deployment
require separate owner execution approval. Ordinary login OAuth scope and origins do not change.

Write preparation mints a short-lived token restricted to exactly one repository ID with precisely
metadata:read + contents:write. Read-only endpoints still request their existing read-only scopes.
Only personally owned User installations/repositories qualify. No organizations, force push,
overwrite, new branches, empty-repository initialization, multi-file or automatic upload here.

## Confirmation and endpoints

Normal authenticated session, response envelope, private/no-store and Origin/Cookie/Authorization
Vary rules apply. Cookie POSTs require the configured exact Dashboard Origin; mixed credentials fail.

1. `POST /api/v1/integrations/github/upload-intents`
   Body: the same selection/version request as upload-preview. The server produces a fresh eligible,
   unblocked preview and persists its canonical selection, source SHA-256, repository name/privacy,
   current user/session and a random intent ID. Returns `{intentId,expiresAt,preview,consentNotice}`.
   Intent TTL is ten minutes, with at most twenty unexpired READY intents per account. The nested
   preview remains read-only (`uploadEnabled=false`); only the distinct confirmation/commit flow writes.
2. The client must show the returned exact source, target, path, message, privacy and consent notice.
   No source from a client request or an older standalone preview authorizes this action.
3. `POST /api/v1/integrations/github/upload-intents/{id}/commit`
   Body: `{confirmUpload:true,acknowledgeVisibilityRisk:true,confirmPublicUpload:true}`.
   The last field is required true for a public target; the first two are required for every target.
   Additional client source/path/message/owner fields cannot override the saved review. Consent is
   bound to the intent and current session, not to sync/community/AI consent. The boolean declarations
   are the API contract; the forthcoming UI must genuinely present the notice before setting them.
4. `GET /api/v1/integrations/github/upload-intents/{id}`
   Returns `{intentId,status,retryAllowed:false,commitSha,commitUrl,errorCode}` without source or provider
   credentials. Only the original account and active session may read or execute an intent. Logout,
   session expiry or another login session prevents reuse; no old-account async response may be adopted.

Success is `SUCCEEDED`, with a URL constructed from the validated repository name and returned SHA.
Repeated commit calls read the saved result, never re-dispatch. A known pre-send failure is `REJECTED`;
its saved safe error tells the client why a fresh review is needed. Expired READY intents cannot execute.
In-progress, crashed or uncertain dispatch is exposed as `UNKNOWN`, never as a retry invitation.

## Conditional create and local concurrency

Before any source is sent, the server freshly validates installation ownership, scoped repository
ID/owner/name/privacy, complete parent trees, path absence, branch head and protection. It resolves
the Ref's global node ID through the verified repository's REST ref endpoint. Repository metadata
and branch protection/head are checked again after the potentially long tree walk. Existing path,
file/symlink/submodule ancestor, incomplete tree, changed privacy/name/owner, protected/absent branch
or missing permissions prevents a write capability from being returned.

The only source-bearing provider call is GraphQL `createCommitOnBranch`: one addition, no deletions,
the exact UTF-8 code encoded as base64, the reviewed message, validated Ref node ID and mandatory
`expectedHeadOid`. The provider checks the expected head while creating/updating the branch. Since
absence was established in that commit's complete tree, a successful conditional operation is
create-only. An earlier REST pre-read or `force:false` alone would not establish that condition.
No intermediate blob/tree/commit objects or unreferenced source are deliberately uploaded via REST.

The returned commit must have exactly the expected parent and matching Ref identity/name/prefix.
Provider-controlled URLs and error messages are ignored. This is not a multi-operation distributed
transaction and not an exactly-once delivery guarantee.

After all provider preflight reads, a short local transaction share-locks the current user/session
and solution, rechecks active session, source provenance/version/digest and intent expiry, then holds
those locks over only the single mutation request. A prior edit/logout wins and prevents dispatch;
a competing edit/logout after these locks waits until the mutation completes/fails. This deliberately
differs from read-only preview, which holds no locks across network I/O. Source rows, publication state,
capture/ACK records and local IndexedDB are never mutated by upload success or failure.

The local lock wait is bounded at 2s; the final transaction has a 20s budget. Existing provider 5s connect/
10s read timeouts and no automatic retries apply. Two execution slots per API process bound connection
pressure; excess commits fail with 429. Preflight tree reads occur outside the final DB transaction
and may take multiple provider-call timeouts. The semaphore is a resource bound, not an idempotency lock.

## Durable at-most-once attempts (V8)

V8 adds only `github_upload_intents`. It stores review metadata/digest, IDs, timestamps, outcome and
successful commit reference; no source, provider response, token, secret or cookie is persisted.
It neither backfills nor modifies solutions. Deploying this code later applies this additive migration,
even when feature flags are off. Do not edit V7 or claim V8 is already deployed.

READY -> ATTEMPTED is committed in a separate transaction **before** any possible source dispatch.
A partial unique index on user + hash(repository ID, branch, expected head, path) covers ATTEMPTED,
SUCCEEDED and UNKNOWN. It blocks concurrent different intent IDs, session changes, message changes
or another source version from repeating the same possibly dispatched target. Application restart
and rollback of the final source-lock transaction cannot undo the durable attempt.

Pre-send failure can terminate as REJECTED, releasing that target for a fresh explicit review.
After entering the mutation call, every transport/HTTP/GraphQL/partial/malformed response failure
is conservatively UNKNOWN, including failures that might in fact be definite rejections. If the
mutation succeeds but its local receipt fails, it is also non-retryable. A crash can leave ATTEMPTED
forever; status maps this to UNKNOWN. `clientMutationId` is not treated as provider idempotency.

There is no automatic timeout reclamation, resend, queue, cleanup of dispatch tombstones, or recovery
that blindly resets UNKNOWN to READY. Operators must inspect the repository and actual attempt before
any future recovery flow is designed. This sacrifices automatic recovery to avoid duplicate commits.
Session/solution deletion does not cascade the ledger; account deletion removes its ledger with the
account. A recreated account is a new identity requiring fresh consent, not continuation of old intents.

## Privacy and remaining limits

Repository visibility/ownership/protection are rechecked but GitHub's commit mutation does not accept
an atomic expected-privacy or expected-owner condition. A simultaneous change after the last read,
including after upload, cannot be locked by this API. The consent notice explicitly warns that even
a private repository can become public during/after transmission and that sent source cannot be
automatically recalled. Public repositories require the additional public-upload declaration.
If that external visibility risk is unacceptable, do not enable or use upload. This limitation must
remain visible in the forthcoming UI; never describe private-source confidentiality as guaranteed.

GitHub enforces current installation permission and repository rules at mutation time; this code
requests no bypass. A protected=false preflight does not guarantee every repository rule permits
the operation. A branch can move after a successful commit; the success receipt identifies a commit,
not a promise that it remains the latest head. A repository rename after dispatch can make the
constructed receipt URL stale; raw provider URLs are still not trusted.

## Verification and follow-up

Strict mock HTTP tests cover exact write scopes, fixed endpoints, Ref/expected-head/base64 payload,
one addition, one-shot capability, all mutation error classes/no retry, changed owner/name/privacy/
protection/head, collision/truncation and disabled gates. PostgreSQL + full security/MVC tests exercise
real bulk-capture provenance, canonical review, consent, account/session isolation, expiry/revocation,
independent concurrent edits/logout, different-intent uniqueness, prior-process tombstones and lost
success receipts. Full Java 21 API CI is required. No live App E2E is claimed.

Owner steering on 2026-09-01 additionally requests **automatic solution commit ON/OFF**. Carry this
into follow-up settings/UI work: default OFF; separate opt-in bound to account and selected repository/
branch/path rule plus disclosure; only new accepted captures after enablement (no implicit historical
backfill); stop on conflict, permission loss or uncertain result. OFF must stop new dispatches and
clear pending authorization safely; already transmitted code cannot be recalled. Do not turn on
background commits merely because this manual endpoint exists. The setting/worker/UI is not implemented
by this slice. Dashboard manual upload/consent and automatic opt-in remain explicit subsequent work.

Official references checked 2026-09-01:
[conditional commit input and authorship](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch),
[Ref identity and file additions](https://docs.github.com/en/graphql/reference/git#committablebranch),
[installation authentication for GraphQL](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
[REST reference updates](https://docs.github.com/en/rest/git/refs#update-a-reference).
