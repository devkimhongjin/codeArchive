# Agent Design Principles

## 1. Decide whether an agent is needed

An ordinary AI response system produces an answer for an input. An agent instead pursues a goal by repeatedly choosing actions, observing results, and adjusting its next step.

Use an agentic workflow when the task needs some combination of:

- multi-step planning whose later steps depend on earlier results
- search, APIs, code execution, databases, files, or other external tools
- state or memory across a long-running task
- dynamic replanning after failure or new evidence

A single tool call does not by itself justify an agent. For a fixed transformation or predictable sequence, prefer a direct workflow or deterministic script.

The core loop is:

1. perceive the goal and current environment
2. reason and choose a plan
3. act through an appropriate tool or delegated role
4. observe and validate the result
5. finish when the goal is met, or revise the plan within a fixed budget

## 2. Decide whether multiple agents are needed

Multiple agents can combine specialist knowledge, explore alternatives, work in parallel, and provide independent verification. They also increase token use, latency, communication overhead, state inconsistency, and debugging difficulty.

Use multiple agents only when decomposition creates a measurable benefit. Agent count is not a quality metric. A capable single agent is usually better for tightly coupled coding or debugging that repeatedly modifies one shared state.

### Collaboration patterns

| Pattern | Mechanism | Good fit | Main risk |
| --- | --- | --- | --- |
| Cooperative | roles divide a shared goal | research, documents, separable components | error propagation and communication cost |
| Competitive | agents propose or criticize alternatives | important decisions, argument testing, solution search | duplicated effort and endless debate |
| Cooperative + competitive | agents gather or build separately, then compare candidates | balanced high-value decisions | complicated coordination and selection rules |

Every debate or revision loop needs an explicit limit, quality threshold, or judge.

## 3. Choose an organization and communication structure

### Centralized coordination

An orchestrator assigns work, owns the global plan and shared state, compares outputs, and makes the final integration decision.

Use it when tasks share a codebase, document, deployment, budget, or dependency graph. It is easier to observe and control, but the orchestrator can become a bottleneck or single point of failure.

### Decentralized coordination

Peers communicate directly using limited context and stable interfaces. This can tolerate isolated failures and adapt locally, but consensus, deduplication, and state consistency are harder.

Use it only when the work can be divided behind stable boundaries and no peer needs the full project state.

### Protocol styles

- **Rule-based:** fixed sequence such as draft → critique → revise. Prefer when the procedure and exit condition are clear.
- **Role-based:** planner, executor, reviewer, or domain specialist responsibilities. Prefer when expertise and tool permissions differ.

Do not create roles with overlapping ownership. Define who decides, who changes shared state, and who accepts each handoff.

## 4. Treat context, memory, and tools as architecture

### Context and memory

Give each agent only the context required for its decision. Maintain:

- short-term task state for the current execution
- durable decisions, interfaces, and checkpoints for handoffs
- external knowledge retrieval when current or private information is required

Do not copy full histories between every agent. Use concise artifacts, schemas, diffs, and decision records to reduce context cost and distortion.

### Retrieval

Use ordinary retrieval when one evidence-gathering pass is enough. Use agentic retrieval only when the system must decide whether to search, select among sources or tools, evaluate evidence, resolve conflicts, and reformulate queries.

### Tool policy

For every tool-enabled role, define:

- **when** the tool should be used
- **which** tool is appropriate
- **how** inputs and outputs are validated
- permissions and user-approval boundaries

Tool connectivity does not guarantee safety. Use least privilege, input validation, auditability, and explicit approval for consequential actions.

## 5. Match planning depth to difficulty

Deeper reasoning, multiple candidate paths, self-review, and repeated search can improve difficult work. They can also increase cost and create more opportunities for unproductive branches.

Allocate additional reasoning or search only when the task is ambiguous, consequential, or demonstrably difficult. For easy work, use short plans and early completion. Stop when acceptance criteria are met rather than consuming the full budget.

Useful planning patterns include:

- **Reason–act–observe:** alternate decisions with tool results
- **Plan and act:** a planner creates the high-level path and executors complete bounded steps
- **Candidate exploration:** generate several options, evaluate them, and retain only the strongest

## 6. Design for reliable operation

Every recommended architecture should address:

- maximum iterations, time, token, and cost budgets
- minimum permissions and approval gates
- input, output, and artifact schema validation
- checkpoints, retry limits, and recovery strategy
- failure isolation before outputs enter shared state
- logs for tool calls, state changes, important decisions, cost, and latency
- automatic checks plus human review where consequences justify it

Escalate rather than loop when there is no progress, evidence conflicts, permissions are insufficient, or a lower-capability model encounters cross-component or high-risk decisions.

## 7. Evaluate the architecture as a system

Compare candidate designs using:

- result quality and factual or functional correctness
- elapsed time and critical-path latency
- token, model, and external-tool cost
- reproducibility and observability
- coordination failures and error propagation
- recovery from partial failure
- user effort at approval and review points

Reassess the architecture after the uncertain or high-risk phase ends. A project may begin with a strategic orchestrator and specialists, then shrink to one balanced or fast execution agent once interfaces and acceptance tests are stable.
