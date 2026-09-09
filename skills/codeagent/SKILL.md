---
name: codeagent
description: Delegate a bounded implementation and its tests to codeagent-wrapper. Claude orchestrates; Grok is the default worker. Use for codeagent requests and delegated coding, not routine reads or recursive delegation.
---

# Codeagent

Submit one complete work package: objective, absolute workdir, allowed files, constraints, acceptance commands. The worker implements and tests directly. Do not forward the full conversation or ask the worker to orchestrate more agents.

```bash
codeagent-wrapper --backend grok - /absolute/project <<'TASK'
Implement the requested change within the specified files, preserve unrelated edits, and run the relevant tests. Return changed files, test results, and remaining issues. Do not call another agent.
TASK
```

Default worker: Grok 4.6, low reasoning effort. Use `--reasoning-effort medium` or `high` when complexity warrants it. Explicit `--backend codex|claude|gemini|opencode` remains available; do not silently switch after failure.

Resume related work with `codeagent-wrapper --backend grok resume SESSION_ID - /absolute/project`, passing the follow-up through stdin. Reuse the session only for related work.

Independent work with disjoint file ownership may use `--parallel --backend grok` and stdin blocks:

```text
---TASK---
id: implementation
workdir: /absolute/project
---CONTENT---
Implement and test the specified module. You are not alone; preserve others' edits.
```

Use `dependencies: task_id` only for real dependencies. Default concurrency is 3. Avoid splitting individual edits/tests into separate calls.

Workers use Grok's `auto` permission mode: routine work proceeds only when its safety check allows it; denied actions fail clearly in headless mode. Use `--skip-permissions` only with user authorization. There is no implicit execution timeout; the caller must retain the process handle and cancel stalled work explicitly. Keep the returned process/log and SESSION_ID; inspect progress instead of blindly restarting. Retry a transient error once; fix authentication/permission/configuration failures before retrying. Report failures honestly.

This installation uses a CLI, not an MCP server; call it through the shell. Adding an MCP adapter would add startup/context overhead without improving this workflow.
