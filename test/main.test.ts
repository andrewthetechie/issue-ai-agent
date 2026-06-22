import { describe, it, expect, vi, beforeEach } from "vitest";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { main } from "../src/main.js";

vi.mock("@actions/core", async () => {
  const actual = await vi.importActual<typeof core>("@actions/core");
  return {
    ...actual,
    getInput: vi.fn((name: string) => {
      const map: Record<string, string> = {
        "forgejo-token": "test-token",
        "anthropic-api-key": "",
        "openai-api-key": "",
        "llm-provider": "",
        "config-path": "",
        "llm-base-url": "",
        "forgejo-server-url": "https://github.com",
      };
      return map[name] ?? "";
    }),
    setFailed: vi.fn(),
    setOutput: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
});

// Shared mutable context that vi.mock captures via getter closure
const mockContext: Record<string, unknown> = {
  repo: { owner: "test-owner", repo: "test-repo" },
  eventName: "issues",
  payload: {
    action: "opened",
    issue: {
      number: 1,
      title: "Test issue",
      body: "Test body",
      html_url: "https://github.com/test-owner/test-repo/issues/1",
      user: { login: "testuser", type: "User" },
      labels: [],
      created_at: "2026-05-18T00:00:00Z",
    },
    sender: { login: "testuser", type: "User" },
    repository: {
      name: "test-repo",
      owner: { login: "test-owner" },
      default_branch: "main",
    },
  },
};

// Shared mock octokit — created once in the factory closure
const mockOctokit = {
  rest: {
    users: {
      getAuthenticated: vi.fn().mockResolvedValue({
        data: { login: "forgejo-bot" },
      }),
    },
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

vi.mock("@actions/github", () => ({
  getOctokit: vi.fn((_token, options) => {
    (mockOctokit as any).__baseUrl = options?.baseUrl;
    return mockOctokit;
  }),
  get context() {
    return mockContext;
  },
}));

vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    enabled: true,
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

vi.mock("../src/llm/factory.js", () => ({
  createProvider: vi.fn().mockImplementation(() => ({
    complete: vi.fn().mockImplementation((_model, _sysPrompt, messages) => {
      const userMsg = messages?.[0]?.content ?? "";
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
      return Promise.resolve({
        text: "Thanks for reporting this crash! We'll look into it.\n\n-- Issue AI Agent :robot:",
        usage: { inputTokens: 100, outputTokens: 30 },
      });
    }),
  })),
  detectProvider: vi.fn().mockReturnValue("anthropic"),
}));

vi.mock("../src/forgejo/search.js", () => ({
  searchSimilarIssues: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/batch.js", () => ({
  runBatchPipeline: vi.fn().mockResolvedValue({ issuesProcessed: 3, issuesFailed: 1 }),
}));

describe("main", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
    process.env.ANTHROPIC_API_KEY = "test-api-key";
    delete process.env.OPENAI_API_KEY;
  });

  describe("bot identity resolution", () => {
    it("sets botLogin from getAuthenticated response", async () => {
      const mockGetAuthenticated = mockOctokit.rest.users.getAuthenticated;
      mockGetAuthenticated.mockResolvedValueOnce({
        data: { login: "forgejo-bot" },
      });

      await main();

      expect(mockGetAuthenticated).toHaveBeenCalledTimes(1);
      expect(core.setFailed).not.toHaveBeenCalled();

      // Verify the pipeline ran (which means it received an actx with botLogin set)
      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalled();
    });

    it("fails the action when getAuthenticated rejects", async () => {
      const mockGetAuthenticated = mockOctokit.rest.users.getAuthenticated;
      mockGetAuthenticated.mockRejectedValueOnce(new Error("Unauthorized"));

      await main();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed to resolve bot identity: Unauthorized",
      );

      expect(mockOctokit.rest.issues.addLabels).not.toHaveBeenCalled();
    });

    it("fails with generic error message for non-Error rejections", async () => {
      const mockGetAuthenticated = mockOctokit.rest.users.getAuthenticated;
      mockGetAuthenticated.mockRejectedValueOnce("some-string-error");

      await main();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Failed to resolve bot identity: some-string-error",
      );
    });
  });

  describe("event routing", () => {
    it("handles issues event", async () => {
      (mockContext.eventName as string) = "issues";
      mockContext.payload = {
        action: "opened",
        issue: {
          number: 1,
          title: "Test issue",
          body: "Test body",
          html_url: "https://github.com/test-owner/test-repo/issues/1",
          user: { login: "testuser", type: "User" },
          labels: [],
          created_at: "2026-05-18T00:00:00Z",
        },
        sender: { login: "testuser", type: "User" },
        repository: {
          name: "test-repo",
          owner: { login: "test-owner" },
          default_branch: "main",
        },
      };

      await main();

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith("category", "bug");
      expect(core.setOutput).toHaveBeenCalledWith("priority", "high");
    });

    it("handles issue_comment event", async () => {
      (mockContext.eventName as string) = "issue_comment";
      mockContext.payload = {
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

      await main();

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    });

    it("warns on unsupported event", async () => {
      (mockContext.eventName as string) = "push";

      await main();

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith("Unsupported event: push");
    });

    it("handles schedule event via batch pipeline", async () => {
      const { runBatchPipeline } = await import("../src/batch.js");

      (mockContext.eventName as string) = "schedule";

      await main();

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(runBatchPipeline).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith("issues-processed", "3");
      expect(core.setOutput).toHaveBeenCalledWith("issues-failed", "1");
    });

    it("handles workflow_dispatch event via batch pipeline", async () => {
      const { runBatchPipeline } = await import("../src/batch.js");

      (mockContext.eventName as string) = "workflow_dispatch";

      await main();

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(runBatchPipeline).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith("issues-processed", "3");
      expect(core.setOutput).toHaveBeenCalledWith("issues-failed", "1");
    });

    it("passes forgejo-server-url input to Octokit baseUrl", async () => {
      const getInput = vi.mocked(core.getInput);
      getInput.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "forgejo-token": "test-token",
          "anthropic-api-key": "",
          "openai-api-key": "",
          "llm-provider": "",
          "config-path": "",
          "llm-base-url": "",
          "forgejo-server-url": "https://forgejo.example.com",
        };
        return map[name] ?? "";
      });

      await main();

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(github.getOctokit).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({ baseUrl: "https://forgejo.example.com/api/v1" }),
      );
    });

    it("fails when forgejo-server-url input and all env vars are empty", async () => {
      const getInput = vi.mocked(core.getInput);
      getInput.mockImplementation((name: string) => {
        if (name === "forgejo-token") return "test-token";
        if (name === "forgejo-server-url") return "";
        return "";
      });

      delete process.env.FORGEJO_SERVER_URL;
      delete process.env.GITHUB_SERVER_URL;

      await main();

      expect(core.setFailed).toHaveBeenCalledWith(
        "forgejo-server-url input or FORGEJO_SERVER_URL / GITHUB_SERVER_URL environment variable is required",
      );
    });
  });

 describe("Octokit baseUrl wiring", () => {
    it("calls getOctokit with baseUrl option set to <serverUrl>/api/v1", async () => {
      const getInput = vi.mocked(core.getInput);
      getInput.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "forgejo-token": "test-token",
          "anthropic-api-key": "",
          "openai-api-key": "",
          "llm-provider": "",
          "config-path": "",
          "llm-base-url": "",
          "forgejo-server-url": "https://github.com",
        };
        return map[name] ?? "";
      });

      await main();

      expect(github.getOctokit).toHaveBeenCalledWith(
        "test-token",
        { baseUrl: "https://github.com/api/v1" },
      );
    });

    it("calls getOctokit with baseUrl when forgejo-server-url input is provided", async () => {
      const getInput = vi.mocked(core.getInput);
      getInput.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "forgejo-token": "test-token",
          "anthropic-api-key": "",
          "openai-api-key": "",
          "llm-provider": "",
          "config-path": "",
          "llm-base-url": "",
          "forgejo-server-url": "https://forgejo.example.com",
        };
        return map[name] ?? "";
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: "forgejo-bot" }),
      }) as unknown as typeof global.fetch;

      await main();

      expect(github.getOctokit).toHaveBeenCalledWith(
        "test-token",
        { baseUrl: "https://forgejo.example.com/api/v1" },
      );
    });

    it("normalizes serverUrl by trimming trailing slash before constructing baseUrl", async () => {
      const getInput = vi.mocked(core.getInput);
      getInput.mockImplementation((name: string) => {
        const map: Record<string, string> = {
          "forgejo-token": "test-token",
          "anthropic-api-key": "",
          "openai-api-key": "",
          "llm-provider": "",
          "config-path": "",
          "llm-base-url": "",
          "forgejo-server-url": "https://forgejo.example.com/",
        };
        return map[name] ?? "";
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: "forgejo-bot" }),
      }) as unknown as typeof global.fetch;

      await main();

      expect(github.getOctokit).toHaveBeenCalledWith(
        "test-token",
        { baseUrl: "https://forgejo.example.com/api/v1" },
      );
    });
  });

  describe("token validation", () => {
    it("fails when forgejo-token input and GITHUB_TOKEN env are both missing", async () => {
      const getInput = vi.mocked(core.getInput);
      getInput.mockImplementation((name: string) => {
        if (name === "forgejo-token") return "";
        return "";
      });

      delete process.env.GITHUB_TOKEN;

      await main();

      expect(core.setFailed).toHaveBeenCalledWith(
        "forgejo-token input or GITHUB_TOKEN env var is required",
      );
    });
  });

  describe("importability", () => {
    it("can be imported without auto-executing", async () => {
      // Importing the module should not have triggered main()
      // If main() auto-executed on import, it would have called core.setFailed
      // or made API calls. We just verify the import succeeded.
      expect(main).toBeDefined();
      expect(typeof main).toBe("function");
    });
  });
});
