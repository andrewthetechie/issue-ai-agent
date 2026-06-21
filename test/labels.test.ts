import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveLabels, ensureLabelsExist } from "../src/forgejo/labels.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
import type { IssueClassification, Logger, RepoConfig } from "../src/types.js";

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

describe("ensureLabelsExist", () => {
  let mockOctokit: any;
  let mockLogger: Logger;
  let mockRequest: ReturnType<typeof vi.fn>;

  function makeLabel(name: string) {
    return { name, id: 1 };
  }

  function makeError(status: number, message: string) {
    const err = new Error(message);
    Object.defineProperty(err, "status", { value: status });
    Object.defineProperty(err, "message", { value: message });
    return err;
  }

  beforeEach(() => {
    mockRequest = vi.fn();
    mockOctokit = {
      request: mockRequest,
    };
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => mockLogger,
    };
  });

  it("flattens and deduplicates labels from both maps", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"], feature: ["enhancement"] },
      priorityLabelMapping: { critical: ["P0"], high: ["P1"] },
    };
    mockRequest.mockResolvedValue({ data: [] });

    await ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger);

    // Should have created 4 labels (bug, enhancement, P0, P1)
    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/labels",
      expect.objectContaining({ name: "bug", color: "ededed", description: "" }),
    );
    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/labels",
      expect.objectContaining({ name: "enhancement", color: "ededed", description: "" }),
    );
    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/labels",
      expect.objectContaining({ name: "P0", color: "ededed", description: "" }),
    );
    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/labels",
      expect.objectContaining({ name: "P1", color: "ededed", description: "" }),
    );
  });

  it("deduplicates overlapping values between maps", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["shared"], feature: ["enhancement"] },
      priorityLabelMapping: { critical: ["shared"], high: ["P1"] },
    };
    mockRequest.mockResolvedValue({ data: [] });

    await ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger);

    // "shared" should only be created once
    const sharedCalls = mockRequest.mock.calls.filter(
      (call: unknown[]) =>
        call[0] === "POST /repos/{owner}/{repo}/labels" &&
        (call[1] as any).name === "shared",
    );
    expect(sharedCalls).toHaveLength(1);
  });

  it("creates only missing labels; all-present → zero create calls", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"], feature: ["enhancement"] },
      priorityLabelMapping: {},
    };
    mockRequest.mockResolvedValue({
      data: [makeLabel("bug"), makeLabel("enhancement")],
    });

    await ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger);

    // Only list call, no create calls
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/labels",
      expect.objectContaining({ limit: 100, page: 1 }),
    );
  });

  it("case-sensitive matching: existing Bug does not suppress bug", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"] },
      priorityLabelMapping: {},
    };
    mockRequest.mockResolvedValue({ data: [makeLabel("Bug")] });

    await ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger);

    // Should create "bug" even though "Bug" exists
    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/labels",
      expect.objectContaining({ name: "bug" }),
    );
  });

  it("pagination: labels split across 2 pages; page-2 label recognized as existing", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"], feature: ["enhancement"] },
      priorityLabelMapping: {},
    };

    // First page returns 100 labels (including bug but not enhancement)
    const page1Labels = Array.from({ length: 99 }, (_, i) => makeLabel(`page1-${i}`)).concat(
      makeLabel("bug"),
    );
    // Second page returns 1 label (enhancement)
    const page2Labels = [makeLabel("enhancement")];

    mockRequest
      .mockResolvedValueOnce({ data: page1Labels })
      .mockResolvedValueOnce({ data: page2Labels });

    await ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger);

    // Should have made 2 list calls (page 1 and page 2), no create calls
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      "GET /repos/{owner}/{repo}/labels",
      expect.objectContaining({ limit: 100, page: 1 }),
    );
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      "GET /repos/{owner}/{repo}/labels",
      expect.objectContaining({ limit: 100, page: 2 }),
    );
    // No create calls since both labels exist
    const createCalls = mockRequest.mock.calls.filter(
      (call: unknown[]) => call[0] === "POST /repos/{owner}/{repo}/labels",
    );
    expect(createCalls).toHaveLength(0);
  });

  it("asserts list request uses limit param (not per_page)", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"] },
      priorityLabelMapping: {},
    };
    mockRequest.mockResolvedValue({ data: [] });

    await ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger);

    const listCall = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(listCall).toHaveProperty("limit");
    expect(listCall).not.toHaveProperty("per_page");
  });

  it("swallows already-exists 422 error", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"] },
      priorityLabelMapping: {},
    };
    mockRequest
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(makeError(422, "Label already exists"));

    await expect(
      ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger),
    ).resolves.toBeUndefined();

    // Should not have warned
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("non-already-exists 422 is treated as per-label failure (warn)", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"] },
      priorityLabelMapping: {},
    };
    mockRequest
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(makeError(422, "Invalid color format"));

    await expect(
      ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger),
    ).resolves.toBeUndefined();

    // Should have warned
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { label: "bug" },
      "Failed to create label",
    );
  });

  it("per-label 403 logs warning and continues with remaining labels", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"], feature: ["enhancement"] },
      priorityLabelMapping: {},
    };
    mockRequest
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(makeError(403, "Forbidden"))
      .mockResolvedValueOnce({ data: {} });

    await expect(
      ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger),
    ).resolves.toBeUndefined();

    // Should have warned for bug
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { label: "bug" },
      "Failed to create label",
    );
    // Should have still tried enhancement
    expect(mockRequest).toHaveBeenCalledWith(
      "POST /repos/{owner}/{repo}/labels",
      expect.objectContaining({ name: "enhancement" }),
    );
  });

  it("list-call failure throws", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"] },
      priorityLabelMapping: {},
    };
    mockRequest.mockRejectedValueOnce(makeError(500, "Server error"));

    await expect(
      ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger),
    ).rejects.toThrow("Server error");
  });

  it("created labels carry color #ededed and empty description", async () => {
    const config: RepoConfig = {
      ...DEFAULT_CONFIG,
      labelMapping: { bug: ["bug"] },
      priorityLabelMapping: {},
    };
    mockRequest.mockResolvedValue({ data: [] });

    await ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger);

    const createCall = mockRequest.mock.calls.find(
      (call: unknown[]) => call[0] === "POST /repos/{owner}/{repo}/labels",
    );
    expect(createCall).toBeDefined();
    expect(createCall![1]).toMatchObject({
      color: "ededed",
      description: "",
    });
  });
});
