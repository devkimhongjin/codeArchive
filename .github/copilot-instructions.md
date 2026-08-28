# CodeArchive repository instructions

Read `AGENTS.md` and `docs/agent-architecture.md` before changing the repository. Read the relevant sections of `docs/codearchive-development-spec.md`; read the entire document for architecture-wide work.

CodeArchive is a local-first coding-test solution archive. The current priority is the React Chrome Extension prototype and local storage/export flow. Do not introduce a server dependency into prototype functionality.

Respect path ownership and shared-boundary rules in `AGENTS.md`. Never edit a path owned by another active agent, and never change shared contracts without project-integrator approval. Validate only claims supported by actual command output. Escalate security, schema, authentication, cross-service, or conflicting-requirement decisions.

