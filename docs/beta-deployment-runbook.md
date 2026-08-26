# CodeArchive zero-cost beta deployment runbook

Related: #37, #58, #59

This runbook covers the ~20-user SWEA beta deployment path. Infrastructure should stay at $0 recurring cost; live AI/model API usage is a separate cost/privacy gate.

## 1. Frozen topology

- Main API: Render Free Web Service, Docker, Singapore
- Main API origin: `https://codearchive-api.onrender.com`
- Analysis: Render Free Web Service, Docker, Singapore
- Analysis origin: `https://codearchive-analysis.onrender.com`
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

### Zero-cost usage guard

The current Render Hobby workspace plan has no monthly plan fee. Its included usage currently includes:

- 750 Free instance-hours per workspace/month
- 5 GB outbound bandwidth per workspace/month
- 500 Starter build-pipeline minutes per workspace/month

Traffic from Render to the external Neon database counts as Render outbound bandwidth. Keep the Render workspace without a payment method for this beta. Under Render's current policy, when a no-payment-method workspace would exceed billable bandwidth, Render suspends Free services for the remainder of the billing period instead of charging. When included build minutes are exhausted without a payment method, new builds are disabled instead of charged.

For this project, service suspension or delayed builds are preferable to silently creating infrastructure cost. Monitor Render Dashboard monthly usage during the beta and do not add a payment method merely to bypass a Free limit without a new owner decision.

## 4. Runtime auth values

Database values must be real Neon runtime values before the API can start successfully.

GitHub OAuth runtime values are managed manually in the Render Dashboard. They intentionally remain omitted from `infra/render.beta.yaml` so later Blueprint sync does not prompt for or overwrite manually managed auth settings.

Frozen non-secret beta values:

```text
GITHUB_CALLBACK_URL=https://codearchive-api.onrender.com/api/v1/auth/github/callback
CODEARCHIVE_EXTENSION_REDIRECT_URI=https://oohlcmihldmfninmdcmanddfmhoonmdl.chromiumapp.org/codearchive-auth
```

Runtime secret values that must never be committed or pasted into issues/chat:

```text
GITHUB_CLIENT_ID=<runtime value>
GITHUB_CLIENT_SECRET=<runtime secret>
```

For the deployed `codearchive-api` service, configure all four variables in the Render Dashboard and redeploy/restart the service after saving them. `CODEARCHIVE_EXTENSION_REDIRECT_URI` is frozen to the stable unpacked beta Extension ID from merged Issue #59 / PR #63 and must not be changed unless the manifest development key itself is intentionally rotated in a separately reviewed change.

## 5. Deployment smoke checks

Check Analysis:

```text
GET https://codearchive-analysis.onrender.com/health
```

Expected: HTTP 200 and service status `UP`.

Check Main API:

```text
GET https://codearchive-api.onrender.com/actuator/health
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

The beta Blueprint pins Analysis `PORT=8000`, matching the current Docker listener. Do not broaden the port configuration unless live Render evidence requires a bounded correction.

## 8. Stable beta Extension identity and OAuth

The Extension login uses:

```text
chrome.identity.getRedirectURL("codearchive-auth")
```

Merged Issue #59 / PR #63 freezes the unpacked beta Extension identity:

```text
Extension ID=oohlcmihldmfninmdcmanddfmhoonmdl
CODEARCHIVE_EXTENSION_REDIRECT_URI=https://oohlcmihldmfninmdcmanddfmhoonmdl.chromiumapp.org/codearchive-auth
```

Owner runtime acceptance confirmed that the same build loaded unpacked from two different directories produced the same Extension ID and the same `chrome.identity.getRedirectURL("codearchive-auth")` result.

GitHub OAuth callback points to the deployed Main API, not directly to the Extension:

```text
GITHUB_CALLBACK_URL=https://codearchive-api.onrender.com/api/v1/auth/github/callback
```

The exact GitHub OAuth application callback setting and the Render runtime values must match these strings exactly.

## 9. Browser permission gate

The Extension currently has `identity` only and no API `host_permissions`.

The exact beta Main API origin is now known:

```text
https://codearchive-api.onrender.com
```

Adding this origin to `host_permissions` is a separate owner-approved change. The allowed change, after explicit approval, is one exact Render API pattern only:

```json
"host_permissions": [
  "https://codearchive-api.onrender.com/*"
]
```

Do not use `*.onrender.com`, `<all_urls>`, localhost/LAN fallbacks, or the Analysis origin.

## 10. Real beta acceptance order

1. Neon + Render deployed with fake AI.
2. API / Analysis / Flyway health PASS.
3. Stable Extension ID from #59.
4. Configure the frozen GitHub callback and Extension completion URI in Render/GitHub OAuth runtime settings.
5. Obtain separate owner approval for `https://codearchive-api.onrender.com/*` in Extension `host_permissions`.
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
- browser permission expansion exceeds the exact separately approved API origin.
- live AI would transmit user source externally.
- a destructive DB migration/deletion is required.
