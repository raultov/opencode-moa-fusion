import type { ToolContext } from "@opencode-ai/plugin";
import { createOpencode } from "@opencode-ai/sdk";
import { moaFusionTool } from "../src/tool.js";

async function run() {
  const { client, server } = await createOpencode();

  try {
    const createRes = await client.session.create({ body: {} });
    const res = createRes.data;
    if (!res) throw new Error("Failed to create session");

    const tool = moaFusionTool(client, {});

    console.log("Running moaFusionTool...");
    const output = await tool.execute(
      {
        prompt: "Explain BGP in one paragraph",
        workers: ["google/gemini-2.5-flash", "google/gemini-2.5-flash"],
      },
      {
        sessionID: res.id,
        abort: new AbortController().signal,
        metadata: (m: { title?: string; metadata?: Record<string, unknown> }) =>
          console.log("Metadata:", m),
      } as unknown as ToolContext,
    );

    console.log("\n=== Worker Outputs (text, not JSON) ===");
    if (typeof output === "string") {
      console.log(output);
    } else {
      console.log(output.output);
    }
    console.log("\n=== Note ===");
    console.log("The output above is plain text. The calling agent should synthesize");
    console.log("a unified answer from the worker outputs in its next reply.");
    console.log("\nChild sessions are NOT deleted — they remain navigable in the TUI.");

    await client.session.delete({ path: { id: res.id } });
  } finally {
    server.close();
  }
}
run().catch(console.error);
