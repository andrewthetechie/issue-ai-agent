import { describe, it, expect } from "vitest";
import { buildReplyUserMessage } from "../src/prompts/reply.js";

describe("buildReplyUserMessage", () => {
  it("includes issue data with markers", () => {
    const result = buildReplyUserMessage("Bug title", "Bug body", "bug", "high", ["triage"]);
    expect(result).toContain("=== ISSUE DATA BEGIN");
    expect(result).toContain("=== ISSUE DATA END");
    expect(result).toContain("Title: Bug title");
    expect(result).toContain("Classification: bug (priority: high)");
    expect(result).toContain("Labels: triage");
    expect(result).toContain("Please draft a reply for this bug issue.");
  });

  it("handles empty labels", () => {
    const result = buildReplyUserMessage("Title", "Body", "feature", "low", []);
    expect(result).toContain("Labels: (none)");
  });
});
