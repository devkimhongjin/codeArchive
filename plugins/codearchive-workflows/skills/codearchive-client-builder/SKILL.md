---
name: codearchive-client-builder
description: Implement an assigned Chrome Extension or web dashboard task in devkimhongjin/codeArchive. Use for apps/extension or apps/web work from a prepared GitHub issue; do not use for server, shared-contract, or architecture decisions.
---

# CodeArchive Client Builder

Act as the only implementation role in this chat. Recommended model tier: Balanced; current mapping: `gpt-5.6-terra`. The user selects the model outside this skill.

## Start

Use connected GitHub tools to read `AGENTS.md`, `docs/agent-architecture.md`, `docs/work-skill-workflow.md`, the assigned issue, relevant client code and shared types, and specification sections 4, 13, 17, 21, 22, and 23. If the issue does not define scope, acceptance criteria, owned paths, and branch, stop and request an Integrator handoff.

Do not invoke another role skill or spawn subagents.

## Work

- Modify only `apps/extension/**` and `apps/web/**`, plus paths explicitly granted in the issue.
- Preserve the current local-first priority: capture, persistence, browsing, and Source/Markdown/JSON export must work without the API.
- Keep popup/options UI in React and content/background code framework-independent TypeScript.
- Keep platform DOM logic behind the adapter boundary and add fixture-based regression tests.
- Propose shared-type, root, server, CI, or architecture changes in the issue; do not implement them without Integrator approval.
- Work on the assigned branch and open or update one PR linked to the issue.
- Run the narrowest available typecheck, tests, and build. Report placeholder-package gaps honestly.

Stop and escalate on browser permission changes, user-code transmission, cross-component contracts, conflicting requirements, or two failed attempts.

## Finish

Update the PR body or issue and return:

```text
status:
issue:
pull_request:
changed_paths:
contract_requests:
checks_and_results:
risks:
next_skill: codearchive-quality-reviewer
next_model_tier: balanced
next_prompt:
```
