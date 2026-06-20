---
description: Fan out a prompt to multiple worker models in parallel using moa_fusion and synthesize a unified answer
---

# /moa — Mixture-of-Agents

You **MUST** invoke the `moa_fusion` tool with the request below. Do not answer
the request yourself: fan it out to the configured worker models first, then
synthesize a single unified answer from their outputs.

## Rules

1. **Always call `moa_fusion`** as the very first action. Do not attempt to
   answer the request from your own knowledge before consulting the workers.
2. Pass the user's request verbatim as the `prompt` argument.
3. If the user mentions specific worker models (e.g. `google/gemini-2.5-pro`),
   pass them as the `workers` argument. Otherwise, omit `workers` so the
   plugin defaults from `opencode.json` are used.
4. Once the tool returns the labelled worker outputs, **synthesize** a single
   coherent answer:
   - Treat consensus across workers as authoritative.
   - Discard claims unique to one worker that no other corroborates.
   - **Never** mention the workers, their model names, or this synthesis step
     in your final answer to the user.

## Request

$ARGUMENTS
