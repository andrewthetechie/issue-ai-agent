import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { ActionContext } from "../src/types.js";
import { createProvider } from "../src/llm/factory.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

// Mock LLM factory to avoid real API calls
vi.mock("../src/llm/factory.js", () => ({
  createProvider: vi.fn().mockImplementation(() => ({
    complete: vi.fn().mockImplementation((_model, _sysPrompt, messages) => {
      const userMsg = messages[0]?.content ?? "";
      if (userMsg.includes("=== ISSUE DATA BEGIN")) {
        return Promise.resolve({
          text: JSON.stringify({
            category: "bug",
            priority: "high",
            confidence: 0.9,
            summary: "App crashes on save",
            suggestedLabels: ["bug"],
            reasoning: "Clear crash report",
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        });
      }
      if (userMsg.includes("Candidate issues")) {
        return Promise.resolve({
          text: JSON.stringify({
            duplicates: [],
            reasoning: "No duplicates found among candidates.",
          }),
          usage: { inputTokens: 80, outputTokens: 20 },
        });
      }
      // Reply call
      return Promise.resolve({
        text: "Thanks for reporting this crash! We'll look into it.\n\n-- Issue AI Agent :robot:",
        usage: { inputTokens: 100, outputTokens: 30 },
      });
    }),
  })),
}));

// Mock GitHub search API
vi.mock("../src/forgejo/search.js", () => ({
  searchSimilarIssues: vi.fn().mockResolvedValue([]),
}));

// Mock labels module to spy on ensureLabelsExist while keeping real resolveLabels/applyLabels
vi.mock("../src/forgejo/labels.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/forgejo/labels.js")>();
  return {
    ...actual,
    ensureLabelsExist: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock config loader — inline default config to avoid hoisting issues
vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    enabled: true,
    createLabels: false,
    features: { classify: true, reply: true, duplicateSearch: true, commentReply: true },
    labelMapping: {
      bug: ["bug"], feature: ["enhancement"], question: ["question"],
      docs: ["documentation"], duplicate: ["duplicate"], invalid: ["invalid"], security: ["security"],
    },
    priorityLabelMapping: {
      critical: ["priority: critical"],
      high: ["priority: high"],
      medium: ["priority: medium"],
      low: ["priority: low"],
    },
    security: { maxIssueLength: 10000 },
    exclude: { labels: ["wontfix", "skip-ai"], users: ["dependabot[bot]"] },
    llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", maxTokens: 2048 },
  }),
}));

function createMockActionContext(overrides: Record<string, unknown> = {}): ActionContext {
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
      search: {
        issuesAndPullRequests: vi.fn().mockResolvedValue({
          data: { items: [] },
        }),
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
        title: "App crashes when clicking save",
        body: "Steps to reproduce:\n1. Open app\n2. Click save\n3. Crash",
        html_url: "https://github.com/owner/repo/issues/1",
        user: { login: "testuser", type: "User" },
        labels: [],
        created_at: "2026-05-18T00:00:00Z",
      },
      sender: { login: "testuser", type: "User" },
      repository: {
        name: "repo",
        owner: { login: "owner" },
        default_branch: "main",
      },
    },
    ...overrides,
  } as unknown as ActionContext;
}

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    delete process.env.OPENAI_API_KEY;
  });

  it("skips when bot is disabled", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({ ...DEFAULT_CONFIG, enabled: false });

    const actx = createMockActionContext();
    const result = await runPipeline(actx);
    expect(result.classification).toBeNull();
    expect(result.labelsApplied).toEqual([]);
    expect(result.replyPosted).toBe(false);
  });

  it("skips excluded users", async () => {
    const actx = createMockActionContext({
      payload: {
        ...createMockActionContext().payload,
        issue: {
          ...createMockActionContext().payload.issue,
          user: { login: "dependabot[bot]", type: "Bot" },
        },
      },
    });

    const result = await runPipeline(actx);
    expect(result.classification).toBeNull();
  });

  it("skips issues with excluded labels", async () => {
    const actx = createMockActionContext({
      payload: {
        ...createMockActionContext().payload,
        issue: {
          ...createMockActionContext().payload.issue,
          labels: [{ name: "skip-ai", id: 1 }],
        },
      },
    });

    const result = await runPipeline(actx);
    expect(result.classification).toBeNull();
  });

  it("runs in dev mode when no LLM API key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.mocked(createProvider).mockReturnValueOnce(null as any);
    const actx = createMockActionContext();

    const result = await runPipeline(actx);
    expect(result.classification).not.toBeNull();
    expect(result.classification?.category).toBe("bug");
    expect(result.classification?.summary).toContain("[DEV MODE]");
    expect(result.replyPosted).toBe(true);
  });

  it("loads config and runs full pipeline with defaults", async () => {
    const actx = createMockActionContext();

    const result = await runPipeline(actx);
    expect(result.classification).not.toBeNull();
    expect(result.classification?.category).toBe("bug");
    expect(result.labelsApplied.length).toBeGreaterThan(0);
    expect(result.replyPosted).toBe(true);
  });

  it("sets relatedIssues when duplicates are found", async () => {
    const { searchSimilarIssues } = await import("../src/forgejo/search.js");
    vi.mocked(searchSimilarIssues).mockResolvedValueOnce([
      { number: 42, title: "Same crash", url: "https://github.com/owner/repo/issues/42" },
    ]);

    const mockProvider = {
      complete: vi.fn()
        .mockResolvedValueOnce({
          text: JSON.stringify({
            category: "duplicate",
            priority: "medium",
            confidence: 0.85,
            summary: "Duplicate of #42",
            suggestedLabels: ["duplicate"],
            reasoning: "Same crash as #42",
          }),
          usage: { inputTokens: 100, outputTokens: 50 },
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            duplicates: [42],
            reasoning: "Same crash report",
          }),
          usage: { inputTokens: 80, outputTokens: 20 },
        })
        .mockResolvedValueOnce({
          text: "This appears to be a duplicate of #42.\n\n-- Issue AI Agent :robot:",
          usage: { inputTokens: 100, outputTokens: 30 },
        }),
    };
    vi.mocked(createProvider).mockReturnValueOnce(mockProvider as any);

    const actx = createMockActionContext();

    const result = await runPipeline(actx);
    expect(result.classification?.category).toBe("duplicate");
    expect(result.classification?.relatedIssues).toEqual([
      { number: 42, title: "Same crash", url: "https://github.com/owner/repo/issues/42" },
    ]);
    expect(result.replyPosted).toBe(true);
  });

  describe("createLabels", () => {
    it("does not call ensureLabelsExist when createLabels is false", async () => {
      const { ensureLabelsExist } = await import("../src/forgejo/labels.js");
      vi.mocked(ensureLabelsExist).mockResolvedValueOnce(undefined);

      const { loadConfig } = await import("../src/config/loader.js");
      vi.mocked(loadConfig).mockResolvedValueOnce({ ...DEFAULT_CONFIG, createLabels: false });

      const actx = createMockActionContext();
      await runPipeline(actx);

      expect(ensureLabelsExist).not.toHaveBeenCalled();
    });

    it("calls ensureLabelsExist when createLabels is true, before classify", async () => {
      const { ensureLabelsExist } = await import("../src/forgejo/labels.js");
      vi.mocked(ensureLabelsExist).mockResolvedValueOnce(undefined);

      const { loadConfig } = await import("../src/config/loader.js");
      vi.mocked(loadConfig).mockResolvedValueOnce({ ...DEFAULT_CONFIG, createLabels: true });

      const actx = createMockActionContext();
      const result = await runPipeline(actx);

      expect(ensureLabelsExist).toHaveBeenCalledTimes(1);
      expect(ensureLabelsExist).toHaveBeenCalledWith(
        "owner", "repo", expect.objectContaining({ createLabels: true }),
        expect.anything(), expect.anything(),
      );
      // Classification and reply still run
      expect(result.classification).not.toBeNull();
      expect(result.replyPosted).toBe(true);
    });

    it("records createLabels error but continues classify and reply when ensureLabelsExist throws", async () => {
      const { ensureLabelsExist } = await import("../src/forgejo/labels.js");
      vi.mocked(ensureLabelsExist).mockReset();
      vi.mocked(ensureLabelsExist).mockRejectedValue(new Error("list call failed"));

      const { loadConfig } = await import("../src/config/loader.js");
      vi.mocked(loadConfig).mockResolvedValueOnce({ ...DEFAULT_CONFIG, createLabels: true });

      const actx = createMockActionContext();
      const result = await runPipeline(actx);

      expect(ensureLabelsExist).toHaveBeenCalledTimes(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ step: "createLabels", message: "Label creation failed" }),
        ]),
      );
      // Classification and reply still run despite creation error
      expect(result.classification).not.toBeNull();
      expect(result.replyPosted).toBe(true);
    });

    it("does not call ensureLabelsExist when issue is excluded", async () => {
      const { ensureLabelsExist } = await import("../src/forgejo/labels.js");
      vi.mocked(ensureLabelsExist).mockResolvedValueOnce(undefined);

      const { loadConfig } = await import("../src/config/loader.js");
      vi.mocked(loadConfig).mockResolvedValueOnce({ ...DEFAULT_CONFIG, createLabels: true });

      const actx = createMockActionContext({
        payload: {
          ...createMockActionContext().payload,
          issue: {
            ...createMockActionContext().payload.issue,
            labels: [{ name: "skip-ai", id: 1 }],
          },
        },
      });

      const result = await runPipeline(actx);
      expect(ensureLabelsExist).not.toHaveBeenCalled();
      expect(result.classification).toBeNull();
    });

    it("does not call ensureLabelsExist when repo is disabled", async () => {
      const { ensureLabelsExist } = await import("../src/forgejo/labels.js");
      vi.mocked(ensureLabelsExist).mockResolvedValueOnce(undefined);

      const { loadConfig } = await import("../src/config/loader.js");
      vi.mocked(loadConfig).mockResolvedValueOnce({ ...DEFAULT_CONFIG, enabled: false, createLabels: true });

      const actx = createMockActionContext();
      const result = await runPipeline(actx);
      expect(ensureLabelsExist).not.toHaveBeenCalled();
      expect(result.classification).toBeNull();
    });
  });
});
