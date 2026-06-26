import { describe, expect, it } from "bun:test";
import { resolveAgent, resolveRoles, resolveTimeoutMs } from "../src/roles.js";
import { RoleResolutionError } from "../src/types.js";
import { makeMockClient } from "./_fixtures/mockClient.js";

describe("resolveRoles [Component]", () => {
  const client = makeMockClient();
  const validWorkers = ["openai/gpt-4o-mini"];

  describe("Scenario: explicit args.workers", () => {
    it("Given explicit workers in args When resolveRoles is called Then returns { source: 'args' } and validated roles", async () => {
      const res = await resolveRoles({ workers: validWorkers }, {}, client);
      expect(res.source).toBe("args");
      expect(res.workers).toEqual([{ providerID: "openai", modelID: "gpt-4o-mini" }]);
    });
  });

  describe("Scenario: options.workers and no args", () => {
    it("Given options When resolveRoles is called Then returns { source: 'options' }", async () => {
      const res = await resolveRoles({}, { workers: validWorkers }, client);
      expect(res.source).toBe("options");
    });
  });

  describe("Scenario: neither args nor options", () => {
    it("Given no config When resolveRoles is called Then throws MISSING_ROLES with instructions", async () => {
      let err: unknown;
      try {
        await resolveRoles({}, {}, client);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("MISSING_ROLES");
      expect((err as RoleResolutionError).message).toContain("moa_fusion: no models configured");
    });
  });

  describe("Scenario: ref points to a model not in client.config.providers()", () => {
    it("Given unknown model When resolveRoles is called Then throws UNKNOWN_MODEL", async () => {
      let err: unknown;
      try {
        await resolveRoles({ workers: ["openai/gpt-999"] }, {}, client);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("UNKNOWN_MODEL");
      expect((err as RoleResolutionError).message).toContain("openai/gpt-999");
    });
  });

  describe("Scenario: ref has bad shape", () => {
    it("Given bad shape When resolveRoles is called Then throws INVALID_REF", async () => {
      let err: unknown;
      try {
        await resolveRoles({ workers: ["bad-shape"] }, {}, client);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("INVALID_REF");
    });
  });

  describe("Scenario: args.workers is empty array", () => {
    it("Given empty workers When resolveRoles is called Then throws MISSING_ROLES", async () => {
      let err: unknown;
      try {
        await resolveRoles({ workers: [] }, {}, client);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("MISSING_ROLES");
    });
  });
});

describe("resolveAgent [Unit]", () => {
  describe("Scenario: default", () => {
    it("Given no options When resolveAgent is called Then returns 'general'", () => {
      expect(resolveAgent({})).toBe("general");
    });

    it("Given options.agent is undefined When resolveAgent is called Then returns 'general'", () => {
      expect(resolveAgent({ agent: undefined })).toBe("general");
    });

    it("Given options.agent is an empty string When resolveAgent is called Then returns the default", () => {
      expect(resolveAgent({ agent: "" })).toBe("general");
    });

    it("Given options.agent is a non-string (number) When resolveAgent is called Then returns the default", () => {
      expect(resolveAgent({ agent: 42 as unknown as string })).toBe("general");
    });
  });

  describe("Scenario: explicit", () => {
    it("Given options.agent='plan' When resolveAgent is called Then returns 'plan'", () => {
      expect(resolveAgent({ agent: "plan" })).toBe("plan");
    });

    it("Given a custom fallback When resolveAgent is called Then uses it", () => {
      expect(resolveAgent({}, "custom")).toBe("custom");
    });
  });
});

describe("resolveTimeoutMs [Unit]", () => {
  describe("Scenario: no args and no options", () => {
    it("Given empty inputs When resolveTimeoutMs is called Then returns default 300000", () => {
      expect(resolveTimeoutMs({}, {})).toBe(300000);
    });
  });

  describe("Scenario: args.timeoutMs provided", () => {
    it("Given args.timeoutMs When resolveTimeoutMs is called Then returns args value", () => {
      expect(resolveTimeoutMs({ timeoutMs: 60000 }, {})).toBe(60000);
    });
  });

  describe("Scenario: options.timeoutMs provided", () => {
    it("Given options.timeoutMs When resolveTimeoutMs is called Then returns options value", () => {
      expect(resolveTimeoutMs({}, { timeoutMs: 90000 })).toBe(90000);
    });
  });

  describe("Scenario: both args and options", () => {
    it("Given both When resolveTimeoutMs is called Then args wins", () => {
      expect(resolveTimeoutMs({ timeoutMs: 10000 }, { timeoutMs: 20000 })).toBe(10000);
    });
  });

  describe("Scenario: invalid values fall back", () => {
    it("Given non-positive args.timeoutMs When resolveTimeoutMs is called Then ignores it and uses options/default", () => {
      expect(resolveTimeoutMs({ timeoutMs: 0 }, {})).toBe(300000);
      expect(resolveTimeoutMs({ timeoutMs: -1 }, {})).toBe(300000);
    });
    it("Given non-number options.timeoutMs When resolveTimeoutMs is called Then falls back to default", () => {
      expect(resolveTimeoutMs({}, { timeoutMs: "300000" as unknown as number })).toBe(300000);
    });
  });

  describe("Scenario: custom fallback", () => {
    it("Given fallback When resolveTimeoutMs is called Then uses fallback", () => {
      expect(resolveTimeoutMs({}, {}, 120000)).toBe(120000);
    });
  });
});
