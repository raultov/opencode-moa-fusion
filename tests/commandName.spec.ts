import { describe, expect, it } from "bun:test";
import {
  COMMAND_NAME_RE,
  DEFAULT_COMMAND_NAME,
  isValidCommandName,
  normalizeCommandName,
} from "../src/commandName.js";

describe("commandName [Unit] (installer slash-command naming)", () => {
  describe("Scenario: isValidCommandName", () => {
    it("Given the default 'moa' When isValidCommandName is called Then returns true", () => {
      expect(isValidCommandName("moa")).toBe(true);
    });

    it("Given short names with allowed characters When isValidCommandName is called Then returns true", () => {
      expect(isValidCommandName("team")).toBe(true);
      expect(isValidCommandName("council")).toBe(true);
      expect(isValidCommandName("mix-3")).toBe(true);
      expect(isValidCommandName("agents_v2")).toBe(true);
      expect(isValidCommandName("a")).toBe(true);
      expect(isValidCommandName("a1")).toBe(true);
    });

    it("Given a 32-character name When isValidCommandName is called Then returns true", () => {
      expect(isValidCommandName("a".repeat(32))).toBe(true);
    });

    it("Given a 33-character name When isValidCommandName is called Then returns false", () => {
      expect(isValidCommandName("a".repeat(33))).toBe(false);
    });

    it("Given names that start with a digit, underscore, or hyphen When isValidCommandName is called Then returns false", () => {
      expect(isValidCommandName("3moa")).toBe(false);
      expect(isValidCommandName("_moa")).toBe(false);
      expect(isValidCommandName("-moa")).toBe(false);
    });

    it("Given names containing uppercase, spaces, slashes, or dots When isValidCommandName is called Then returns false", () => {
      expect(isValidCommandName("MOA")).toBe(false);
      expect(isValidCommandName("Moa")).toBe(false);
      expect(isValidCommandName("moa cmd")).toBe(false);
      expect(isValidCommandName("moa.md")).toBe(false);
      expect(isValidCommandName("a/b")).toBe(false);
      expect(isValidCommandName("/moa")).toBe(false);
    });

    it("Given empty / non-string inputs When isValidCommandName is called Then returns false", () => {
      expect(isValidCommandName("")).toBe(false);
      expect(isValidCommandName(null)).toBe(false);
      expect(isValidCommandName(undefined)).toBe(false);
      expect(isValidCommandName(123)).toBe(false);
      expect(isValidCommandName({})).toBe(false);
    });
  });

  describe("Scenario: normalizeCommandName", () => {
    it("Given 'moa' When normalizeCommandName is called Then returns 'moa'", () => {
      expect(normalizeCommandName("moa")).toBe("moa");
    });

    it("Given '  MOA  ' When normalizeCommandName is called Then returns 'moa' (trim + lowercase)", () => {
      expect(normalizeCommandName("  MOA  ")).toBe("moa");
    });

    it("Given '/moa' (leading slash from a user typing '/moa' literally) When normalizeCommandName is called Then returns 'moa'", () => {
      expect(normalizeCommandName("/moa")).toBe("moa");
    });

    it("Given '///team' When normalizeCommandName is called Then returns 'team' (multiple slashes stripped)", () => {
      expect(normalizeCommandName("///team")).toBe("team");
    });

    it("Given an invalid name When normalizeCommandName is called Then returns null", () => {
      expect(normalizeCommandName("3moa")).toBe(null);
      expect(normalizeCommandName("moa cmd")).toBe(null);
      expect(normalizeCommandName("")).toBe(null);
      expect(normalizeCommandName(null)).toBe(null);
      expect(normalizeCommandName(undefined)).toBe(null);
    });
  });

  describe("Scenario: constants", () => {
    it("Given DEFAULT_COMMAND_NAME When read Then equals 'moa'", () => {
      expect(DEFAULT_COMMAND_NAME).toBe("moa");
    });

    it("Given COMMAND_NAME_RE When matched against 'moa' Then matches", () => {
      expect(COMMAND_NAME_RE.test("moa")).toBe(true);
    });
  });
});
