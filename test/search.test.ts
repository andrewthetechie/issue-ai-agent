import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildSearchKeywords, searchSimilarIssues, STOP_WORDS } from "../src/forgejo/search.js";

describe("buildSearchKeywords", () => {
  it("extracts plain keywords from title", () => {
    const keywords = buildSearchKeywords("Login page crashes on Chrome 120");
    expect(keywords).toContain("Login");
    expect(keywords).toContain("page");
    expect(keywords).toContain("crashes");
    expect(keywords).toContain("Chrome");
    expect(keywords).toContain("120");
  });

  it("drops stop words", () => {
    const keywords = buildSearchKeywords("a bug in the app");
    expect(keywords).not.toContain(" a ");
    expect(keywords).not.toContain(" in ");
    expect(keywords).not.toContain(" the ");
    expect(keywords).toContain("bug");
    expect(keywords).toContain("app");
  });

  it("drops words with 2 or fewer characters", () => {
    const keywords = buildSearchKeywords("hi there");
    expect(keywords).not.toContain("hi");
    expect(keywords).toContain("there");
  });

  it("caps at 5 keywords", () => {
    const longTitle = "one two three four five six seven eight nine ten";
    const keywords = buildSearchKeywords(longTitle);
    const words = keywords.split(" ");
    expect(words.length).toBeLessThanOrEqual(5);
  });

  it("strips special characters", () => {
    const keywords = buildSearchKeywords("Bug: [API] crash!!! @#$");
    expect(keywords).not.toContain("[");
    expect(keywords).not.toContain("!");
    expect(keywords).not.toContain("@");
  });

  it("contains none of the GitHub qualifiers", () => {
    const keywords = buildSearchKeywords("Login page crashes on Chrome 120");
    expect(keywords).not.toContain("repo:");
    expect(keywords).not.toContain("is:issue");
    expect(keywords).not.toContain("is:open");
    expect(keywords).not.toContain("in:title");
  });

  it("returns empty string when all words are filtered", () => {
    const keywords = buildSearchKeywords("a i am");
    expect(keywords).toBe("");
  });
});

describe("searchSimilarIssues", () => {
  const serverUrl = "https://forgejo.example.com";
  const token = "test-token";
  const owner = "myorg";
  const repo = "myrepo";
  const issueNumber = 42;

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("issues a fetch to the correct endpoint with correct params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await searchSimilarIssues(owner, repo, "test keyword", issueNumber, serverUrl, token);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`${serverUrl}/api/v1/repos/issues/search`);
    expect(url).toContain("q=");
    expect(url).toContain(`owner=${owner}`);
    expect(url).toContain("type=issues");
    expect(url).toContain("state=open");
  });

  it("includes Authorization: token header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await searchSimilarIssues(owner, repo, "test keyword", issueNumber, serverUrl, token);

    const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init?.headers).toBeDefined();
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`token ${token}`);
  });

  it("filters out items from different repos", async () => {
    const mockResponse = [
      {
        number: 1,
        title: "Same title",
        html_url: "https://forgejo.example.com/myorg/otherrepo/issues/1",
        repository: { full_name: "myorg/otherrepo" },
      },
      {
        number: 2,
        title: "Correct repo issue",
        html_url: "https://forgejo.example.com/myorg/myrepo/issues/2",
        repository: { full_name: "myorg/myrepo" },
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await searchSimilarIssues(owner, repo, "test keyword", issueNumber, serverUrl, token);

    expect(results.length).toBe(1);
    expect(results[0].number).toBe(2);
    expect(results[0].title).toBe("Correct repo issue");
  });

  it("excludes the triggering issue number", async () => {
    const mockResponse = [
      {
        number: 42,
        title: "This is the triggering issue",
        html_url: "https://forgejo.example.com/myorg/myrepo/issues/42",
        repository: { full_name: "myorg/myrepo" },
      },
      {
        number: 43,
        title: "A different issue",
        html_url: "https://forgejo.example.com/myorg/myrepo/issues/43",
        repository: { full_name: "myorg/myrepo" },
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await searchSimilarIssues(owner, repo, "test keyword", issueNumber, serverUrl, token);

    expect(results.length).toBe(1);
    expect(results[0].number).toBe(43);
  });

  it("excludes pull requests", async () => {
    const mockResponse = [
      {
        number: 44,
        title: "A pull request",
        html_url: "https://forgejo.example.com/myorg/myrepo/pulls/44",
        repository: { full_name: "myorg/myrepo" },
        pull_request: { url: "https://forgejo.example.com/api/v1/repos/myorg/myrepo/pulls/44" },
      },
      {
        number: 45,
        title: "An issue",
        html_url: "https://forgejo.example.com/myorg/myrepo/issues/45",
        repository: { full_name: "myorg/myrepo" },
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await searchSimilarIssues(owner, repo, "test keyword", issueNumber, serverUrl, token);

    expect(results.length).toBe(1);
    expect(results[0].number).toBe(45);
  });

  it("returns empty array when keywords are empty", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await searchSimilarIssues(owner, repo, "a i am", issueNumber, serverUrl, token);

    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns empty array when response is not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await searchSimilarIssues(owner, repo, "test keyword", issueNumber, serverUrl, token);

    expect(results).toEqual([]);
  });

  it("maps results to RelatedIssue shape with number, title, url", async () => {
    const mockResponse = [
      {
        number: 10,
        title: "First issue",
        html_url: "https://forgejo.example.com/myorg/myrepo/issues/10",
        repository: { full_name: "myorg/myrepo" },
      },
      {
        number: 11,
        title: "Second issue",
        html_url: "https://forgejo.example.com/myorg/myrepo/issues/11",
        repository: { full_name: "myorg/myrepo" },
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await searchSimilarIssues(owner, repo, "test keyword", issueNumber, serverUrl, token);

    expect(results).toEqual([
      { number: 10, title: "First issue", url: "https://forgejo.example.com/myorg/myrepo/issues/10" },
      { number: 11, title: "Second issue", url: "https://forgejo.example.com/myorg/myrepo/issues/11" },
    ]);
  });
});
