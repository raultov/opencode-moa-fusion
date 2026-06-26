import { describe, expect, it } from "bun:test";
import { resolveWorkerTools } from "../src/workerTools.js";
import { RoleResolutionError } from "../src/types.js";

describe("resolveWorkerTools [Unit]", () => {
  describe("Scenario: no workerTools option", () => {
    it("Given options is empty When resolveWorkerTools is called Then returns the default read-only allowlist with explicit denies", () => {
      const result = resolveWorkerTools({});
      expect(result).toEqual({
        read: true,
        glob: true,
        grep: true,
        bash: false,
        write: false,
        edit: false,
        webfetch: false,
        patch: false,
        todowrite: false,
        moa_fusion: false,
      });
    });

    it("Given options.workerTools is undefined When resolveWorkerTools is called Then returns the defaults", () => {
      const result = resolveWorkerTools({ workerTools: undefined });
      expect(result.read).toBe(true);
      expect(result.glob).toBe(true);
      expect(result.grep).toBe(true);
      expect(result.bash).toBe(false);
      expect(result.moa_fusion).toBe(false);
    });
  });

  describe("Scenario: empty allowlist", () => {
    it("Given options.workerTools=[] When resolveWorkerTools is called Then returns {} (pure LLM-only mode)", () => {
      const result = resolveWorkerTools({ workerTools: [] });
      expect(result).toEqual({});
    });
  });

  describe("Scenario: explicit allowlist", () => {
    it("Given options.workerTools=['read','glob','grep'] When resolveWorkerTools is called Then returns those tools true and dangerous tools false", () => {
      const result = resolveWorkerTools({ workerTools: ["read", "glob", "grep"] });
      expect(result).toEqual({
        read: true,
        glob: true,
        grep: true,
        bash: false,
        write: false,
        edit: false,
        webfetch: false,
        patch: false,
        todowrite: false,
        moa_fusion: false,
      });
    });

    it("Given options.workerTools adds a non-default tool (knot) When resolveWorkerTools is called Then that tool is true and the dangerous default denies still apply", () => {
      const result = resolveWorkerTools({
        workerTools: ["read", "glob", "grep", "knot-mcp_search_hybrid_context"],
      });
      expect(result["knot-mcp_search_hybrid_context"]).toBe(true);
      expect(result.read).toBe(true);
      expect(result.bash).toBe(false);
      expect(result.moa_fusion).toBe(false);
    });

    it("Given options.workerTools includes bash When resolveWorkerTools is called Then bash is allowed (user opted in) but other dangerous tools stay false", () => {
      const result = resolveWorkerTools({ workerTools: ["read", "bash"] });
      expect(result.read).toBe(true);
      expect(result.bash).toBe(true);
      expect(result.write).toBe(false);
      expect(result.edit).toBe(false);
      expect(result.moa_fusion).toBe(false);
    });
  });

  describe("Scenario: recursion guard", () => {
    it("Given options.workerTools includes moa_fusion When resolveWorkerTools is called Then moa_fusion is forced false", () => {
      const result = resolveWorkerTools({ workerTools: ["read", "moa_fusion"] });
      expect(result.moa_fusion).toBe(false);
    });
  });

  describe("Scenario: invalid input", () => {
    it("Given options.workerTools is a string When resolveWorkerTools is called Then throws INVALID_WORKER_TOOLS", () => {
      let err: unknown;
      try {
        resolveWorkerTools({ workerTools: "read,glob" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("INVALID_WORKER_TOOLS");
    });

    it("Given options.workerTools contains non-strings When resolveWorkerTools is called Then throws INVALID_WORKER_TOOLS", () => {
      let err: unknown;
      try {
        resolveWorkerTools({ workerTools: ["read", 42, true] });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("INVALID_WORKER_TOOLS");
    });

    it("Given options.workerTools contains empty strings When resolveWorkerTools is called Then throws INVALID_WORKER_TOOLS", () => {
      let err: unknown;
      try {
        resolveWorkerTools({ workerTools: ["read", "   "] });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("INVALID_WORKER_TOOLS");
    });
  });
});