import { describe, it, expect, vi, beforeEach } from "vitest";
import { postDuplicateComment, postExcludeRemovalComment } from "../src/forgejo/comments.js";

function makeMockOctokit() {
  const createComment = vi.fn().mockResolvedValue({});
  return {
    rest: {
      issues: {
        createComment,
      },
    },
    getCreateComment: () => createComment,
  };
}

describe("postDuplicateComment", () => {
  let octokit: ReturnType<typeof makeMockOctokit>;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = makeMockOctokit();
  });

  it("calls createComment once with the correct args and body", async () => {
    const duplicates = [
      { number: 42, title: "App crashes on save", url: "https://example.com/issues/42" },
      { number: 99, title: "Save button broken", url: "https://example.com/issues/99" },
    ];

    await postDuplicateComment(octokit, "owner", "repo", 7, duplicates);

    expect(octokit.getCreateComment()).toHaveBeenCalledTimes(1);
    expect(octokit.getCreateComment()).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 7,
      body: expect.any(String),
    });

    const body = octokit.getCreateComment().mock.calls[0][0].body;
    expect(body).toContain("#42");
    expect(body).toContain("#99");
    expect(body).toContain("App crashes on save");
    expect(body).toContain("Save button broken");
    expect(body).toContain("- #42: App crashes on save (https://example.com/issues/42)");
    expect(body).toContain("- #99: Save button broken (https://example.com/issues/99)");
    expect(body).toContain("Maintainers may want to review these before triaging further.");
    expect(body).toContain("-- Issue AI Agent :robot:");
  });

  it("with an empty duplicates array, still posts a coherent body and does not throw", async () => {
    await expect(
      postDuplicateComment(octokit, "owner", "repo", 7, []),
    ).resolves.not.toThrow();

    expect(octokit.getCreateComment()).toHaveBeenCalledTimes(1);
    const body = octokit.getCreateComment().mock.calls[0][0].body;
    expect(body).toContain("Possible duplicate issues found");
    expect(body).toContain("-- Issue AI Agent :robot:");
  });
});

describe("postExcludeRemovalComment", () => {
  let octokit: ReturnType<typeof makeMockOctokit>;

  beforeEach(() => {
    vi.clearAllMocks();
    octokit = makeMockOctokit();
  });

  it("posts a body mentioning the triageLabel and the user-variant clause when reason is 'user'", async () => {
    await postExcludeRemovalComment(octokit, "owner", "repo", 7, "triage", "user");

    expect(octokit.getCreateComment()).toHaveBeenCalledTimes(1);
    const body = octokit.getCreateComment().mock.calls[0][0].body;
    expect(body).toContain("triage");
    expect(body).toContain("the issue author is on the configured exclude list");
    expect(body).toContain("-- Issue AI Agent :robot:");
  });

  it("posts a body mentioning the excluded-label clause when reason is 'label'", async () => {
    await postExcludeRemovalComment(octokit, "owner", "repo", 7, "triage", "label");

    expect(octokit.getCreateComment()).toHaveBeenCalledTimes(1);
    const body = octokit.getCreateComment().mock.calls[0][0].body;
    expect(body).toContain("triage");
    expect(body).toContain("it carries a configured excluded label");
    expect(body).toContain("-- Issue AI Agent :robot:");
  });
});
