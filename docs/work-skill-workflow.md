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
| Final integration | Strategic | `gpt-5.6-sol` | `@codearchive-integrator` | Decision, approved merge, environment validation route, and next issue |
| Mechanical maintenance | Fast | `gpt-5.6-luna` | `@codearchive-repo-maintainer` | Small deterministic change and check output |

Model names are current bindings, not permanent architecture. If a model is renamed or unavailable, choose another available model at the same capability tier.

## One-chat rule

1. Select the recommended model.
2. Explicitly select exactly one CodeArchive Skill with `@`.
3. Give it one issue or PR URL and one bounded goal.
4. Do not ask that chat to switch roles, invoke another role Skill, or review its own implementation.
5. Start a new chat for the next Skill using the generated `next_prompt`.

## Source of truth

- The GitHub issue owns scope, acceptance criteria, path ownership, shared-boundary requests, risks, target environment, and the next role.
- The branch and PR own implementation state and test evidence.
- PR comments own review findings.
- `AGENTS.md`, `docs/agent-architecture.md`, `docs/extension-dashboard-handoff-design.md`, and the development specification own durable project rules.

If chat output conflicts with GitHub state, GitHub state wins unless the Integrator explicitly updates it.

## Branch and environment flow

### Implementation

1. Create bounded `feature/*`, `fix/*`, or `chore/*` branches from current `develop`.
2. Target implementation pull requests to `develop`.
3. Run required checks and independent review when risk justifies it.
4. Obtain explicit owner approval immediately before merging the implementation PR into `develop`.

### Development / beta runtime

1. `develop` is the integration branch and the source for development/beta runtime validation.
2. After a relevant change is integrated, the Integrator may prepare a development/beta deployment of an exact `develop` commit.
3. Development/beta deployment is an external runtime action: obtain explicit owner approval immediately before executing it.
4. Keep provider auto-deploy disabled unless a later explicit owner decision changes that policy.
5. Record the deployed `develop` commit and smoke/real-browser evidence durably.
6. A beta deployment does not authorize Production and does not require promotion to `master` first.

### Production release

1. Promote only an accepted `develop` commit through a same-repository `develop` → `master` release pull request.
2. No fork or other head branch may target `master` for release.
3. Require the `Master Release Source / require-develop` status check in `master` branch protection.
4. Obtain explicit owner approval immediately before merging `develop` → `master`.
5. Treat the resulting exact `master` commit as the Production candidate.
6. Obtain a new and separate explicit owner approval immediately before Production deployment.
7. Never deploy Production directly from `develop`.

If only beta provider resources currently exist, leave them as beta resources. Production resource creation, provider separation, domain migration, or paid capacity is a separate Integrator decision and approval gate.

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
- security/privacy/consent impact;
- environment/deployment impact;
- unresolved risks;
- exactly one recommended next Skill and model tier;
- a ready-to-copy next prompt.

## Parallel work

The default is sequential execution. Run client and service chats in parallel only after the Integrator freezes their shared contract and assigns disjoint paths in the issue. Never let two chats edit the same path concurrently.

For the capture-only transition:

- route Extension bridge and Dashboard login/auto-sync as separate bounded client slices;
- treat `docs/extension-dashboard-handoff-design.md` plus approved shared types as the frozen interface;
- do not ask an Extension implementation chat to add OAuth, CodeArchive token storage, or direct Main API synchronization;
- the Extension may notify an already-connected Dashboard of local capture changes, but Dashboard owns authenticated pending drain, API retry, upsert, and account context;
- do not remove the legacy Extension OAuth/direct-sync path until replacement real-Chrome E2E passes and the Integrator opens a dedicated cleanup slice.

## Approval gates

The user must approve immediately before:

- merging an implementation PR into `develop`;
- development/beta deployment or restart/redeploy that changes external runtime state;
- merging `develop` → `master`;
- Production deployment;
- destructive migration or deletion;
- OAuth/browser/origin permission expansion;
- secret rotation;
- cost-bearing external action;
- external publication/upload of user code beyond the product flow already explicitly enabled by the user.

Separate gates do not imply each other. In particular:

- implementation merge approval != beta deployment approval;
- beta deployment approval != release merge approval;
- release merge approval != Production deployment approval.
