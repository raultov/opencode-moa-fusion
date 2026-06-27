/**
 * Sanitize error messages before surfacing them to the orchestrator / user.
 *
 * Strips absolute filesystem paths, UUID-like / hex trace IDs, and truncates
 * to a max length so a thrown Error from the SDK or filesystem layer cannot
 * leak host-specific information into the conversation context.
 */

const MAX_ERROR_LENGTH = 200;

const PATH_RE =
  /(?:\/(?:Users|home|root|tmp|var|opt|etc|mnt|proc|sys)\/[^\s'"`)]+|C:\\[^\s'"`)]+)/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_TRACE_RE = /\b[0-9a-f]{16,64}\b/gi;
const STACK_LINE_RE = /^\s*at\s+.+$/gm;

export function sanitizeErrorMessage(input: unknown): string {
  let msg: string;
  if (input instanceof Error) {
    msg = input.name && input.name !== "Error" ? `${input.name}: ${input.message}` : input.message;
  } else if (typeof input === "string") {
    msg = input;
  } else if (input === undefined || input === null) {
    return "Unknown error";
  } else {
    try {
      msg = JSON.stringify(input);
    } catch {
      msg = String(input);
    }
  }

  msg = msg.replace(STACK_LINE_RE, "");
  msg = msg.replace(PATH_RE, "<path>");
  msg = msg.replace(UUID_RE, "<id>");
  msg = msg.replace(HEX_TRACE_RE, "<id>");
  msg = msg.replace(/\s+/g, " ").trim();

  if (msg.length > MAX_ERROR_LENGTH) {
    msg = `${msg.slice(0, MAX_ERROR_LENGTH)}…`;
  }

  return msg || "Unknown error";
}
