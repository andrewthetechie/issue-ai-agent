import { describe, it, expect } from "vitest";
import { resolveLabels } from "../src/github/labels.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
import type { IssueClassification } from "../src/types.js";

describe("resolveLabels", () => {
  it("maps category to configured labels", () => {
    const classification: IssueClassification = {
      category: "bug",
      priority: "high",
      confidence: 0.9,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    };

    const labels = resolveLabels(classification, DEFAULT_CONFIG);
    expect(labels).toContain("bug");
    expect(labels).toContain("priority: high");
  });

  it("adds priority label", () => {
    const classification: IssueClassification = {
      category: "feature",
      priority: "low",
      confidence: 0.8,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    };

    const labels = resolveLabels(classification, DEFAULT_CONFIG);
    expect(labels).toContain("enhancement");
    expect(labels).toContain("priority: low");
  });

  it("deduplicates labels", () => {
    const classification: IssueClassification = {
      category: "bug",
      priority: "high",
      confidence: 0.9,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    };

    const config = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug", "bug"], feature: ["enhancement"] },
    };

    const labels = resolveLabels(classification, config);
    const bugCount = labels.filter((l) => l === "bug").length;
    expect(bugCount).toBe(1);
  });

  it("handles unmapped category gracefully", () => {
    const classification: IssueClassification = {
      category: "security",
      priority: "critical",
      confidence: 0.95,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    };

    const config = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"] }, // No mapping for security
    };

    const labels = resolveLabels(classification, config);
    expect(labels).not.toContain("security");
    expect(labels).toContain("priority: critical");
  });
});
