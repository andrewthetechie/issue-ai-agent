import { describe, it, expect, vi } from "vitest";
import { parseDuplicateResponse, postDuplicateComment } from "../src/duplicate.js";

describe("parseDuplicateResponse", () => {
  it("parses valid response with duplicates", () => {
    const input = JSON.stringify({
      duplicates: [42, 17],
      reasoning: "Both describe the same login crash",
    });

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([42, 17]);
    expect(result.reasoning).toBe("Both describe the same login crash");
  });

  it("parses response with no duplicates", () => {
    const input = JSON.stringify({
      duplicates: [],
      reasoning: "No duplicates found among candidates.",
    });

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([]);
  });

  it("parses JSON wrapped in code block", () => {
    const json = JSON.stringify({
      duplicates: [5],
      reasoning: "Same bug report",
    });
    const input = "```json\n" + json + "\n```";

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([5]);
  });

  it("returns empty array for malformed JSON", () => {
    const result = parseDuplicateResponse("not json at all");
    expect(result.duplicates).toEqual([]);
    expect(result.reasoning).toBe("Failed to parse duplicate detection response");
  });

  it("filters non-number entries from duplicates", () => {
    const input = JSON.stringify({
      duplicates: [1, "bad", null, 3],
      reasoning: "Test",
    });

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([1, 3]);
  });

  it("handles missing reasoning", () => {
    const input = JSON.stringify({ duplicates: [1] });

    const result = parseDuplicateResponse(input);
    expect(result.duplicates).toEqual([1]);
    expect(result.reasoning).toBe("No reasoning provided");
  });

  it("truncates long reasoning", () => {
    const longReasoning = "x".repeat(500);
    const input = JSON.stringify({ duplicates: [], reasoning: longReasoning });

    const result = parseDuplicateResponse(input);
    expect(result.reasoning.length).toBeLessThanOrEqual(300);
  });
});

describe("postDuplicateComment", () => {
  it("posts a comment listing duplicate issues", async () => {
    const createComment = vi.fn().mockResolvedValue({});
    const octokit = { rest: { issues: { createComment } } };

    await postDuplicateComment(
      octokit,
      "owner",
      "repo",
      42,
      [
        { number: 10, title: "Login crash", url: "https://example.com/10" },
        { number: 20, title: "Auth failure", url: "https://example.com/20" },
      ],
    );

    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
      body: expect.stringContaining("#10"),
    });
    expect(createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
      body: expect.stringContaining("#20"),
    });
  });

  it("posts a comment with no duplicates listed", async () => {
    const createComment = vi.fn().mockResolvedValue({});
    const octokit = { rest: { issues: { createComment } } };

    await postDuplicateComment(octokit, "owner", "repo", 1, []);

    expect(createComment).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(createComment).mock.calls[0][0] as { body: string };
    expect(callArgs.body).toContain("Duplicate issue(s) detected");
    expect(callArgs.body).toContain("-- Issue AI Agent");
  });
});
