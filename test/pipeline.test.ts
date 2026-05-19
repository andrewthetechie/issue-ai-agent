import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { Context } from "probot";

// Mock LLMClient to avoid real API calls
vi.mock("../src/llm/client.js", () => ({
  LLMClient: vi.fn().mockImplementation(() => {
    let callCount = 0;
    return {
      complete: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: classification
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
        // Subsequent calls: reply
        return Promise.resolve({
          text: "Thanks for reporting this crash! We'll look into it.\n\n-- Issue AI Agent :robot:",
          usage: { inputTokens: 100, outputTokens: 30 },
        });
      }),
    };
  }),
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

  it("runs in dev mode when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
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
});
