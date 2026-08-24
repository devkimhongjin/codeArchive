# Model Routing Reference

Model names and availability change. Treat capability tiers as the stable interface and concrete model names as runtime bindings. Confirm the actual model catalog in the target environment instead of inventing a version.

## Resolve the current catalog

Use this order before assigning concrete models:

1. Read the model list supplied by the current runtime, provider configuration, or user.
2. When the current choice matters and the catalog is unavailable or ambiguous, consult the provider's official model documentation if access is available.
3. Compare supported modalities, reasoning and coding capability, context capacity, tool use, latency, cost, regional availability, and relevant safety or data-handling constraints.
4. Assign the lowest capability tier that meets the task's reliability requirement.
5. Record the tier separately from the selected model so a future model can replace it without redesigning the agent topology.

Never classify an unfamiliar model from its name, apparent version number, or marketing position alone. If evidence is insufficient, use a known adequate model as a provisional fallback or ask the user to choose.

## Illustrative provider mappings

| Capability tier | Codex examples | Anthropic examples | Typical work |
| --- | --- | --- | --- |
| Strategic | `gpt-5.6-sol` | Claude Opus | orchestration, architecture, ambiguous planning, cross-agent integration, high-risk judgment |
| Balanced | `gpt-5.6-terra`, or another capable general coding model | Claude Sonnet | ordinary feature implementation, domain analysis, test design, substantive review |
| Fast | `gpt-5.6-luna` | Claude Haiku when available; otherwise Sonnet with a constrained budget | bounded implementation, routine feedback, formatting, extraction, mechanical tests |

The examples are non-binding aliases that illustrate the tiers. They may be renamed, removed, or superseded. A specialized model or tool-enabled agent may outperform a larger general model on a narrow task.

When an example is unavailable, do not fail and do not silently substitute by name similarity. Re-run the catalog-resolution process and bind the tier to the best supported candidate.

## Portable routing record

Represent assignments in a form that preserves the requirement when models change:

```yaml
role: integrator
capability_tier: strategic
resolved_model: <current-model-id>
selection_basis:
  - cross-component reasoning
  - large project context
  - reliable tool use
fallback_tier: strategic
mapping_status: confirmed
```

Use `mapping_status: provisional` when the model's capabilities could not be verified. Do not put a provisional model in sole control of high-risk or irreversible actions.

## Routing rules

- Put the orchestrator or integrator on the strategic tier when it must understand the whole project, resolve conflicting outputs, or make architecture-wide decisions.
- A small, well-specified project may use a balanced-tier model as both coordinator and implementer.
- Put routine, reversible, well-tested work on the fast tier. Give it explicit inputs, output format, and acceptance tests.
- Use the balanced tier for implementation that requires local design judgment or substantial repository context.
- Use the strategic tier for unclear requirements, difficult debugging across components, security boundaries, migrations, or repeated failures at lower tiers.
- For independent review, choose a tier capable of finding the expected failure class. Mechanical lint feedback can be fast; architecture, security, and correctness review usually cannot.
- Do not downgrade merely to increase parallelism. Two weak agents do not reliably replace one agent with enough capability and context.

## Escalation triggers

Escalate the current task or return it to the orchestrator when any of these occurs:

- requirements conflict or the success criterion is unclear
- the change affects multiple components outside the assigned scope
- two reasonable approaches have materially different trade-offs
- tool output is inconsistent, incomplete, or untrusted
- the same approach fails twice without new evidence
- the action is irreversible, security-sensitive, or externally consequential
- integration tests fail in a way the assigned agent cannot localize

## Cost and latency controls

- Keep routine execution on the fast or balanced tier and reserve strategic calls for branching decisions and integration.
- Parallelize only independent work whose expected time saving exceeds coordination overhead.
- Limit proposer–critic loops with a fixed number of candidates or review rounds.
- Summarize completed work into durable artifacts before handing it to another agent.
- Re-evaluate routing after scope changes; do not keep an expensive team alive after the difficult phase ends.
