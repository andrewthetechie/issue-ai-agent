import { describe, it, expect } from "vitest";
import { resolveLabels } from "../src/forgejo/labels.js";
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

  it("applies full custom priorityLabelMapping", () => {
    const classification: IssueClassification = {
      category: "bug",
      priority: "critical",
      confidence: 0.9,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    };

    const config = {
      ...DEFAULT_CONFIG,
      priorityLabelMapping: {
        critical: ["P0"],
        high: ["P1"],
        medium: ["P2"],
        low: ["P3"],
      },
    };

    const labels = resolveLabels(classification, config);
    expect(labels).toContain("P0");
    expect(labels).not.toContain("priority: critical");
  });

  it("priority key absent from mapping adds no priority label", () => {
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
      priorityLabelMapping: {
        critical: ["P0"],
        medium: ["P2"],
        low: ["P3"],
      },
    };

    const labels = resolveLabels(classification, config);
    expect(labels).not.toContain("priority: high");
    expect(labels).not.toContain("P1");
  });

  it("priority mapped to empty array adds no priority label", () => {
    const classification: IssueClassification = {
      category: "bug",
      priority: "low",
      confidence: 0.9,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    };

    const config = {
      ...DEFAULT_CONFIG,
      priorityLabelMapping: {
        critical: ["P0"],
        high: ["P1"],
        medium: ["P2"],
        low: [],
      },
    };

    const labels = resolveLabels(classification, config);
    expect(labels).not.toContain("priority: low");
  });

  it("empty priorityLabelMapping adds no priority label for any priority", () => {
    const classification: IssueClassification = {
      category: "feature",
      priority: "high",
      confidence: 0.9,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    };

    const config = {
      ...DEFAULT_CONFIG,
      priorityLabelMapping: {},
    };

    const labels = resolveLabels(classification, config);
    expect(labels).not.toContain("priority: high");
  });

  it("multiple labels per priority are all added", () => {
    const classification: IssueClassification = {
      category: "bug",
      priority: "critical",
      confidence: 0.9,
      summary: "Test",
      suggestedLabels: [],
      reasoning: "Test",
    };

    const config = {
      ...DEFAULT_CONFIG,
      priorityLabelMapping: {
        critical: ["P0", "urgent"],
        high: ["P1"],
        medium: ["P2"],
        low: ["P3"],
      },
    };

    const labels = resolveLabels(classification, config);
    expect(labels).toContain("P0");
    expect(labels).toContain("urgent");
  });
});
