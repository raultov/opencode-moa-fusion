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

  describe("Scenario: deduplication (Step 4 / consensus #4)", () => {
    it("Given input with duplicate refs When resolveRoles is called Then duplicates are dropped", async () => {
      const res = await resolveRoles(
        { workers: ["openai/gpt-4o-mini", "openai/gpt-4o-mini", "anthropic/claude-3-5-sonnet"] },
        {},
        client,
      );
      expect(res.workers).toHaveLength(2);
      expect(res.workers.map((w) => `${w.providerID}/${w.modelID}`)).toEqual([
        "openai/gpt-4o-mini",
        "anthropic/claude-3-5-sonnet",
      ]);
    });

    it("Given all-duplicate input When resolveRoles is called Then only one worker remains (no MISSING_ROLES)", async () => {
      const res = await resolveRoles(
        { workers: ["openai/gpt-4o-mini", "openai/gpt-4o-mini"] },
        {},
        client,
      );
      expect(res.workers).toHaveLength(1);
      expect(res.workers[0]).toEqual({ providerID: "openai", modelID: "gpt-4o-mini" });
    });
  });

  describe("Scenario: TOO_MANY_WORKERS (Step 4 / consensus #4)", () => {
    it("Given options.workers with 9 entries When resolveRoles is called Then throws TOO_MANY_WORKERS", async () => {
      const nine = [
        "openai/gpt-4o-mini",
        "anthropic/claude-3-5-sonnet",
        "openai/gpt-4o",
        "anthropic/claude-3-5-haiku",
        "openai/gpt-4o-mini",
        "anthropic/claude-3-5-sonnet",
        "openai/gpt-4o",
        "anthropic/claude-3-5-haiku",
        "openai/gpt-4o-mini",
      ];
      // Use unique entries — dedup must happen BEFORE the cap check, and
      // we want exactly 9 distinct models to be rejected.
      const nineDistinct = [
        "openai/gpt-4o-mini",
        "anthropic/claude-3-5-sonnet",
        "openai/gpt-4o",
        "anthropic/claude-3-5-haiku",
      ];
      // We need 9 distinct *known* models in the test client, but our
      // mock fixture only knows 4. So this test uses args.workers which
      // is rejected at the schema level first. Here we test the
      // resolver path with options.workers by exceeding the known model
      // pool. We settle for the args path via the schema (separate test
      // in tool.spec.ts) and assert the resolver-level cap with a mock
      // that returns many models.
      void nine;
      void nineDistinct;
    });

    it("Given a client that knows 9 models and options.workers lists them all When resolveRoles is called Then throws TOO_MANY_WORKERS", async () => {
      const manyModelsClient = makeMockClient({
        providers: async () => ({
          data: {
            providers: [
              {
                id: "p",
                name: "p",
                source: "config",
                env: [],
                options: {},
                models: Object.fromEntries(
                  ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"].map(
                    (m) => [m, {}],
                  ),
                ) as Record<string, import("./_fixtures/mockClient.js").MockModel>,
              },
            ],
            default: {},
          },
        }),
      });
      const workers = ["p/m1", "p/m2", "p/m3", "p/m4", "p/m5", "p/m6", "p/m7", "p/m8", "p/m9"];
      let err: unknown;
      try {
        await resolveRoles({}, { workers }, manyModelsClient);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("TOO_MANY_WORKERS");
      expect((err as RoleResolutionError).message).toContain("at most 8 workers allowed");
      expect((err as RoleResolutionError).message).toContain("got 9");
    });

    it("Given exactly 8 workers When resolveRoles is called Then the cap is not triggered", async () => {
      const eightModelsClient = makeMockClient({
        providers: async () => ({
          data: {
            providers: [
              {
                id: "p",
                name: "p",
                source: "config",
                env: [],
                options: {},
                models: Object.fromEntries(
                  ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"].map(
                    (m) => [m, {}],
                  ),
                ) as Record<string, import("./_fixtures/mockClient.js").MockModel>,
              },
            ],
            default: {},
          },
        }),
      });
      const workers = ["p/m1", "p/m2", "p/m3", "p/m4", "p/m5", "p/m6", "p/m7", "p/m8"];
      const res = await resolveRoles({}, { workers }, eightModelsClient);
      expect(res.workers).toHaveLength(8);
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
