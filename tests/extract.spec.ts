import { describe, expect, it } from "bun:test";
import type { Part } from "@opencode-ai/sdk";
import { partsToText } from "../src/extract.js";

describe("partsToText [Component]", () => {
  describe("Scenario: single text part", () => {
    it("Given parts=[{type:'text', text:'hello'}] When partsToText is called Then it returns 'hello'", () => {
      const parts: Part[] = [
        { type: "text", text: "hello", id: "1", sessionID: "s1", messageID: "m1" },
      ];
      expect(partsToText(parts)).toBe("hello");
    });
  });

  describe("Scenario: multiple text parts", () => {
    it("Given multiple text parts When partsToText is called Then it concatenates them without separators", () => {
      const parts: Part[] = [
        { type: "text", text: "hello ", id: "1", sessionID: "s1", messageID: "m1" },
        { type: "text", text: "world", id: "2", sessionID: "s1", messageID: "m1" },
      ];
      expect(partsToText(parts)).toBe("hello world");
    });
  });

  describe("Scenario: mixed parts", () => {
    it("Given a text part and a non-text part When partsToText is called Then only the text part is concatenated", () => {
      const parts: Part[] = [
        { type: "text", text: "hello", id: "1", sessionID: "s1", messageID: "m1" },
        { type: "subtask", prompt: "task", id: "2", sessionID: "s1", messageID: "m1" },
      ] as Part[];
      expect(partsToText(parts)).toBe("hello");
    });
  });

  describe("Scenario: empty parts", () => {
    it("Given parts=[] When partsToText is called Then it returns the empty string", () => {
      expect(partsToText([])).toBe("");
    });
  });

  describe("Scenario: text parts with empty strings", () => {
    it("Given parts with empty strings When partsToText is called Then it joins to empty string", () => {
      const parts: Part[] = [
        { type: "text", text: "", id: "1", sessionID: "s1", messageID: "m1" },
        { type: "text", text: "", id: "2", sessionID: "s1", messageID: "m1" },
      ];
      expect(partsToText(parts)).toBe("");
    });
  });
});
