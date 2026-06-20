import fs from "node:fs";
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

    const fileContent = fs.readFileSync("./examples/run-moa-server.ts", "utf8");
    const prompt = `Analyze this TypeScript file and explain what it does:\n\n\`\`\`typescript\n${fileContent}\n\`\`\``;

    console.log("Asking moaFusionTool...");
    const output = await tool.execute(
      {
        prompt: prompt,
        workers: ["google/gemini-2.5-flash", "google/gemini-2.5-flash"],
      },
      {
        sessionID: res.id,
        abort: new AbortController().signal,
        metadata: () => {},
      } as unknown as ToolContext,
    );

    console.log("\n=== Worker Outputs ===");
    if (typeof output === "string") {
      console.log(output);
    } else {
      console.log(output.output);
    }
    console.log("\n=== Note ===");
    console.log("The output is plain text (not JSON). The calling agent should synthesize");
    console.log("a unified answer from the worker outputs in its next reply.");
  } finally {
    server.close();
  }
}
run().catch(console.error);
