# CodeArchive

CodeArchive is a local-first service for automatically capturing, organizing, exporting, reviewing, and analyzing coding-test solutions.

The current implementation priority is the Chrome Extension prototype: manual capture, local persistence, popup browsing, and Source/Markdown/JSON export must work before server-dependent features are added.

## Documentation

- [Development specification](docs/codearchive-development-spec.md)
- [Agent architecture](docs/agent-architecture.md)
- [Repository agent instructions](AGENTS.md)
- [ChatGPT Work Skill workflow](docs/work-skill-workflow.md)

## Agent workflow

Start cross-component work with `project-integrator`. Use `client-builder` for Extension/Web work, `service-builder` for Spring/FastAPI/infra work, and `quality-reviewer` for independent validation. `repo-maintainer` is reserved for explicitly assigned mechanical tasks.

Agent profiles live in `.github/agents/`; repository-wide rules live in `AGENTS.md` and `.github/copilot-instructions.md`.

## Current workspace

- `apps/extension`: Chrome Extension (initial scaffold)
- `apps/web`: React dashboard (initial scaffold)
- `apps/api`: Java 21 / Spring API
- `apps/analysis`: FastAPI analysis service
- `packages/shared-types`: shared TypeScript contracts
- `infra`: PostgreSQL and Redis development infrastructure


## ChatGPT Work skills

Install the repo-scoped `codearchive-workflows` plugin, select the recommended model, and invoke exactly one role Skill per chat. Skills pass work between chats through a GitHub issue and pull request; see the workflow document above.
