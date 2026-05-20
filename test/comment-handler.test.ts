import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleComment } from "../src/comment-handler.js";
import type { Context } from "probot";

vi.mock("../src/llm/factory.js", () => ({
  createProvider: vi.fn().mockImplementation(() => ({
    complete: vi.fn().mockResolvedValue({
      text: "Thanks for the additional details! This helps us investigate.\n\n-- Issue AI Agent :robot:",
      usage: { inputTokens: 100, outputTokens: 30 },
    }),
  })),
  detectProvider: vi.fn().mockReturnValue("anthropic"),
}));

function createMockCommentContext(overrides: Record<string, unknown> = {}): Context<"issue_comment.created"> {
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
        createComment: vi.fn().mockResolvedValue({}),
      },
    },
  };

  const context = {
    payload: {
      action: "created",
      issue: {
        number: 5,
        title: "App crashes on save",
        body: "Steps to reproduce:\n1. Open app\n2. Click save\n3. Crash",
        html_url: "https://github.com/owner/repo/issues/5",
        user: { login: "issue-author" },
        labels: [{ name: "bug", id: 1 }],
        created_at: "2026-05-18T00:00:00Z",
        state: "open",
      },
      comment: {
        id: 100,
        body: "I'm using Chrome 120 on macOS.",
        html_url: "https://github.com/owner/repo/issues/5#issuecomment-100",
        user: { login: "commenter" },
        created_at: "2026-05-19T00:00:00Z",
      },
      repository: {
        name: "repo",
        owner: { login: "owner" },
        default_branch: "main",
      },
      installation: { id: 2 },
      sender: { login: "commenter" },
    },
    repo: vi.fn(() => ({ owner: "owner", repo: "repo" })),
    issue: vi.fn((data) => ({ owner: "owner", repo: "repo", issue_number: 5, ...data })),
    log: mockLog,
    octokit: mockOctokit,
    config: vi.fn().mockResolvedValue(null),
    isBot: false,
    ...overrides,
  } as unknown as Context<"issue_comment.created">;

  return context;
}

describe("handleComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    delete process.env.OPENAI_API_KEY;
  });

  it("skips bot comments", async () => {
    const context = createMockCommentContext({ isBot: true });
    await handleComment(context);
    expect(context.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips comments on pull requests", async () => {
    const context = createMockCommentContext();
    (context.payload as Record<string, unknown>).issue = {
      ...context.payload.issue,
      pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/5" },
    };
    await handleComment(context);
    expect(context.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips when commentReply is disabled", async () => {
    const context = createMockCommentContext({
      config: vi.fn().mockResolvedValue({ features: { commentReply: false } }),
    });
    await handleComment(context);
    expect(context.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips excluded users", async () => {
    const context = createMockCommentContext({
      config: vi.fn().mockResolvedValue({
        exclude: { users: ["commenter"] },
      }),
    });
    await handleComment(context);
    expect(context.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("posts a reply for a valid comment", async () => {
    const context = createMockCommentContext();

    await handleComment(context);

    expect(context.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    const call = context.octokit.rest.issues.createComment.mock.calls[0][0] as { body: string };
    expect(call.body).toContain("Issue AI Agent");
  });

  it("truncates long LLM responses", async () => {
    const { createProvider } = await import("../src/llm/factory.js");
    vi.mocked(createProvider).mockReturnValueOnce({
      complete: vi.fn().mockResolvedValue({
        text: "x".repeat(5000) + "\n\n-- Issue AI Agent :robot:",
        usage: { inputTokens: 100, outputTokens: 100 },
      }),
    } as any);

    const context = createMockCommentContext();
    await handleComment(context);

    const call = context.octokit.rest.issues.createComment.mock.calls[0][0] as { body: string };
    expect(call.body.length).toBeLessThanOrEqual(4050);
    expect(call.body).toContain("truncated");
  });
});
