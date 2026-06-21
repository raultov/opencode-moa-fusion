# `opencode-moa-fusion`

A Mixture-of-Agents (MoA) plugin for [OpenCode](https://github.com/opencode-ai/opencode). This tool fans out a single prompt to $N$ independent worker subagents in parallel. When all workers complete, it returns their outputs labelled — the **calling agent** then synthesizes a unified answer using its own model.

> _Note: worker subagents run as background sessions and are not click-through navigable from the TUI like the builtin `task` tool. You can still inspect them out-of-band (debug mode, on-disk session logs, or the SDK)._

## Key Features

- **Parallel workers**: Fan out to N models simultaneously
- **Background worker sessions**: Each worker runs as a child session in the background (not navigable from the TUI)
- **No judge model**: The calling agent synthesizes the final answer — no extra model call needed
- **Sessions persist**: Worker sessions are NOT deleted after completion, so you can still inspect them out-of-band (debug logs, on-disk session files, SDK)

## Installation

**One-line installer (recommended):**

Linux & macOS (bash, also works under WSL and Git Bash on Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.sh | bash
```

Windows (PowerShell 5.1+ on Windows 10+, or PowerShell 7+ everywhere):

```powershell
irm https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.ps1 | iex
```

Both installers will interactively ask whether you want to install it for the current project (`./opencode.json`) or globally (`~/.config/opencode/opencode.json`). They will also automatically show you a menu to select the background worker models from your available OpenCode providers. The two installers share the exact same Node.js logic; only the bootstrap wrapper differs.

> **Disclaimer on model selection:** The interactive installer runs `opencode models` internally to fetch your available models. If you use custom providers or plugins that require specific environment variables to be set to expose their models (e.g., `ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://127.0.0.1:3456 opencode models`), those models might not appear in the installer's list. The installer cannot foresee these runtime environments, but you can always add the missing models manually to your `opencode.json` after installation.

> **Windows note:** the PowerShell installer needs an interactive terminal. The `irm | iex` form works in Windows Terminal / PowerShell 7. If your shell complains about no TTY, download the script first and run it directly:
>
> ```powershell
> irm https://raw.githubusercontent.com/raultov/opencode-moa-fusion/main/install.ps1 -OutFile install.ps1
> .\install.ps1
> ```

Alternatively, you can install the plugin manually via `npm` or `bun`:

```bash
npm install -g opencode-moa-fusion
# or
bun add -g opencode-moa-fusion
```

### Installation issues in corporate environments

If you configure the plugin but it fails to load or gives an error, it may be caused by an OpenCode issue where the package download fails silently (no error logged) instead of surfacing the underlying problem. This is commonly triggered by:

- **Corporate npm registry proxies** (Nexus, Artifactory, Verdaccio, JFrog — any `registry` configured in `~/.npmrc`) that enforce allowlists, security scans, or maturity policies on newly published packages.
- **Newly published versions** that haven't been cached or approved by the corporate proxy yet.

**Diagnostic:** check `~/.cache/opencode/packages/opencode-moa-fusion@<version>/`. If the directory is empty or missing files despite a successful OpenCode startup, the proxy silently blocked the download.

**Workaround:** temporarily comment out the `registry` line in `~/.npmrc`, restart OpenCode so it downloads the package from the public npm registry, then restore the corporate registry setting. The cached package in `~/.cache/opencode/packages/` will continue to work.

**Long-term fix:** ask your registry administrator to add `opencode-moa-fusion` to the package allowlist.

## Registration

Register the plugin in your OpenCode configuration. This can be done globally in `~/.config/opencode/opencode.json` or locally in your project's `opencode.json`.

```json
{
  "plugin": [
    [
      "opencode-moa-fusion@1.2.4",
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

### ⚠️ Always pin a specific version — do not use `@latest`

**Recommended:** always register the plugin with a fully qualified version (e.g. `opencode-moa-fusion@1.2.4`), **never** `opencode-moa-fusion@latest` or the bare name. Two concrete reasons:

1. **Security / supply chain.** Pinning guarantees that the exact code you audited is what runs locally. Plugins execute in your OpenCode process with full filesystem and network access — a compromised future release published to npm would be picked up silently by `@latest` resolvers. A pinned version protects you from upstream tampering (and from accidental breaking changes during a normal release).
2. **OpenCode's plugin cache does not revalidate `@latest`.** OpenCode caches plugins under `~/.cache/opencode/packages/<pkg>@<spec>/`, keyed by the literal spec string. With `@latest` the cache directory is named `opencode-moa-fusion@latest`, and OpenCode reuses it forever — it never re-checks npm to see if a newer release exists. The result: when a new version is published, your install keeps running the old (possibly broken) cached copy. To pick up the new version you'd have to manually delete `~/.cache/opencode/packages/opencode-moa-fusion@latest/` before every restart, which defeats the point.

If you ever do need to refresh a `@latest` install, run:

```bash
rm -rf ~/.cache/opencode/packages/opencode-moa-fusion@latest
```

then restart OpenCode. But the cleaner fix is to bump the pinned version in `opencode.json` whenever you want a new release.

## Usage

Start OpenCode and instruct the agent to use the `moa_fusion` tool. **Worker model names must be fully qualified as `providerID/modelID`** — the exact same form registered under `provider` in your `opencode.json`. Names without a `providerID/` prefix will be rejected with `Unknown model`.

> **User:** "Use the moa_fusion tool with workers `google/gemini-2.5-flash` and `google/gemini-2.5-pro` to explain BGP in one paragraph."

If you set `workers` in the plugin options (see [Registration](#registration)), you can omit them from the prompt and the agent will fall back to those defaults:

> **User:** "Use the moa_fusion tool to explain BGP in one paragraph."

### `/moa` Slash Command (recommended)

To avoid asking the agent to "use the moa_fusion tool" on every prompt, install
the `/moa` slash command. Once installed, you can invoke the mixture-of-agents
directly from the OpenCode prompt:

> **User:** `/moa explain BGP in one paragraph`

The command instructs the agent to fan out via `moa_fusion`, **report worker
completion to you** (model name, elapsed time and status per worker), and then
synthesize the unified answer. Because worker subagents are not navigable from
the OpenCode TUI, this progress block is the only built-in visibility you get
into the parallel runs — the command requires the agent to print it before the
synthesized answer, even when every worker succeeded. Example:

```
Workers completed:
- Worker 1 — google/gemini-2.5-flash — 4590ms — ok
- Worker 2 — anthropic/claude-3-5-haiku — 5100ms — ok
- Worker 3 — openai/gpt-4o-mini — 6210ms — failed: timeout
```

> **Note:** If you used the interactive one-line installer from the `Installation` section, the `/moa` command was already installed for you.

**Manual installation:** copy [`commands/moa.md`](commands/moa.md) into
`~/.config/opencode/command/moa.md` (global) or `./.opencode/command/moa.md`
(project-local).

> **Note:** the `/moa` command only triggers the agent to call `moa_fusion`. The
> plugin itself must still be registered and loaded via your `opencode.json`
> (see [Registration](#registration)).

**Requirements for invocation:**
- The primary agent's model must support tool calling. Models without function-calling capability will never invoke `moa_fusion`, no matter how explicit the prompt.
- The plugin must actually be loaded — verify `dist/index.js` exists at the path declared in `opencode.json` (run `bun run build` first). OpenCode silently skips plugins whose entry file is missing.

The tool will:
1. Create a child session for each worker
2. Fan out the prompt to all workers in parallel
3. Wait for all workers to complete
4. Return their outputs as labelled text
5. The calling agent then synthesizes a unified answer

**Inspecting worker sessions**: see the [disclaimer at the top of this README](#-important--worker-sessions-are-not-visually-navigable) — worker sessions are **not** click-through navigable in the TUI like the builtin `task` tool. They run in the background and can only be inspected out-of-band (debug/verbose mode, on-disk session logs, or the SDK).

### Tool Arguments

- **`prompt`** (required): The user prompt to fan out to every worker model.
- **`workers`** (optional): Array of worker model refs as `"providerID/modelID"`. Overrides plugin options.
- **`agent`** (optional): Agent profile to use for underlying model calls. Defaults to `"general"`.
- **`timeoutMs`** (optional): Per-worker timeout in milliseconds. Defaults to 120000ms.

## Output Format

When the workers complete, the tool returns the following text **back to the calling agent** (the user does not see this raw text directly):

```text
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

Because the tool's output explicitly instructs the agent to synthesize a single answer, the user will only see the final, unified response generated by the main agent.

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
