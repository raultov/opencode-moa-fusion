/**
 * V2 worker transport: drive one worker as a child session through the
 * `ctx.session` domain (`create` → `prompt` → `wait` → `context`), mirroring
 * the V1 `callModel.ts` semantics.
 *
 * Two V2 deviations from V1, both inherent to the V2 prompt contract
 * (`SessionPromptInput` has no `system`, `model`, `parts` or `tools` fields):
 *
 * - The model moves to `session.create` and the read-only system directive
 *   folds into the prompt text. The XML boundary wrapping (the actual prompt-
 *   injection defence) is unchanged.
 * - Worker tool selection (the `workerTools` option) cannot be scoped per
 *   call; worker sessions run with their agent's tool set. Recursion through
 *   `moa_fusion` is still blocked (see `v2.ts`, worker session guard).
 */
import type { SessionApi } from "@opencode/client/promise/api";
import { READ_ONLY_DIRECTIVE, type WorkerCall, type WorkerRunner, wrapUserPrompt } from "./core.js";
import { sanitizeErrorMessage } from "./sanitize.js";
import type { WorkerResult } from "./types.js";

type CreateInput = Parameters<SessionApi["create"]>[0];
type PromptInput = Parameters<SessionApi["prompt"]>[0];
type RequestOptions = Parameters<SessionApi["create"]>[1];

export type V2SessionClient = Pick<SessionApi, "create" | "prompt" | "wait" | "context">;

type MessageLike = {
  type: string;
  content?: ReadonlyArray<{ type: string; text?: string }>;
};

/** Last assistant message text (all `text` parts joined), or empty. */
export function assistantText(messages: ReadonlyArray<MessageLike>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type !== "assistant") continue;
    return (message.content ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("");
  }
  return "";
}

export function createV2WorkerRunner(
  session: V2SessionClient,
  workerSessionIDs?: Set<string>,
): WorkerRunner {
  return async (call: WorkerCall): Promise<WorkerResult> => {
    const start = Date.now();
    const modelStr = `${call.model.providerID}/${call.model.modelID}`;
    let childSessionID: string | undefined;

    try {
      const created = await session.create({
        parentID: call.parentID,
        title: `moa:${call.model.modelID}`,
        agent: call.agent || "general",
        model: { id: call.model.modelID, providerID: call.model.providerID },
      } as CreateInput);

      childSessionID = created?.id;
      if (!childSessionID) {
        return {
          ok: false,
          model: modelStr,
          error: "Failed to create child session, no ID returned",
          elapsedMs: Date.now() - start,
        };
      }
      workerSessionIDs?.add(childSessionID);

      const ac = new AbortController();
      const onOuterAbort = () => ac.abort(new Error("aborted"));
      call.abort.addEventListener("abort", onOuterAbort);
      if (call.abort.aborted) onOuterAbort();

      const timeoutId = setTimeout(() => ac.abort(new Error("timeout")), call.timeoutMs);

      const system = call.system ? `${READ_ONLY_DIRECTIVE}\n\n${call.system}` : READ_ONLY_DIRECTIVE;
      const text = `${system}\n\n${wrapUserPrompt(call.text)}`;

      let promptError: unknown;
      try {
        await session.prompt(
          { sessionID: childSessionID, text } as PromptInput,
          { signal: ac.signal } as RequestOptions,
        );
        await session.wait({ sessionID: childSessionID }, { signal: ac.signal });
      } catch (e) {
        promptError = e;
      } finally {
        clearTimeout(timeoutId);
        call.abort.removeEventListener("abort", onOuterAbort);
      }

      let errStr: string | undefined;
      if (ac.signal.aborted) {
        errStr = sanitizeErrorMessage(ac.signal.reason || "aborted");
      } else if (promptError) {
        errStr = sanitizeErrorMessage(promptError);
      }

      if (errStr !== undefined) {
        return {
          ok: false,
          model: modelStr,
          sessionID: childSessionID,
          error: errStr,
          elapsedMs: Date.now() - start,
        };
      }

      const messages = await session.context({ sessionID: childSessionID });
      const output = assistantText(messages as ReadonlyArray<MessageLike>);

      return {
        ok: true,
        model: modelStr,
        sessionID: childSessionID,
        output,
        elapsedMs: Date.now() - start,
      };
    } catch (e) {
      return {
        ok: false,
        model: modelStr,
        sessionID: childSessionID,
        error: sanitizeErrorMessage(e),
        elapsedMs: Date.now() - start,
      };
    }
  };
}
