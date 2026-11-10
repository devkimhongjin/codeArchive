# AI code review (prepared, no model connected)

Status as of 2026-11-06: the feature is implemented end to end except the call
to a real model. It is **off** in every environment until an operator turns it
on, and the only provider is a deterministic fake for tests and local previews.
The requirements come from #251.

## What a user sees

When the server reports the feature enabled, the solution detail view in the
dashboard shows an "AI 코드 리뷰" card under the source code:

1. Before anything is sent, the card lists what would go to the provider
   (platform, problem number and title, language, execution time and memory,
   the whole source code), states that account details are not sent, that the
   result is stored with the account and deleted when consent is withdrawn, and
   that free-tier providers may use inputs to improve their models.
2. After the user agrees, "AI 리뷰 요청" asks for a review. The card shows the
   summary, numbered suggestions, the model, prompt version and time, and a
   reminder that suggestions can be wrong and the code is not changed.
3. "동의 철회" removes the consent and every stored review.

When the feature is off, the card is not rendered at all.

## Server

Package `com.codearchive.api.ai`, endpoints under `/api/ai` (GitHub session,
CSRF and the `X-CodeArchive-Github-Id` account header, like other account APIs):

| Endpoint | Purpose |
|---|---|
| `GET /status` | enabled, provider, model, daily limit, used today, consent, notice version, size limit |
| `POST /consent` `{noticeVersion}` | records consent to the current notice |
| `DELETE /consent` | withdraws consent and deletes the user's reviews |
| `GET /reviews/{captureId}` | stored review for the solution's current code, or 204 |
| `POST /reviews/{captureId}` | returns a stored review or asks the provider |

A request reaches the provider only when all of these hold, checked in order:

1. `codearchive.ai.enabled` is true and a provider bean exists → otherwise `503 AI_DISABLED`
2. the user consented to `AiReviewService.NOTICE_VERSION` → otherwise `409 CONSENT_REQUIRED`
3. the solution belongs to the user → otherwise `404 NOT_FOUND`
4. the code is within `max-source-bytes` → otherwise `413 SOURCE_TOO_LARGE`
5. no stored review has the same cache key → otherwise the stored review, without using the limit
6. the daily limit (Korean calendar day) allows one more call → otherwise `429 DAILY_LIMIT_REACHED`

The call is counted before it is made, so a timeout or failure still uses one.
Provider outcomes are distinct: `422 SAFETY_BLOCKED`, `504 PROVIDER_TIMEOUT`,
`502 PROVIDER_FAILED`. Nothing retries automatically.

- **Prompt** (`AiPromptTemplate`, version `code-review-v1`): problem identity,
  language, metrics and code; never the account, name, e-mail or GitHub id.
  Changing the text requires a new version, which also invalidates cached reviews.
- **Cache key** (`AiReviewCacheKey`): SHA-256 of language, code, provider,
  model and prompt version, unique per user.
- **Tables** (Flyway `V32__ai_code_review.sql`): `ai_consents`, `ai_reviews`,
  `ai_daily_usage`. They stay empty while the feature is off.

## Configuration

| Property | Environment | Default |
|---|---|---|
| `codearchive.ai.enabled` | `AI_ENABLED` | `false` (also the kill switch) |
| `codearchive.ai.provider` | `AI_PROVIDER` | `none`; `fake` for tests and previews |
| `codearchive.ai.daily-limit` | `AI_DAILY_LIMIT` | `5` |
| `codearchive.ai.max-source-bytes` | `AI_MAX_SOURCE_BYTES` | `20000` |
| `codearchive.ai.timeout-ms` | `AI_TIMEOUT_MS` | `20000` |

To preview locally, run the API with `AI_ENABLED=true AI_PROVIDER=fake`. The
fake never sends code anywhere; source containing `codearchive-ai-fake:timeout`,
`codearchive-ai-fake:fail` or `codearchive-ai-fake:block` exercises the failure states.

## Connecting a real model (not done)

1. Add an `AiReviewProvider` implementation selected by `codearchive.ai.provider`
   (for example `gemini`), reading its key from Secret Manager. It must honour
   the timeout it is given and never retry by itself.
2. Map the provider's safety refusal to `blocked`, its timeouts to
   `ProviderException(…, true)`, and everything else to `ProviderException(…, false)`.
3. Update the consent notice in `AiReviewPanel.tsx` with the provider's actual
   data-use terms, and bump `AiReviewService.NOTICE_VERSION` so every user
   consents again.
4. Deploy with `AI_ENABLED=false`, run an end-to-end check with a test account
   that has agreed, then enable it. `AI_ENABLED=false` stops all calls at once.

Not covered yet: BYOK or a paid tier for users who cannot send code to a free
tier, passing static-analysis results as prompt context (#250), and an
operator view of usage.
