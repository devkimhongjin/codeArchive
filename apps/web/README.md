# CodeArchive Web Dashboard

Lightweight static React + TypeScript + Vite archive shell for the current beta.

## Commands

```bash
pnpm --filter @codearchive/web typecheck
pnpm --filter @codearchive/web test
pnpm --filter @codearchive/web build
```

The production static output directory is `apps/web/dist/`.

This bootstrap intentionally uses an in-memory fixture through `DashboardArchiveDataSource`. A later bounded slice can replace that adapter with authenticated Main API data without reading Extension IndexedDB from the Web app.

Not implemented here: GitHub OAuth/session, Extension Port connection, automatic synchronization, Main API persistence/retry, partial ACK, AI, deployment/provider configuration, or any concrete Dashboard origin.
