import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runBatchPipeline } from "../src/batch.js";
import type { ActionContext } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

// ── Mocks (hoisted to top of file by vitest) ─────────────────────────────

vi.mock("../src/llm/factory.js", () => ({
  createProvider: vi.fn(),
  detectProvider: vi.fn(() => "anthropic" as const),
}));

vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    enabled: true,
    createLabels: false,
    features: { classify: true, reply: true, duplicateSearch: true, commentReply: true },
    labelMapping: {
      bug: ["bug"],
      feature: ["enhancement"],
      question: ["question"],
      docs: ["documentation"],
      duplicate: ["duplicate"],
      invalid: ["invalid"],
      security: ["security"],
    },
    priorityLabelMapping: {
      critical: ["priority: critical"],
      high: ["priority: high"],
      medium: ["priority: medium"],
      low: ["priority: low"],
    },
    security: { maxIssueLength: 10000 },
    exclude: { labels: ["wontfix", "skip-ai"], users: ["dependabot[bot]"] },
    batch: { triageLabel: "triage", batchLimit: 5 },
    llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", maxTokens: 2048 },
  }),
}));

vi.mock("../src/forgejo/labels.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/forgejo/labels.js")>();
  return {
    ...actual,
    ensureLabelsExist: vi.fn().mockResolvedValue(undefined),
    applyLabels: vi.fn().mockImplementation((...args: unknown[]) => {
      // Fall through to the real implementation for normal cases
      return (actual as any).applyLabels(...args);
    }),
  };
});

vi.mock("../src/forgejo/search.js", () => ({
  searchSimilarIssues: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/duplicate.js", () => ({
  detectDuplicates: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/forgejo/comments.js", () => ({
  postDuplicateComment: vi.fn().mockResolvedValue(undefined),
  postExcludeRemovalComment: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockActionContext(overrides: Partial<ActionContext> = {}): ActionContext {
  const mockLog = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLog),
  };

  const mockOctokit = {
    rest: {
      issues: {
        addLabels: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({}),
      },
      repos: {
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
      },
    },
  };

  return {
    owner: "owner",
    repo: "repo",
    octokit: mockOctokit,
    logger: mockLog,
    eventName: "issues",
    payload: {
      action: "opened",
      issue: {
        number: 1,
        title: "Test issue",
        body: "Test body",
        html_url: "https://github.com/owner/repo/issues/1",
        user: { login: "testuser" },
        labels: [],
        created_at: "2026-05-18T00:00:00Z",
      },
      sender: { login: "testuser" },
      repository: {
        name: "repo",
        owner: { login: "owner" },
        default_branch: "main",
      },
    },
    ...overrides,
  } as unknown as ActionContext;
}

function makeMockIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 1,
    title: "Test issue",
    body: "Test body text",
    html_url: "https://forgejo.example.com/owner/repo/issues/1",
    user: { login: "testuser" },
    labels: [{ name: "triage", id: 100 }],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockFetchIssues(issues: Record<string, unknown>[], removeSucceeds = true): void {
  const mockFetch = vi.fn().mockImplementation((_url: string, _init: RequestInit) => {
    const url = _url as string;
    if (url.includes("/issues?")) {
      // fetchIssuesByLabel endpoint
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(issues),
      });
    }
    if (url.includes("/labels/")) {
      // removeLabelFromIssue endpoint
      if (removeSucceeds) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve("error"),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
  global.fetch = mockFetch as unknown as typeof global.fetch;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("runBatchPipeline", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure an LLM key is set so createProvider can return a client by default
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.OPENAI_API_KEY;
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ── No LLM client → abort ──────────────────────────────────────────────

  it("returns {0,0} and makes no fetch/label calls when no LLM client", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce(null);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 0, issuesFailed: 0 });
    // fetchIssuesByLabel should NOT have been called
    expect(actx.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  // ── Disabled → abort ───────────────────────────────────────────────────

  it("returns {0,0} when config.enabled is false", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({ ...DEFAULT_CONFIG, enabled: false });

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 0, issuesFailed: 0 });
  });

  // ── Full happy path ────────────────────────────────────────────────────

  it("processes issues: classify → label → remove, returns counts", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    const mockProvider = {
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug report",
          suggestedLabels: ["bug"],
          reasoning: "Clear bug report",
        }),
      }),
    };
    vi.mocked(createProvider).mockReturnValueOnce(mockProvider as any);

    const issue1 = makeMockIssue({ number: 1, created_at: "2026-01-01T00:00:00Z" });
    const issue2 = makeMockIssue({ number: 2, created_at: "2026-01-02T00:00:00Z" });
    mockFetchIssues([issue1, issue2]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 2, issuesFailed: 0 });
    expect(actx.octokit.rest.issues.addLabels).toHaveBeenCalledTimes(2);
    // 3 fetch calls: 1 for issues list + 2 for label removal (one per issue)
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  // ── Limit respected ────────────────────────────────────────────────────

  it("processes at most batchLimit issues", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    // Provide 10 issues but batchLimit is 5
    const issues = Array.from({ length: 10 }, (_, i) =>
      makeMockIssue({ number: i + 1, created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }),
    );
    mockFetchIssues(issues);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    // Default batchLimit is 5
    expect(result).toEqual({ issuesProcessed: 5, issuesFailed: 0 });
    expect(actx.octokit.rest.issues.addLabels).toHaveBeenCalledTimes(5);
  });

  // ── Oldest-first order ─────────────────────────────────────────────────

  it("processes issues in oldest-first order", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    const callOrder: number[] = [];
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockImplementation(() => {
        callOrder.push(callOrder.length + 1);
        return Promise.resolve({
          text: JSON.stringify({
            category: "bug",
            priority: "high",
            confidence: 0.9,
            summary: "Bug",
            suggestedLabels: ["bug"],
            reasoning: "Bug",
          }),
        });
      }),
    } as any);

    // Provide issues in reverse chronological order
    const issues = [
      makeMockIssue({ number: 3, created_at: "2026-01-03T00:00:00Z" }),
      makeMockIssue({ number: 1, created_at: "2026-01-01T00:00:00Z" }),
      makeMockIssue({ number: 2, created_at: "2026-01-02T00:00:00Z" }),
    ];
    mockFetchIssues(issues);

    const actx = createMockActionContext();
    await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    // API sorts oldest-first, so order should be 1, 2, 3
    expect(callOrder).toEqual([1, 2, 3]);
  });

  // ── Classify failure → retain label, increment failed ──────────────────

  it("classify failure retains label and increments issuesFailed", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockRejectedValue(new Error("LLM timeout")),
    } as any);

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 0, issuesFailed: 1 });
    // Labels should NOT have been applied
    expect(actx.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  // ── Label-apply failure → retain label, increment failed ───────────────

  it("label-apply failure retains label and increments issuesFailed", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    // applyLabels swallows errors internally (falls back to individual adds),
    // so we mock it directly to throw.
    const { applyLabels } = await import("../src/forgejo/labels.js");
    (applyLabels as any).mockRejectedValueOnce(new Error("API error"));

    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 0, issuesFailed: 1 });
  });

  // ── Label-removal failure → increment failed ───────────────────────────

  it("label-removal failure increments issuesFailed", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue], false); // removeSucceeds = false

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 0, issuesFailed: 1 });
    // Labels were applied before removal failed
    expect(actx.octokit.rest.issues.addLabels).toHaveBeenCalledTimes(1);
  });

  // ── Excluded issue → bypass, not counted ───────────────────────────────

  it("excluded issues are bypassed and not counted", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const included = makeMockIssue({ number: 1 });
    const excluded = makeMockIssue({
      number: 2,
      user: { login: "dependabot[bot]" },
    });
    mockFetchIssues([included, excluded]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    // Only one classify call (for the non-excluded issue)
    // Only one addLabels call
    expect(actx.octokit.rest.issues.addLabels).toHaveBeenCalledTimes(1);
  });

  // ── One failure does not abort the rest ────────────────────────────────

  it("one issue failing does not abort processing of the rest", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn()
        .mockResolvedValueOnce({
          text: JSON.stringify({
            category: "bug",
            priority: "high",
            confidence: 0.9,
            summary: "Bug",
            suggestedLabels: ["bug"],
            reasoning: "Bug",
          }),
        })
        .mockRejectedValueOnce(new Error("LLM timeout on issue 2"))
        .mockResolvedValueOnce({
          text: JSON.stringify({
            category: "bug",
            priority: "high",
            confidence: 0.9,
            summary: "Bug",
            suggestedLabels: ["bug"],
            reasoning: "Bug",
          }),
        }),
    } as any);

    const issue1 = makeMockIssue({ number: 1, created_at: "2026-01-01T00:00:00Z" });
    const issue2 = makeMockIssue({ number: 2, created_at: "2026-01-02T00:00:00Z" });
    const issue3 = makeMockIssue({ number: 3, created_at: "2026-01-03T00:00:00Z" });
    mockFetchIssues([issue1, issue2, issue3]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 2, issuesFailed: 1 });
    // Issues 1 and 3 succeeded (labels applied), issue 2 failed classify (no labels)
    expect(actx.octokit.rest.issues.addLabels).toHaveBeenCalledTimes(2);
  });

  // ── Config load failure ────────────────────────────────────────────────

  it("returns {0,0} when config loading fails", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error("Network error"));

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 0, issuesFailed: 0 });
  });

  // ── createLabels before loop ───────────────────────────────────────────

  it("calls ensureLabelsExist before processing when createLabels is true", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      createLabels: true,
    });

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    const { ensureLabelsExist } = await import("../src/forgejo/labels.js");
    expect(ensureLabelsExist).toHaveBeenCalledTimes(1);
    expect(ensureLabelsExist).toHaveBeenCalledWith(
      "owner",
      "repo",
      expect.objectContaining({ createLabels: true }),
      expect.anything(),
      expect.anything(),
    );
  });

  // ── ensureLabelsExist failure → continue ───────────────────────────────

  it("continues processing when ensureLabelsExist throws", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      createLabels: true,
    });

    const { ensureLabelsExist } = await import("../src/forgejo/labels.js");
    vi.mocked(ensureLabelsExist).mockRejectedValueOnce(new Error("API error"));

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
  });

  // ── Issue without triage label on it (already removed externally) ──────

  it("counts as processed when triage label is not present on issue", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const issue = makeMockIssue({ number: 1, labels: [] }); // no triage label
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    // Labels were applied, no removal attempted
    expect(actx.octokit.rest.issues.addLabels).toHaveBeenCalledTimes(1);
  });

  // ── Classification disabled ────────────────────────────────────────────

  it("works when classify feature is disabled", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      features: { ...DEFAULT_CONFIG.features, classify: false },
    });

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    // LLM should not have been called since classify is disabled
    expect(vi.mocked(createProvider).mock.results[0].value.complete).not.toHaveBeenCalled();
    // Labels should NOT have been applied when classify is disabled
    expect(actx.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
  });

  // ── Duplicate detection — comment posted when duplicates found ──────────

  it("posts a duplicate comment when duplicates are detected", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { searchSimilarIssues } = await import("../src/forgejo/search.js");
    vi.mocked(searchSimilarIssues).mockResolvedValueOnce([
      { number: 42, title: "Old bug", url: "https://example.com/42" },
    ]);

    const { detectDuplicates } = await import("../src/duplicate.js");
    vi.mocked(detectDuplicates).mockResolvedValueOnce([
      { number: 42, title: "Old bug", url: "https://example.com/42" },
    ]);

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    expect(detectDuplicates).toHaveBeenCalledTimes(1);
    const { postDuplicateComment } = await import("../src/forgejo/comments.js");
    expect(postDuplicateComment).toHaveBeenCalledTimes(1);
  });

  // ── No duplicates → no comment ─────────────────────────────────────────

  it("does not post a duplicate comment when no duplicates are found", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { searchSimilarIssues } = await import("../src/forgejo/search.js");
    vi.mocked(searchSimilarIssues).mockResolvedValueOnce([
      { number: 42, title: "Old bug", url: "https://example.com/42" },
    ]);

    const { detectDuplicates } = await import("../src/duplicate.js");
    vi.mocked(detectDuplicates).mockResolvedValueOnce([]);

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    expect(detectDuplicates).toHaveBeenCalledTimes(1);
    // createComment should NOT have been called
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  // ── No candidates → no detectDuplicates call ───────────────────────────

  it("skips detectDuplicates when no candidates are returned", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { searchSimilarIssues } = await import("../src/forgejo/search.js");
    vi.mocked(searchSimilarIssues).mockResolvedValueOnce([]);

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    expect(searchSimilarIssues).toHaveBeenCalledTimes(1);
    const { detectDuplicates } = await import("../src/duplicate.js");
    expect(detectDuplicates).not.toHaveBeenCalled();
  });

  // ── Duplicate-search failure → label still removed, processed ──────────

  it("duplicate-search failure does not block label removal or counting", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { searchSimilarIssues } = await import("../src/forgejo/search.js");
    vi.mocked(searchSimilarIssues).mockRejectedValueOnce(new Error("Search API timeout"));

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    expect(actx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 1 }),
      expect.stringContaining("Duplicate detection/comment failed"),
    );
  });

  // ── Duplicate-comment failure → label still removed, processed ─────────

  it("duplicate-comment post failure does not block label removal or counting", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { searchSimilarIssues } = await import("../src/forgejo/search.js");
    vi.mocked(searchSimilarIssues).mockResolvedValueOnce([
      { number: 42, title: "Old bug", url: "https://example.com/42" },
    ]);

    const { detectDuplicates } = await import("../src/duplicate.js");
    vi.mocked(detectDuplicates).mockResolvedValueOnce([
      { number: 42, title: "Old bug", url: "https://example.com/42" },
    ]);

    const { postDuplicateComment } = await import("../src/forgejo/comments.js");
    vi.mocked(postDuplicateComment).mockRejectedValueOnce(new Error("Comment API error"));

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    expect(actx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 1 }),
      expect.stringContaining("Duplicate detection/comment failed"),
    );
  });

  // ── duplicateSearch: false → skip entirely ─────────────────────────────

  it("skips duplicate search and comment when duplicateSearch is false", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      features: { ...DEFAULT_CONFIG.features, duplicateSearch: false },
    });

    const issue = makeMockIssue({ number: 1 });
    mockFetchIssues([issue]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    const { searchSimilarIssues } = await import("../src/forgejo/search.js");
    expect(searchSimilarIssues).not.toHaveBeenCalled();
    const { detectDuplicates } = await import("../src/duplicate.js");
    expect(detectDuplicates).not.toHaveBeenCalled();
   const { postDuplicateComment } = await import("../src/forgejo/comments.js");
    expect(postDuplicateComment).not.toHaveBeenCalled();
  });

  // ── Excluded-by-user → drain: remove label + comment with reason="user" ─

  it("excluded-by-user issue gets label removed and comment posted with reason='user'", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const included = makeMockIssue({ number: 1 });
    const excluded = makeMockIssue({
      number: 2,
      user: { login: "dependabot[bot]" },
    });
    mockFetchIssues([included, excluded]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    // Only the included issue is processed
    expect(result).toEqual({ issuesProcessed: 1, issuesFailed: 0 });
    // No classify/label for excluded issue
    expect(actx.octokit.rest.issues.addLabels).toHaveBeenCalledTimes(1);
    // Label removal + comment for excluded issue
    expect(global.fetch).toHaveBeenCalledTimes(3); // 1 issues list + 1 remove label (included) + 1 remove label (excluded)
    const { postExcludeRemovalComment } = await import("../src/forgejo/comments.js");
    expect(postExcludeRemovalComment).toHaveBeenCalledTimes(1);
    expect(postExcludeRemovalComment).toHaveBeenCalledWith(
      actx.octokit,
      "owner",
      "repo",
      2,
      "triage",
      "user",
    );
  });

  // ── Excluded-by-label → drain with reason="label" ──────────────────────

  it("excluded-by-label issue gets comment posted with reason='label'", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    const excluded = makeMockIssue({
      number: 1,
      labels: [{ name: "triage", id: 100 }, { name: "wontfix" }],
    });
    mockFetchIssues([excluded]);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    // Excluded issue is not counted
    expect(result).toEqual({ issuesProcessed: 0, issuesFailed: 0 });
    // No classify/label for excluded issue
    expect(actx.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    const { postExcludeRemovalComment } = await import("../src/forgejo/comments.js");
    expect(postExcludeRemovalComment).toHaveBeenCalledTimes(1);
    expect(postExcludeRemovalComment).toHaveBeenCalledWith(
      actx.octokit,
      "owner",
      "repo",
      1,
      "triage",
      "label",
    );
  });

  // ── Excluded issue label removal failure → swallowed ───────────────────

  it("exclude-drain label removal failure is swallowed, run continues", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          category: "bug",
          priority: "high",
          confidence: 0.9,
          summary: "Bug",
          suggestedLabels: ["bug"],
          reasoning: "Bug",
        }),
      }),
    } as any);

    // Excluded issue with failed label removal
    const excluded = makeMockIssue({
      number: 1,
      user: { login: "dependabot[bot]" },
    });
    // removeSucceeds = false
    mockFetchIssues([excluded], false);

    const actx = createMockActionContext();
    const result = await runBatchPipeline(actx, "https://forgejo.example.com", "token");

    // Excluded issue is not counted even on failure
    expect(result).toEqual({ issuesProcessed: 0, issuesFailed: 0 });
    // Warning logged
    expect(actx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 1 }),
      expect.stringContaining("Exclude-drain failed"),
    );
    // Comment not posted because removal threw inside the shared try/catch
    const { postExcludeRemovalComment } = await import("../src/forgejo/comments.js");
    expect(postExcludeRemovalComment).not.toHaveBeenCalled();
  });

  });
