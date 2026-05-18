import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

describe("DEFAULT_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CONFIG.features.classify).toBe(true);
    expect(DEFAULT_CONFIG.features.reply).toBe(true);
    expect(DEFAULT_CONFIG.security.maxIssueLength).toBe(10000);
    expect(DEFAULT_CONFIG.labelMapping.bug).toEqual(["bug"]);
    expect(DEFAULT_CONFIG.exclude.labels).toContain("wontfix");
    expect(DEFAULT_CONFIG.llm.model).toContain("claude-haiku");
  });

  it("maps all issue categories", () => {
    const categories = ["bug", "feature", "question", "docs", "duplicate", "invalid", "security"];
    for (const cat of categories) {
      expect(DEFAULT_CONFIG.labelMapping[cat]).toBeDefined();
    }
  });
});
