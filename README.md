# `opencode-moa-fusion`

A Mixture-of-Agents (MoA) plugin for [OpenCode](https://github.com/opencode-ai/opencode). This tool fans out a single prompt to $N$ independent worker subagents in parallel, each running as a **child session** that remains navigable in the TUI. When all workers complete, it returns their outputs labelled — the **calling agent** then synthesizes a unified answer using its own model.

## Key Features

- **Parallel workers**: Fan out to N models simultaneously
- **Navigable child sessions**: Each worker runs as a child session you can inspect with Ctrl+X (or equivalent TUI navigation)
- **No judge model**: The calling agent synthesizes the final answer — no extra model call needed
- **Sessions persist**: Worker sessions are NOT deleted after completion, so you can review their reasoning

## Installation

You can install the plugin globally via `npm` or `bun`:

```bash
npm install -g opencode-moa-fusion
# or
bun add -g opencode-moa-fusion
```

## Registration

Register the plugin in your OpenCode configuration. This can be done globally in `~/.config/opencode/opencode.json` or locally in your project's `opencode.json`. Notice how you just use the package name now.

```json
{
  "plugin": [
    [
      "opencode-moa-fusion",
      {
        "workers": [
          "openai/gpt-4o-mini",
          "anthropic/claude-3-5-haiku-latest"
        ]
      }
    ]
  ]
}
```

> **Note:** The `workers` specified in `opencode.json` act as defaults. The primary agent can override these at runtime by passing arguments to the tool.

## Usage

Start OpenCode and instruct the agent to use the `moa_fusion` tool. **Worker model names must be fully qualified as `providerID/modelID`** — the exact same form registered under `provider` in your `opencode.json`. Names without a `providerID/` prefix will be rejected with `Unknown model`.

> **User:** "Use the moa_fusion tool with workers `google/gemini-2.5-flash` and `google/gemini-2.5-pro` to explain BGP in one paragraph."

If you set `workers` in the plugin options (see [Registration](#registration)), you can omit them from the prompt and the agent will fall back to those defaults:

> **User:** "Use the moa_fusion tool to explain BGP in one paragraph."

**Requirements for invocation:**
- The primary agent's model must support tool calling. Models without function-calling capability will never invoke `moa_fusion`, no matter how explicit the prompt.
- The plugin must actually be loaded — verify `dist/index.js` exists at the path declared in `opencode.json` (run `bun run build` first). OpenCode silently skips plugins whose entry file is missing.

The tool will:
1. Create a child session for each worker
2. Fan out the prompt to all workers in parallel
3. Wait for all workers to complete
4. Return their outputs as labelled text
5. The calling agent then synthesizes a unified answer

**Navigating worker sessions**: While workers are running (or after they complete), you can inspect their reasoning in real-time. Because `moa_fusion` is a custom tool, OpenCode will not show the automatic "Press Ctrl+X" footer (which is hardcoded for the builtin `task` tool). Instead, simply **open your Session List** (via Command Palette `Ctrl+K` -> "Sessions", or your equivalent TUI shortcut) to see and switch to the active `moa:<modelID>` child sessions.

### Tool Arguments

- **`prompt`** (required): The user prompt to fan out to every worker model.
- **`workers`** (optional): Array of worker model refs as `"providerID/modelID"`. Overrides plugin options.
- **`agent`** (optional): Agent profile to use for underlying model calls. Defaults to `"general"`.
- **`timeoutMs`** (optional): Per-worker timeout in milliseconds. Defaults to 120000ms.

## Output Format

The tool returns plain text (not JSON) with labelled worker outputs:

```
Received N worker outputs for the prompt below. Synthesize a single unified
answer in your next reply. Treat consensus across workers as authoritative;
discard claims unique to one worker that no other corroborates. Do not
mention these workers, their models, or this synthesis step in your final
answer to the user.

## Original prompt
<prompt>

## Worker 1 — google/gemini-2.5-flash (4590ms, session: abc123, ok)
<worker output>

## Worker 2 — anthropic/claude-3-5-haiku (5100ms, session: def456, ok)
<worker output>
```

The calling agent receives this text and should synthesize a unified answer in its next reply.

## Troubleshooting

- **Agent never calls the tool / tool not listed**: The plugin's entry file was not found and OpenCode skipped it silently. Confirm `dist/index.js` exists at the path declared in `opencode.json` (run `bun run build`). Also confirm the primary agent's model supports tool calling — non-tool-calling models cannot invoke `moa_fusion` regardless of the prompt.
- **`moa_fusion: no models configured`**: You haven't provided worker models via the tool arguments or the `opencode.json` configuration. Make sure to pass the `options` object with `workers` when registering the plugin, or include them in the prompt.
- **`Unknown model: <provider>/<model>`**: The provided model name isn't registered in your OpenCode providers configuration. Worker refs must be fully qualified as `providerID/modelID` and match the spelling under `provider` in your `opencode.json` exactly (e.g. `google/gemini-2.5-flash`, not `gemini-2.5-flash`).
- **Worker Timeouts**: If a worker takes too long and times out, the output will include the error. You can increase `timeoutMs` to give slow models more time.
- **`Error: Server exited with code 1`** when running examples: This happens if another opencode instance is already listening on port 4096. Kill the existing process or change the port.

## Session Cleanup

Worker sessions persist after completion so you can review their reasoning. If you want to clean up:
- Close the parent session (child sessions are deleted with it)
- Manually delete child sessions via the TUI
- Or use the SDK: `client.session.delete({ path: { id: childSessionID } })`

## Examples

See `examples/` for runnable scripts:
- `examples/run-moa-server.ts`: Basic usage with the SDK
- `examples/ask-moa.ts`: Using the tool with file context

Run with:
```bash
npx tsx examples/run-moa-server.ts
```

## Development

### Scripts

| Script | Description |
| --- | --- |
| `bun test` | Run the Bun test suite |
| `bun run typecheck` | TypeScript type check (`tsc --noEmit`) |
| `bun run build` | Compile plugin to `dist/` |
| `bun run lint` | Run Biome linter |
| `bun run lint:fix` | Apply Biome lint auto-fixes |
| `bun run format` | Format source files with Biome |
| `bun run check` | Run lint + format with auto-fix |

### Linter

[Biome](https://biomejs.dev/) is configured via `biome.json`. It handles both linting and formatting with zero config beyond what's already in the repo. Run `bun run check` before committing to keep the tree clean.
