import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
import { loadConfig } from "../src/config/loader.js";
import type { Logger } from "../src/types.js";

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

describe("loadConfig with priority_label_mapping", () => {
  let mockOctokit: any;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => mockLogger,
    };
    mockOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(),
        },
      },
    };
  });

  it("returns priorityLabelMapping from priority_label_mapping in YAML", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          [
            "enabled: true",
            "priority_label_mapping:",
            '  critical: ["P0"]',
            '  high: ["P1"]',
            '  medium: ["P2"]',
            '  low: ["P3"]',
          ].join("\n"),
        ).toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(config.priorityLabelMapping).toEqual({
      critical: ["P0"],
      high: ["P1"],
      medium: ["P2"],
      low: ["P3"],
    });
  });

  it("returns DEFAULT_CONFIG.priorityLabelMapping when priority_label_mapping absent", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from("enabled: true\n").toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(config.priorityLabelMapping).toEqual(DEFAULT_CONFIG.priorityLabelMapping);
  });

  it("partial priority_label_mapping returns only provided keys", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          [
            "enabled: true",
            "priority_label_mapping:",
            '  critical: ["P0"]',
            '  high: ["P1"]',
          ].join("\n"),
        ).toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(config.priorityLabelMapping).toEqual({
      critical: ["P0"],
      high: ["P1"],
    });
    expect(config.priorityLabelMapping.medium).toBeUndefined();
    expect(config.priorityLabelMapping.low).toBeUndefined();
  });

  it("empty priority_label_mapping returns empty record", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          [
            "enabled: true",
            "priority_label_mapping: {}",
          ].join("\n"),
        ).toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(config.priorityLabelMapping).toEqual({});
  });

  it("unknown priority_label_mapping key triggers logger.warn", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          [
            "enabled: true",
            "priority_label_mapping:",
            '  critical: ["P0"]',
            '  urgent: ["urgent"]',
          ].join("\n"),
        ).toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { key: "urgent" },
      "Unknown priority_label_mapping key ignored",
    );
    expect(config.priorityLabelMapping).toEqual({
      critical: ["P0"],
      urgent: ["urgent"],
    });
  });

  it("unknown label_mapping key triggers logger.warn", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          [
            "enabled: true",
            "label_mapping:",
            '  bug: ["bug"]',
            '  chore: ["chore"]',
          ].join("\n"),
        ).toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      { key: "chore" },
      "Unknown label_mapping key ignored",
    );
  });

  it("no warning emitted for well-known keys", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          [
            "enabled: true",
            "label_mapping:",
            '  bug: ["bug"]',
            '  feature: ["enhancement"]',
            "priority_label_mapping:",
            '  critical: ["P0"]',
            '  low: ["P3"]',
          ].join("\n"),
        ).toString("base64"),
      },
    });

    await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe("loadConfig with prompts", () => {
  let mockOctokit: any;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => mockLogger,
    };
    mockOctokit = {
      rest: {
        repos: {
          getContent: vi.fn(),
        },
      },
    };
  });

  it("returns prompts: undefined when no prompts section in config", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from("enabled: true\n").toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(config.prompts).toBeUndefined();
  });

  it("resolves inline prompts and returns resolved strings in config.prompts", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          [
            "enabled: true",
            "prompts:",
            '  classify: "  Custom classify prompt  "',
            '  reply: "Custom reply prompt"',
          ].join("\n"),
        ).toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(config.prompts).toBeDefined();
    expect(config.prompts!.classify).toContain("Custom classify prompt");
    expect(config.prompts!.classify).not.toMatch(/^  /); // Trimmed
    expect(config.prompts!.reply).toContain("Custom reply prompt");
  });

  it("resolves file-based prompts via octokit", async () => {
    // First call: config file
    // Second call: prompt file
    mockOctokit.rest.repos.getContent
      .mockResolvedValueOnce({
        data: {
          content: Buffer.from(
            [
              "enabled: true",
              "prompts:",
              '  reply:',
              '    file: "prompts/custom-reply.md"',
            ].join("\n"),
          ).toString("base64"),
        },
      })
      .mockResolvedValueOnce({
        data: {
          content: Buffer.from("Custom file-based reply prompt").toString("base64"),
          type: "file",
        },
      });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(config.prompts).toBeDefined();
    expect(config.prompts!.reply).toContain("Custom file-based reply prompt");
  });

  it("normalizes comment_reply (snake_case) to commentReply", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(
          [
            "enabled: true",
            "prompts:",
            '  comment_reply: "Custom comment reply prompt"',
          ].join("\n"),
        ).toString("base64"),
      },
    });

    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );

    expect(config.prompts).toBeDefined();
    expect(config.prompts!.commentReply).toContain("Custom comment reply prompt");
    expect(config.prompts!["comment_reply"]).toBeUndefined();
  });
});
