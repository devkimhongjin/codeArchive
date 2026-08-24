---
name: project-agent-architect
description: Design the smallest effective agent structure and model-routing plan before a software, research, content, or operations project begins. Use when deciding whether to use one or multiple agents, assigning agent roles, selecting model capability tiers, defining handoffs, or restructuring an inefficient agent team; do not use for a simple bounded task that needs no orchestration decision.
---

# Project Agent Architect

Design an agent system that fits the work instead of maximizing the number of agents. Treat model selection, context flow, tool permissions, validation, and stopping conditions as parts of one architecture decision.

## Design knowledge

Read [references/agent-design-principles.md](references/agent-design-principles.md) when evaluating whether agentic behavior, multiple agents, memory, tools, deeper planning, or operational safeguards are justified.

## Start with the project

Use the supplied brief, repository, requirements, constraints, and available model list. Inspect relevant artifacts when available. Ask only for missing information that would materially change the structure, such as the deliverable, deadline, risk level, supported providers, or cost/latency priority.

Characterize the project along these dimensions:

- ambiguity and amount of planning required
- coupling between tasks and amount of shared mutable state
- opportunities for genuinely independent parallel work
- need for domain specialists or independent verification
- consequences of errors and required approval points
- context size, tool access, latency, and budget

State assumptions when details are unavailable. Do not pretend that an unavailable model, tool, or provider can be used.

## Choose the smallest sufficient structure

Prefer a single agent when the work is small, tightly coupled, sequential, or centered on repeatedly modifying the same state. Adding agents to a task list is not useful decomposition by itself.

Use multiple agents only when at least one benefit is concrete:

- independent subtasks can run in parallel
- distinct expertise or tool permissions are needed
- an independent reviewer materially lowers risk
- the context is too broad for one agent to manage reliably
- competing proposals would improve an important decision

Choose a topology that matches the benefit:

- **Single agent:** one owner plans, executes, and checks a bounded task.
- **Planner–executor–reviewer:** useful for consequential implementation with clear stage gates.
- **Hub-and-spoke:** an orchestrator owns shared state while specialists handle separable work.
- **Parallel specialists + integrator:** appropriate for independent research, analysis, or components with stable interfaces.
- **Proposer–critic–judge:** reserve for high-value decisions where alternative exploration justifies the extra cost.

Default to centralized coordination when agents share a codebase, document, deployment, or other mutable state. Use decentralized peer collaboration only when agents can operate with stable interfaces and limited shared context.

## Define each agent as a contract

For every proposed agent, specify:

- mission and non-goals
- model capability tier and why it is sufficient
- inputs and context it receives
- expected output or artifact schema
- tools and minimum required permissions
- dependencies and allowed parallelism
- handoff recipient and acceptance criteria
- retry, escalation, and termination conditions

Avoid overlapping ownership. One agent must own integration and the final answer. Separate author and reviewer only when review independence adds real value.

## Route models by capability tier

Select the tier before selecting a provider-specific model:

1. **Strategic tier:** overall orchestration, architecture, ambiguous decomposition, difficult integration, high-risk judgment, and resolving conflicts between agents.
2. **Balanced tier:** normal implementation, domain analysis, structured drafting, test design, and substantive review with clear requirements.
3. **Fast tier:** bounded implementation, extraction, formatting, routine tests, mechanical edits, progress summaries, and first-pass feedback.

Use the lowest tier that can reliably complete the task. Escalate when ambiguity, cross-component impact, failed attempts, security implications, or integration complexity exceed the assigned tier. Do not use a fast model as the sole authority for irreversible, security-sensitive, or architecture-wide decisions.

Before naming a concrete model, discover the models actually available in the current environment. Do not require an exact match with any example name. When a model has been renamed, removed, or newly introduced, classify the available candidates by documented capabilities, reasoning reliability, context capacity, tool support, latency, and cost, then map the closest suitable candidate to the required tier.

Keep the architecture portable by recording both values:

- **capability tier:** the durable requirement used by the architecture
- **resolved model:** the concrete model currently selected for that tier

If reliable capability information is unavailable, do not infer performance from the model name. Ask for the provider or model specification when the choice materially affects the result; otherwise use a known adequate fallback and label the mapping as provisional.

Read [references/model-routing.md](references/model-routing.md) when mapping these tiers to Codex, Claude, or another provider, or when the available model names differ from the examples.

## Control communication and execution

- Pass only the context each role needs; do not broadcast the full history by default.
- Prefer artifacts, schemas, diffs, and decision records over long conversational relays.
- Define ownership before parallel work begins, especially for shared files.
- Validate outputs at integration boundaries before they enter shared state.
- Set budgets for agents, iterations, tool calls, time, and tokens.
- Stop debate or revision when acceptance criteria are met or the budget is exhausted.
- Require explicit user approval immediately before consequential external or destructive actions.
- Preserve checkpoints and logs sufficient to explain important decisions and recover from failure.

## Deliver the recommendation

Give a practical project-start plan with:

1. **Project assessment:** key traits, constraints, and assumptions.
2. **Architecture decision:** single or multi-agent, selected topology, and rejected complexity.
3. **Agent roster:** a table of role, responsibility, model tier/model, inputs, outputs, tools, and handoff.
4. **Execution flow:** dependencies, parallel stages, integration points, and approval gates. Use a compact Mermaid diagram only when the flow is not obvious from the table.
5. **Operating rules:** shared-state ownership, communication format, validation, escalation, and stopping conditions.
6. **Launch prompts:** concise role prompts or configuration snippets when the user asks for an implementable setup.
7. **Trade-offs:** expected quality, latency, cost, and failure modes.

Explain why each agent exists and why its assigned tier is enough. If a smaller design provides similar reliability, recommend the smaller design.
