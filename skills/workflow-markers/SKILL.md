---
name: workflow-markers
description: Convention to explicitly group sub-agents into a named, numbered workflow in the Clawd Base dashboard. Use when orchestrating several sub-agents in successive steps and the user wants them shown as one workflow.
---

# Workflow markers

Clawd Base detects workflows automatically: Agent calls issued in the same message form one parallel step, and 2+ steps in the same user turn form a workflow. To force an explicit, named and numbered grouping, prefix the sub-agent's `description` (or its `prompt`) with a marker:

```
[workflow:<name> step:<n>] <usual description>
```

- `<name>`: workflow name, identical for all its agents (e.g. `security-audit`).
- `step:<n>`: step number (1, 2, 3…). Agents of the same step run in parallel. Optional: without it, agents are grouped by message.
- Markers override automatic detection, even for a single-step workflow.
- The marker is hidden in the UI; only the description is shown.

Example — step 1 with two parallel agents in the same message:

```
Agent(description="[workflow:migration step:1] Analyze the schema", subagent_type="Explore", prompt="…")
Agent(description="[workflow:migration step:1] List the queries", subagent_type="Explore", prompt="…")
```

then, after their results:

```
Agent(description="[workflow:migration step:2] Write the migration", subagent_type="general-purpose", prompt="…")
```

The "migration" workflow then shows up with its chief's room and two steps linked by animated cables.
