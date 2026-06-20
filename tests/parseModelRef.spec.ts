import { describe, expect, it } from "bun:test";
import { parseModelRef } from "../src/parseModelRef.js";
import { RoleResolutionError } from "../src/types.js";

describe("parseModelRef [Component]", () => {
  describe("Scenario: standard ref", () => {
    it("Given 'openai/gpt-4o-mini' When parsed Then { providerID: 'openai', modelID: 'gpt-4o-mini' }", () => {
      expect(parseModelRef("openai/gpt-4o-mini")).toEqual({
        providerID: "openai",
        modelID: "gpt-4o-mini",
      });
    });
  });

  describe("Scenario: model id contains slashes", () => {
    it("Given 'anthropic/claude-3-5/preview' When parsed Then { providerID: 'anthropic', modelID: 'claude-3-5/preview' }", () => {
      expect(parseModelRef("anthropic/claude-3-5/preview")).toEqual({
        providerID: "anthropic",
        modelID: "claude-3-5/preview",
      });
    });
  });

  describe("Scenario: missing slash", () => {
    it("Given 'gpt-4' When parsed Then it throws RoleResolutionError('INVALID_REF')", () => {
      let err: unknown;
      try {
        parseModelRef("gpt-4");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("INVALID_REF");
    });
  });

  describe("Scenario: empty string", () => {
    it("Given '' When parsed Then it throws RoleResolutionError('INVALID_REF')", () => {
      let err: unknown;
      try {
        parseModelRef("");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoleResolutionError);
      expect((err as RoleResolutionError).code).toBe("INVALID_REF");
    });
  });

  describe("Scenario: leading/trailing whitespace", () => {
    it("Given '  openai/gpt-4o-mini  ' When parsed Then it trims before parsing", () => {
      expect(parseModelRef("  openai/gpt-4o-mini  ")).toEqual({
        providerID: "openai",
        modelID: "gpt-4o-mini",
      });
    });
  });
});
