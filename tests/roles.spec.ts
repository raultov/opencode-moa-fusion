import { describe, expect, it } from "bun:test";
import { resolveRoles } from "../src/roles.js";
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
