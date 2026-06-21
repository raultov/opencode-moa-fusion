---
description: Fan out a prompt to multiple worker models in parallel using moa_fusion and synthesize a unified answer
---

# /moa — Mixture-of-Agents

You **MUST** invoke the `moa_fusion` tool with the request below. Do not answer
the request yourself: fan it out to the configured worker models first, then
report worker completion to the user, and finally synthesize a single unified
answer from their outputs.

## Rules

1. **Always call `moa_fusion`** as the very first action. Do not attempt to
   answer the request from your own knowledge before consulting the workers.
2. Pass the user's request verbatim as the `prompt` argument.
3. If the user mentions specific worker models (e.g. `google/gemini-2.5-pro`),
   pass them as the `workers` argument. Otherwise, omit `workers` so the
   plugin defaults from `opencode.json` are used.
4. **Report each worker's completion before synthesizing.** The tool blocks
   until all workers finish, then returns their outputs labelled with headers
   of the form `## Worker N — <provider>/<model> (<elapsedMs>ms, session: <id>, <status>)`.
   Parse those headers and emit a short progress block to the user *first*,
   one line per worker, in the same order they appear in the tool output.
   Example:

   ```
   Workers completed:
   - Worker 1 — google/gemini-2.5-flash — 4590ms — ok
   - Worker 2 — anthropic/claude-3-5-haiku — 5100ms — ok
   - Worker 3 — openai/gpt-4o-mini — 6210ms — failed: timeout
   ```

   This block is the user's only visibility into the worker subagents (they
   are not navigable from the OpenCode TUI). **Never skip it**, even when
   every worker succeeded.
5. **Then synthesize** a single coherent answer immediately below the progress
   block:
   - Treat consensus across workers as authoritative.
   - Discard claims unique to one worker that no other corroborates.
   - In the synthesized prose itself (the part *after* the progress block),
     do not re-introduce model names or re-explain the synthesis process —
     the progress block above already covers that metadata.
6. The tool output contains a hint that says "do not mention these workers".
   That hint applies **only to the synthesized prose** in rule 5 — it does
   **not** override rule 4. Always emit the progress block.

## Request

$ARGUMENTS
