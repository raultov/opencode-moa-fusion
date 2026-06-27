import { describe, expect, it } from "bun:test";
import { sanitizeErrorMessage } from "../src/sanitize.js";

describe("sanitizeErrorMessage [Unit] (M1 / information leak in error messages)", () => {
  describe("Scenario: filesystem paths are redacted", () => {
    it("Given a unix-style /Users path When sanitized Then the path is replaced with <path>", () => {
      const out = sanitizeErrorMessage(
        new Error("ENOENT: /Users/alice/.config/opencode/sessions/x.json"),
      );
      expect(out).not.toContain("/Users/alice");
      expect(out).toContain("<path>");
    });

    it("Given a unix-style /home path When sanitized Then the path is replaced with <path>", () => {
      const out = sanitizeErrorMessage(new Error("failed at /home/bob/project/src/foo.ts:42"));
      expect(out).not.toContain("/home/bob");
      expect(out).toContain("<path>");
    });

    it("Given a unix-style /tmp path When sanitized Then the path is replaced with <path>", () => {
      const out = sanitizeErrorMessage("Could not read /tmp/secret-data-12345.json");
      expect(out).not.toContain("/tmp/secret-data-12345.json");
      expect(out).toContain("<path>");
    });

    it("Given a Windows C:\\ path When sanitized Then the path is replaced with <path>", () => {
      const out = sanitizeErrorMessage(new Error("EISDIR: C:\\Users\\Bob\\AppData\\opencode.json"));
      expect(out).not.toContain("C:\\Users\\Bob");
      expect(out).toContain("<path>");
    });
  });

  describe("Scenario: trace IDs / UUIDs are redacted", () => {
    it("Given a UUIDv4 trace ID When sanitized Then it is replaced with <id>", () => {
      const out = sanitizeErrorMessage(
        new Error("upstream failed [trace=550e8400-e29b-41d4-a716-446655440000]"),
      );
      expect(out).not.toContain("550e8400-e29b-41d4-a716-446655440000");
      expect(out).toContain("<id>");
    });

    it("Given a long hex trace ID When sanitized Then it is replaced with <id>", () => {
      const out = sanitizeErrorMessage("request 0123456789abcdef0123456789abcdef failed");
      expect(out).not.toContain("0123456789abcdef0123456789abcdef");
      expect(out).toContain("<id>");
    });
  });

  describe("Scenario: stack lines are removed", () => {
    it("Given a multi-line stack trace string When sanitized Then 'at ...' lines are dropped", () => {
      const msg = [
        "Error: something broke",
        "    at /Users/foo/bar.ts:10:5",
        "    at /Users/foo/baz.ts:25:11",
        "Please investigate",
      ].join("\n");
      const out = sanitizeErrorMessage(msg);
      expect(out).not.toContain("    at ");
      expect(out).toContain("something broke");
      expect(out).toContain("Please investigate");
    });
  });

  describe("Scenario: error name is preserved", () => {
    it("Given an Error subclass with a custom name When sanitized Then the name is preserved", () => {
      class MyError extends Error {
        constructor(msg: string) {
          super(msg);
          this.name = "MyCustomError";
        }
      }
      const out = sanitizeErrorMessage(new MyError("boom"));
      expect(out).toContain("MyCustomError");
      expect(out).toContain("boom");
    });
  });

  describe("Scenario: length is bounded", () => {
    it("Given a very long message When sanitized Then the output is truncated to <= 201 chars", () => {
      const long = "x".repeat(2000);
      const out = sanitizeErrorMessage(long);
      expect(out.length).toBeLessThanOrEqual(201);
    });
  });

  describe("Scenario: non-Error inputs are coerced safely", () => {
    it("Given undefined When sanitized Then returns 'Unknown error'", () => {
      expect(sanitizeErrorMessage(undefined)).toBe("Unknown error");
    });

    it("Given null When sanitized Then returns 'Unknown error'", () => {
      expect(sanitizeErrorMessage(null)).toBe("Unknown error");
    });

    it("Given a plain object When sanitized Then returns a JSON representation", () => {
      const out = sanitizeErrorMessage({ code: "X", path: "/Users/leak/foo" });
      expect(out).toContain("code");
      expect(out).not.toContain("/Users/leak");
      expect(out).toContain("<path>");
    });
  });

  describe("Scenario: whitespace is collapsed", () => {
    it("Given a message with newlines and tabs When sanitized Then whitespace is collapsed to single spaces", () => {
      const out = sanitizeErrorMessage("line1\n\n\tline2\t\tline3");
      expect(out).not.toContain("\n");
      expect(out).not.toContain("\t");
      expect(out).toBe("line1 line2 line3");
    });
  });
});
