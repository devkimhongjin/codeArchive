# CodeArchive zero-cost beta deployment runbook

Related: #37, #58, #59

This runbook covers the ~20-user SWEA beta deployment path. Infrastructure should stay at $0 recurring cost; live AI/model API usage is a separate cost/privacy gate.

## 1. Frozen topology

- Main API: Render Free Web Service, Docker, Singapore
- Analysis: Render Free Web Service, Docker, Singapore
- Database: Neon Free PostgreSQL 17, AWS Singapore
- Redis/cache/queue: none for the MVP beta
- Analysis provider: `fake`
- Auto deploy: off
- Live OpenAI: disabled

Merged Render Blueprint: `infra/render.beta.yaml`.

## 2. Neon

Verified beta project properties:

- project name: `codearchive-beta`
- region: AWS Singapore (`aws-ap-southeast-1`)
- PostgreSQL: 17
- default branch: `production`
- default database: `neondb`
- default role: `neondb_owner`

Do not put the Neon password or complete connection string in GitHub, chat, logs, screenshots, or committed files.

For Render `codearchive-api`, use the Neon direct/non-pooler compute endpoint:

```text
SPRING_DATASOURCE_URL=jdbc:postgresql://<direct-neon-host>/neondb?sslmode=require
SPRING_DATASOURCE_USERNAME=neondb_owner
SPRING_DATASOURCE_PASSWORD=<runtime secret>
```

Do not use the `-pooler` hostname for the frozen Flyway/Hikari beta path.

## 3. Create the Render Blueprint

Blueprint creation is a Render Dashboard action. The Render CLI is used for validation, but the current CLI does not provide a command that creates a new Blueprint from a repository YAML file.

Before creation, validate from the repository root:

```powershell
render workspace current
render blueprints validate infra/render.beta.yaml
```

Expected structure:

- Services: 2
- `codearchive-api`: `web`, `free`, `singapore`
- `codearchive-analysis`: `web`, `free`, `singapore`
- no Render database
- no paid/private service

In Render Dashboard:

1. New -> Blueprint.
2. Connect `devkimhongjin/codeArchive`.
3. Branch: `develop`.
4. Blueprint path: `infra/render.beta.yaml`.
5. Confirm both services are Free and Singapore.
6. Provide only required runtime values.
7. Deploy Blueprint.

Do not accept a paid-plan upgrade prompt.

## 4. Initial runtime values

Database values must be real Neon runtime values before the API can start successfully.

GitHub OAuth values can be configured after the stable Render API origin and stable beta Extension ID are known. Until then, GitHub login is expected to remain unavailable; local-first capture and deployed health checks are independent of OAuth.

Runtime-only auth fields:

```text
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_CALLBACK_URL
CODEARCHIVE_EXTENSION_REDIRECT_URI
```

Never commit their secret values.

## 5. Deployment smoke checks

After Render creates both services, record their public HTTPS origins without credentials.

Check Analysis:

```text
GET https://<analysis-origin>/health
```

Expected: HTTP 200 and service status `UP`.

Check Main API:

```text
GET https://<api-origin>/actuator/health
```

Expected: HTTP 200 / `UP` after Neon connectivity and Flyway startup succeed.

Then verify Neon contains Flyway migrations V1 through V5 and the application tables.

Do not post rows containing access tokens, source code, OAuth state, exchange codes, or other user data as evidence.

## 6. Analysis public-boundary check

Analysis is a Free Web Service because Render Free has no private-service equivalent for this topology. Its public `/health` endpoint is allowed, but `/internal/**` must remain protected by the generated `ANALYSIS_INTERNAL_TOKEN` bearer token.

Required smoke behavior:

- missing bearer token -> rejected
- invalid bearer token -> rejected
- Main API with the generated token -> accepted
- Extension -> never calls Analysis directly

## 7. Render Free port note

Render Web Services default `PORT` to `10000` and recommend binding to `$PORT` on `0.0.0.0`.

The current Analysis Docker image binds Uvicorn to `0.0.0.0:8000`. Render can usually detect an alternate bound HTTP port, so do not change this speculatively. If the first Analysis deploy fails specifically because no bound port is detected, capture the non-secret deploy error and open a bounded Service Builder correction.

Allowed correction candidates after evidence:

- explicitly set the Analysis Render `PORT` to `8000`, or
- update its Docker start command to use Render `$PORT` while preserving local defaults.

## 8. Stable beta Extension ID before OAuth

The current extension login uses:

```text
chrome.identity.getRedirectURL("codearchive-auth")
```

Issue #59 owns stabilizing the unpacked beta Extension ID. Do not configure the final Extension completion URI until #59 produces one stable ID.

Final form:

```text
CODEARCHIVE_EXTENSION_REDIRECT_URI=https://<stable-extension-id>.chromiumapp.org/codearchive-auth
```

GitHub OAuth callback points to the deployed Main API, not directly to the Extension:

```text
GITHUB_CALLBACK_URL=https://<api-origin>/api/v1/auth/github/callback
```

## 9. Browser permission gate

The Extension currently has `identity` only and no API `host_permissions`.

After the exact Main API HTTPS origin exists, adding that one origin to `host_permissions` requires a separate immediate owner approval. Do not use wildcards, `<all_urls>`, LAN fallbacks, or the Analysis origin.

## 10. Real beta acceptance order

1. Neon + Render deployed with fake AI.
2. API / Analysis / Flyway health PASS.
3. Stable Extension ID from #59.
4. Configure exact GitHub callback and Extension completion URI.
5. Request owner approval for one exact API `host_permissions` origin.
6. Build/load beta Extension.
7. Test GitHub accounts A and B for ownership isolation.
8. Test logout/local save/account switch/API-down retry behavior.
9. Only after separate owner approval, consider live OpenAI acceptance.

## 11. Stop conditions

Stop and escalate instead of silently changing scope when any of these occur:

- Render proposes a paid resource or payment upgrade.
- deployed resource differs from Free/Singapore topology.
- Neon is not Singapore/PostgreSQL 17.
- a secret would need to be committed or pasted into an issue/chat.
- browser permission expansion is required.
- live AI would transmit user source externally.
- a destructive DB migration/deletion is required.
