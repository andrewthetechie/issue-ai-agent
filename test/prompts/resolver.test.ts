import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolvePrompts } from "../../src/prompts/resolver.js";
import {
  CLASSIFY_FORMAT_SUFFIX,
  REPLY_FORMAT_SUFFIX,
  DUPLICATE_FORMAT_SUFFIX,
  COMMENT_REPLY_FORMAT_SUFFIX,
} from "../../src/prompts/index.js";
import type { Logger } from "../../src/types.js";

describe("resolvePrompts", () => {
  let mockOctokit: any;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("returns undefined when no prompts configured", async () => {
    const result = await resolvePrompts(
      undefined,
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );
    expect(result).toBeUndefined();
  });

  it("trims inline prompt and appends format suffix", async () => {
    const result = await resolvePrompts(
      { classify: "  Custom prompt  " },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(result).toEqual({
      classify: "Custom prompt" + CLASSIFY_FORMAT_SUFFIX,
    });
  });

  it("fetches file-based prompt via octokit and appends format suffix", async () => {
    const fileContent = "Custom file-based reply prompt";
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(fileContent).toString("base64"),
        type: "file",
      },
    });

    const result = await resolvePrompts(
      { reply: { file: "prompts/custom-reply.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      path: "prompts/custom-reply.md",
    });
    expect(result).toEqual({
      reply: fileContent + REPLY_FORMAT_SUFFIX,
    });
  });

  it("logs warning and omits key when file not found (404)", async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue({
      status: 404,
      message: "Not Found",
    });

    const result = await resolvePrompts(
      { reply: { file: "prompts/missing.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("logs warning and omits key for path traversal (no network call)", async () => {
    const result = await resolvePrompts(
      { classify: { file: "../../.env" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(mockOctokit.rest.repos.getContent).not.toHaveBeenCalled();
  });

  it("logs warning and omits key for absolute path (no network call)", async () => {
    const result = await resolvePrompts(
      { classify: { file: "/etc/passwd" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(mockOctokit.rest.repos.getContent).not.toHaveBeenCalled();
  });

  it("logs warning and omits key for invalid characters in path", async () => {
    const result = await resolvePrompts(
      { classify: { file: "prompts/custom file.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(mockOctokit.rest.repos.getContent).not.toHaveBeenCalled();
  });

  it("logs warning and omits key for malformed entry without file", async () => {
    const result = await resolvePrompts(
      // @ts-expect-error — intentionally malformed config from YAML
      { classify: { path: "prompts/x.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(mockOctokit.rest.repos.getContent).not.toHaveBeenCalled();
  });

  it("logs warning and omits key when octokit fails with non-404", async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue({
      status: 500,
      message: "Internal Server Error",
    });

    const result = await resolvePrompts(
      { reply: { file: "prompts/custom-reply.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("accepts uppercase characters in file path", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from("Custom prompt").toString("base64"),
        type: "file",
      },
    });

    const result = await resolvePrompts(
      { classify: { file: "Prompts/Custom.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(result!.classify).toContain("Custom prompt");
  });

  it("truncates oversized content and logs warning", async () => {
    const largeContent = "x".repeat(80 * 1024); // 80KB
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(largeContent).toString("base64"),
        type: "file",
      },
    });

    const result = await resolvePrompts(
      { classify: { file: "prompts/large.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result!.classify.length).toBeLessThan(largeContent.length + CLASSIFY_FORMAT_SUFFIX.length);
    expect(result!.classify).toMatch(/x+/); // Contains truncated content
    expect(result!.classify.endsWith(CLASSIFY_FORMAT_SUFFIX)).toBe(true);
  });

  it("appends correct format suffix for each key", async () => {
    const result = await resolvePrompts(
      {
        classify: "classify prompt",
        reply: "reply prompt",
        duplicate: "duplicate prompt",
        commentReply: "comment reply prompt",
      },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(result!.classify).toBe("classify prompt" + CLASSIFY_FORMAT_SUFFIX);
    expect(result!.reply).toBe("reply prompt" + REPLY_FORMAT_SUFFIX);
    expect(result!.duplicate).toBe("duplicate prompt" + DUPLICATE_FORMAT_SUFFIX);
    expect(result!.commentReply).toBe("comment reply prompt" + COMMENT_REPLY_FORMAT_SUFFIX);
  });

  it("resolves mixed inline and file prompts in a single call", async () => {
    const fileContent = "File-based duplicate prompt";
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from(fileContent).toString("base64"),
        type: "file",
      },
    });

    const result = await resolvePrompts(
      {
        classify: "  Inline classify prompt  ",
        duplicate: { file: "prompts/custom-duplicate.md" },
      },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(result!.classify).toBe("Inline classify prompt" + CLASSIFY_FORMAT_SUFFIX);
    expect(result!.duplicate).toBe(fileContent + DUPLICATE_FORMAT_SUFFIX);
    expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledTimes(1);
  });
});
