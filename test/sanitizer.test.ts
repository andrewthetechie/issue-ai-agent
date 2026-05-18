import { describe, it, expect } from "vitest";
import { sanitizeIssueBody, sanitizeIssueTitle, buildSafeIssueContent } from "../src/sanitizer.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

describe("sanitizeIssueBody", () => {
  it("returns placeholder for null body", () => {
    expect(sanitizeIssueBody(null, DEFAULT_CONFIG)).toBe("(No issue body provided)");
  });

  it("removes zero-width characters", () => {
    const input = "Hello​World‌‍";
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe("HelloWorld");
  });

  it("removes control characters", () => {
    const input = "Hello\x00\x01World\x07";
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe("HelloWorld");
  });

  it("truncates to max length", () => {
    const config = { ...DEFAULT_CONFIG, security: { maxIssueLength: 10 } };
    const result = sanitizeIssueBody("This is a very long string", config);
    expect(result).toBe("This is a \n... (truncated)");
  });

  it("collapses excessive newlines", () => {
    const input = "Hello\n\n\n\n\n\nWorld";
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe("Hello\n\n\nWorld");
  });

  it("preserves normal content", () => {
    const input = "This is a normal issue body with **markdown** and `code`.";
    expect(sanitizeIssueBody(input, DEFAULT_CONFIG)).toBe(input);
  });
});

describe("sanitizeIssueTitle", () => {
  it("removes zero-width characters from title", () => {
    expect(sanitizeIssueTitle("Bug​Report")).toBe("BugReport");
  });

  it("truncates long titles", () => {
    const longTitle = "A".repeat(600);
    const result = sanitizeIssueTitle(longTitle);
    expect(result.length).toBe(503); // 500 + "..."
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("buildSafeIssueContent", () => {
  it("wraps content with data markers", () => {
    const result = buildSafeIssueContent("Test Title", "Test Body", ["bug"]);
    expect(result).toContain("=== ISSUE DATA BEGIN");
    expect(result).toContain("=== ISSUE DATA END");
    expect(result).toContain("Title: Test Title");
    expect(result).toContain("Existing Labels: bug");
    expect(result).toContain("Body:\nTest Body");
  });

  it("handles empty labels", () => {
    const result = buildSafeIssueContent("Title", "Body", []);
    expect(result).toContain("Existing Labels: (none)");
  });
});
