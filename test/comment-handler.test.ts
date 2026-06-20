import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleComment } from "../src/comment-handler.js";
import type { ActionContext } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

vi.mock("../src/llm/factory.js", () => ({
  createProvider: vi.fn().mockImplementation(() => ({
    complete: vi.fn().mockResolvedValue({
      text: "Thanks for the additional details! This helps us investigate.\n\n-- Issue AI Agent :robot:",
      usage: { inputTokens: 100, outputTokens: 30 },
    }),
  })),
  detectProvider: vi.fn().mockReturnValue("anthropic"),
}));

vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    enabled: true,
    features: { classify: true, reply: true, duplicateSearch: true, commentReply: true },
    labelMapping: {
      bug: ["bug"], feature: ["enhancement"], question: ["question"],
      docs: ["documentation"], duplicate: ["duplicate"], invalid: ["invalid"], security: ["security"],
    },
    security: { maxIssueLength: 10000 },
    exclude: { labels: ["wontfix", "skip-ai"], users: ["dependabot[bot]"] },
    llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", maxTokens: 2048 },
  }),
}));

const basePayload = {
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
  sender: { login: "commenter", type: "User" },
};

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
        createComment: vi.fn().mockResolvedValue({}),
      },
    },
  };

  return {
    owner: "owner",
    repo: "repo",
    botLogin: "issue-ai-bot",
    octokit: mockOctokit,
    logger: mockLog,
    eventName: "issue_comment",
    payload: { ...basePayload },
    ...overrides,
  } as unknown as ActionContext;
}

describe("handleComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    delete process.env.OPENAI_API_KEY;
  });

  it("skips comments from botLogin (own-comment case)", async () => {
    const actx = createMockActionContext({
      botLogin: "issue-ai-bot",
      payload: {
        ...basePayload,
        sender: { login: "issue-ai-bot" },
      },
    });
    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("skips comments from users in config.exclude.users", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      exclude: { ...DEFAULT_CONFIG.exclude, users: ["commenter"] },
    });

    const actx = createMockActionContext({
      botLogin: "issue-ai-bot",
      payload: {
        ...basePayload,
        sender: { login: "commenter" },
      },
    });
    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("posts a reply when sender is neither botLogin nor excluded", async () => {
    const actx = createMockActionContext({
      botLogin: "issue-ai-bot",
      payload: {
        ...basePayload,
        sender: { login: "commenter" },
      },
    });

    await handleComment(actx);

    expect(actx.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    const call = actx.octokit.rest.issues.createComment.mock.calls[0][0] as { body: string };
    expect(call.body).toContain("Issue AI Agent");
  });

  it("skips comments on pull requests", async () => {
    const actx = createMockActionContext({
      payload: {
        ...basePayload,
        issue: {
          ...basePayload.issue,
          pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/5" },
        },
      },
    });
    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("does NOT call loadConfig for comments on pull requests", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    const actx = createMockActionContext({
      payload: {
        ...basePayload,
        issue: {
          ...basePayload.issue,
          pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/5" },
        },
      },
    });
    await handleComment(actx);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("does NOT call loadConfig when there is no comment payload", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    const actx = createMockActionContext({
      payload: {
        ...basePayload,
        comment: undefined,
      },
    });
    await handleComment(actx);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("skips when commentReply is disabled", async () => {
    const { loadConfig } = await import("../src/config/loader.js");
    vi.mocked(loadConfig).mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      features: { ...DEFAULT_CONFIG.features, commentReply: false },
    });

    const actx = createMockActionContext();
    await handleComment(actx);
    expect(actx.octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("posts a reply for a valid comment", async () => {
    const actx = createMockActionContext();

    await handleComment(actx);

    expect(actx.octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    const call = actx.octokit.rest.issues.createComment.mock.calls[0][0] as { body: string };
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

    const actx = createMockActionContext();
    await handleComment(actx);

    const call = actx.octokit.rest.issues.createComment.mock.calls[0][0] as { body: string };
    expect(call.body.length).toBeLessThanOrEqual(4050);
    expect(call.body).toContain("truncated");
  });
});
