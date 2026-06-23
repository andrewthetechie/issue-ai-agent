import { describe, it, expect } from "vitest";
import { shouldExclude } from "../src/exclude.js";
import type { RepoConfig } from "../src/types.js";

function makeConfig(overrides: Partial<RepoConfig["exclude"]> = {}): RepoConfig {
  return {
    enabled: true,
    createLabels: false,
    features: { classify: true, reply: true, duplicateSearch: true, commentReply: true },
    labelMapping: {},
    priorityLabelMapping: {},
    security: { maxIssueLength: 10000 },
    exclude: {
      labels: ["wontfix", "skip-ai"],
      users: ["dependabot[bot]"],
      ...overrides,
    },
    batch: { triageLabel: "triage", batchLimit: 10 },
    llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", maxTokens: 2048 },
  } as RepoConfig;
}

describe("shouldExclude", () => {
  it("returns true when issue user is in excluded users", () => {
    const issue = { user: { login: "dependabot[bot]" }, labels: [] };
    const config = makeConfig();
    expect(shouldExclude(issue, config)).toBe(true);
  });

  it("returns true when any issue label is in excluded labels", () => {
    const issue = { user: { login: "someuser" }, labels: [{ name: "wontfix" }, { name: "enhancement" }] };
    const config = makeConfig();
    expect(shouldExclude(issue, config)).toBe(true);
  });

  it("returns true when multiple labels match excluded labels", () => {
    const issue = { user: { login: "someuser" }, labels: [{ name: "skip-ai" }] };
    const config = makeConfig();
    expect(shouldExclude(issue, config)).toBe(true);
  });

  it("returns false for a non-excluded issue", () => {
    const issue = { user: { login: "someuser" }, labels: [{ name: "bug" }] };
    const config = makeConfig();
    expect(shouldExclude(issue, config)).toBe(false);
  });

  it("returns false when user is undefined", () => {
    const issue = { user: undefined, labels: [] };
    const config = makeConfig();
    expect(shouldExclude(issue, config)).toBe(false);
  });

  it("returns false when user is undefined but labels are not excluded", () => {
    const issue = { user: undefined, labels: [{ name: "enhancement" }] };
    const config = makeConfig();
    expect(shouldExclude(issue, config)).toBe(false);
  });

  it("returns true when user is undefined but label is excluded", () => {
    const issue = { user: undefined, labels: [{ name: "wontfix" }] };
    const config = makeConfig();
    expect(shouldExclude(issue, config)).toBe(true);
  });

  it("returns false when both user and labels are empty", () => {
    const issue = { user: undefined, labels: [] };
    const config = makeConfig();
    expect(shouldExclude(issue, config)).toBe(false);
  });

  it("respects custom excluded users", () => {
    const config = makeConfig({ users: ["mybot"] });
    const issue = { user: { login: "mybot" }, labels: [] };
    expect(shouldExclude(issue, config)).toBe(true);

    const issue2 = { user: { login: "otheruser" }, labels: [] };
    expect(shouldExclude(issue2, config)).toBe(false);
  });

  it("respects custom excluded labels", () => {
    const config = makeConfig({ labels: ["needs-review"] });
    const issue = { user: { login: "someuser" }, labels: [{ name: "needs-review" }] };
    expect(shouldExclude(issue, config)).toBe(true);

    const issue2 = { user: { login: "someuser" }, labels: [{ name: "bug" }] };
    expect(shouldExclude(issue2, config)).toBe(false);
  });
});
