import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { Context } from "probot";
import { createProvider } from "../src/llm/factory.js";

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
vi.mock("../src/github/search.js", () => ({
  searchSimilarIssues: vi.fn().mockResolvedValue([]),
}));

function createMockContext(overrides: Record<string, unknown> = {}): Context<"issues.opened"> {
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
    },
  };

  const context = {
    payload: {
      action: "opened",
      issue: {
        number: 1,
        title: "App crashes when clicking save",
        body: "Steps to reproduce:\n1. Open app\n2. Click save\n3. Crash",
        html_url: "https://github.com/owner/repo/issues/1",
        user: { login: "testuser" },
        labels: [],
        created_at: "2026-05-18T00:00:00Z",
      },
      repository: {
        name: "repo",
        owner: { login: "owner" },
        default_branch: "main",
        clone_url: "https://github.com/owner/repo.git",
      },
      installation: { id: 2 },
      sender: { login: "testuser" },
    },
    repo: vi.fn(() => ({ owner: "owner", repo: "repo" })),
    issue: vi.fn((data) => ({ owner: "owner", repo: "repo", ...data })),
    log: mockLog,
    octokit: mockOctokit,
    config: vi.fn().mockResolvedValue(null),
    isBot: false,
    ...overrides,
  } as unknown as Context<"issues.opened">;

  return context;
}

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    delete process.env.OPENAI_API_KEY;
  });

  it("skips when bot is disabled", async () => {
    const context = createMockContext({
      config: vi.fn().mockResolvedValue({ enabled: false }),
    });

    const result = await runPipeline(context);
    expect(result.classification).toBeNull();
    expect(result.labelsApplied).toEqual([]);
    expect(result.replyPosted).toBe(false);
  });

  it("skips excluded users", async () => {
    const context = createMockContext();
    (context.payload as Record<string, unknown>).issue = {
      ...context.payload.issue,
      user: { login: "dependabot[bot]" },
    };

    const result = await runPipeline(context);
    expect(result.classification).toBeNull();
  });

  it("skips issues with excluded labels", async () => {
    const context = createMockContext();
    (context.payload as Record<string, unknown>).issue = {
      ...context.payload.issue,
      labels: [{ name: "skip-ai", id: 1 }],
    };

    const result = await runPipeline(context);
    expect(result.classification).toBeNull();
  });

  it("runs in dev mode when no LLM API key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.mocked(createProvider).mockReturnValueOnce(null as any);
    const context = createMockContext();

    const result = await runPipeline(context);
    // Dev mode uses mock classification instead of erroring
    expect(result.classification).not.toBeNull();
    expect(result.classification?.category).toBe("bug");
    expect(result.classification?.summary).toContain("[DEV MODE]");
    expect(result.replyPosted).toBe(true);
  });

  it("loads config and runs full pipeline with defaults", async () => {
    const context = createMockContext({
      config: vi.fn().mockResolvedValue(null),
    });

    const result = await runPipeline(context);
    expect(context.config).toHaveBeenCalledWith("issue-ai.yml");
    expect(result.classification).not.toBeNull();
    expect(result.classification?.category).toBe("bug");
    expect(result.labelsApplied.length).toBeGreaterThan(0);
    expect(result.replyPosted).toBe(true);
  });

  it("sets relatedIssues when duplicates are found", async () => {
    const { searchSimilarIssues } = await import("../src/github/search.js");
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

    const context = createMockContext();

    const result = await runPipeline(context);
    expect(result.classification?.category).toBe("duplicate");
    expect(result.classification?.relatedIssues).toEqual([
      { number: 42, title: "Same crash", url: "https://github.com/owner/repo/issues/42" },
    ]);
    expect(result.replyPosted).toBe(true);
  });
});
