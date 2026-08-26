# CodeArchive Work Skill Workflow

## Goal

Run one explicit role Skill in each ChatGPT Work conversation. Select the model before invoking the Skill, and carry state between conversations through a GitHub issue and pull request instead of relying on chat history.

## Recommended sequence

| Stage | Model tier | Current model | Skill | Durable result |
|---|---|---|---|---|
| Plan | Strategic | `gpt-5.6-sol` | `@codearchive-integrator` | GitHub issue with scope, ownership, branch, acceptance criteria, and next prompt |
| Client implementation | Balanced | `gpt-5.6-terra` | `@codearchive-client-builder` | Linked implementation PR and test evidence |
| Service implementation | Balanced | `gpt-5.6-terra` | `@codearchive-service-builder` | Linked implementation PR and test/recovery evidence |
| Independent review | Balanced | `gpt-5.6-terra` | `@codearchive-quality-reviewer` | PR findings or approval |
| Final integration | Strategic | `gpt-5.6-sol` | `@codearchive-integrator` | Decision, approved merge, and next issue |
| Mechanical maintenance | Fast | `gpt-5.6-luna` | `@codearchive-repo-maintainer` | Small deterministic change and check output |

Model names are current bindings, not permanent architecture. If a model is renamed or unavailable, choose another available model at the same capability tier.

## One-chat rule

1. Select the recommended model.
2. Explicitly select exactly one CodeArchive Skill with `@`.
3. Give it one issue or PR URL and one bounded goal.
4. Do not ask that chat to switch roles, invoke another role Skill, or review its own implementation.
5. Start a new chat for the next Skill using the generated `next_prompt`.

## Source of truth

- The GitHub issue owns scope, acceptance criteria, path ownership, shared-boundary requests, risks, and the next role.
- The branch and PR own implementation state and test evidence.
- PR comments own review findings.
- `AGENTS.md`, `docs/agent-architecture.md`, and the development specification own durable project rules.

If chat output conflicts with GitHub state, GitHub state wins unless the Integrator explicitly updates it.

## Branch and release flow

1. Create bounded `feature/*`, `fix/*`, or `chore/*` branches from current `develop`.
2. Merge implementation pull requests into `develop` after the assigned checks and review pass.
3. Open a release pull request with the same repository's `develop` as the head and `master` as the base.
4. Obtain explicit owner approval immediately before merging the release pull request.
5. Keep provider auto-deploy disabled. After the merge, obtain a separate explicit owner approval immediately before manually deploying `master`.
6. Record the deployed commit and smoke evidence in the release issue or pull request.

No fork or other head branch may target `master`. Require the `Master Release Source / require-develop` status check in `master` branch protection so a failing policy check blocks merge. A merge into `master` does not by itself authorize deployment.

## Starting prompt

```text
Use @<skill-name> for devkimhongjin/codeArchive.

Issue or PR: <URL>
Goal: <one bounded outcome>
Done when: <observable acceptance condition>
```

For the first task, omit the issue URL and ask `@codearchive-integrator` to create it.

## Handoff requirements

Every Skill finishes with:

- current status;
- issue or PR URL;
- changed paths or decision;
- actual checks and results;
- unresolved risks;
- exactly one recommended next Skill and model tier;
- a ready-to-copy next prompt.

## Parallel work

The default is sequential execution. Run client and service chats in parallel only after the Integrator freezes their shared contract and assigns disjoint paths in the issue. Never let two chats edit the same path concurrently.

## Approval gates

The user must approve immediately before merging, production deployment, destructive migration or deletion, OAuth/browser permission expansion, secret rotation, cost-bearing external action, or external publication of user code.

