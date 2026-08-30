# Dashboard AI beta acceptance

Scope: Issue #31 / #84, after Dashboard authentication, synchronization, and server management. This is a bounded Dashboard feature, not a provider change or permission to deploy. Extension cleanup (#86) remains gated on replacement E2E.

## Implemented contract

- The server solution's **AI 도우미 열기** button loads saved artifacts with cookie-authenticated `GET /api/v1/solutions/{serverUuid}/ai-artifacts`. Nothing is requested merely by selecting a solution.
- **접근 방법 설계**, **주석 코드 생성**, and **코드 리뷰** map to `APPROACH_DESIGN`, `COMMENTED_CODE`, and `CODE_REVIEW`.
- Each creation requires a separate confirmation explaining source/metadata transmission to the analysis service/configured provider and quota consumption. Auto-sync consent does not authorize AI execution.
- `POST` sends exactly `{ "type": "..." }`. The API chooses the authenticated owner and reads the already saved source. No source, account ID, token, or provider setting is accepted from the UI request body.
- Success envelopes and artifact identity/type/solution binding are validated. Artifacts render as plain text, never executable HTML. `fake` output is explicitly labelled as a test result.
- Saved artifacts are separate from original code and can describe an earlier version. Generation never overwrites the original.
- Generation disables duplicate execution, edit, and delete. Switching solutions, logout, and account replacement abort local requests and discard late results. Server work may still complete after the client stops waiting.
- List requests have a 20-second body-inclusive deadline; creation has 120 seconds for the beta analysis service's 90-second cold-start allowance. There are no automatic creation retries. After an uncertain result, reload artifacts before deciding to request again; quota may already be consumed.
- Current-session 401 uses existing auth/consent teardown. Quota/unavailable responses use safe messages and preserve already displayed results.

## Automated and local browser evidence

- 52 AI-specific client/component cases cover all task kinds, cookie/body contract, malformed/misbound responses, quota/auth failures, deadlines, cancellation, explicit consent, duplicate suppression, inert text, original retention, and stale account/solution responses.
- The complete Web suite has 212 tests across 19 files, plus TypeScript checking and production build.
- Local Chrome synthetic fixtures verify consent cancellation, all three tasks, busy controls, fake labelling, inert text, and account isolation in the UI. This is not deployed two-user acceptance or a live-provider test.
- The test-only preview entry is not part of the committed application or production build.

## Remaining deployed acceptance

Record the reviewed exact `develop` SHA, deployed Dashboard/API/Analysis SHAs, Extension package hash/ID, browser version, timestamp, and pass/fail evidence. Do not record source, tokens, cookies, OAuth codes, or raw provider errors.

1. Obtain separate approval for beta deployment and any runtime/source-transmission actions. Keep auto-deploy off, use existing beta resources, and keep the configured fake provider for no-cost smoke testing. Never infer production approval.
2. With account A and a disposable synthetic saved solution, open AI results; cancel each request once and verify no new artifact. Explicitly confirm each of the three task types and verify separate persisted output, correct type, fake label, and unchanged original code.
3. Refresh/reopen the Dashboard and verify the saved outputs remain. If analysis is slow or unavailable, verify no automatic POST retry; check saved results before repeating an uncertain request.
4. Log out while a request is pending. With a distinct GitHub account B, verify no A artifact or late A result appears. Check that the API denies B access to A's solution and artifact IDs using the approved authenticated test harness; do not expose credentials in logs.
5. After a separately approved restart/redeploy, verify solution/artifact durability in PostgreSQL. A UI refresh alone is not durability evidence.
6. Complete offline SWEA capture, exact-origin bridge, explicit auto-sync consent, reconnect catch-up, partial ACK, idempotency, logout/account boundaries, and local retention from `extension-dashboard-handoff-design.md` before removing legacy Extension auth/AI code.

The deployed two-account tests, real SWEA capture, runtime durability, and provider operation remain release gates even when local tests pass. Live paid-provider testing requires a separate explicit decision and must not be substituted for the fake-provider smoke test.
