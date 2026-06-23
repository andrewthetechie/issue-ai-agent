import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchIssuesByLabel, removeLabelFromIssue } from "../src/forgejo/issues.js";

describe("fetchIssuesByLabel", () => {
  const serverUrl = "https://forgejo.example.com";
  const token = "test-token";
  const owner = "myorg";
  const repo = "myrepo";
  const triageLabel = "triage";
  const batchLimit = 10;

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

    await fetchIssuesByLabel(serverUrl, owner, repo, triageLabel, batchLimit, token);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`${serverUrl}/api/v1/repos/${owner}/${repo}/issues`);
    expect(url).toContain("state=open");
    expect(url).toContain("type=issues");
    expect(url).toContain(`labels=${encodeURIComponent(triageLabel)}`);
    expect(url).toContain("sort=oldest");
    expect(url).toContain(`limit=${batchLimit}`);
  });

  it("strips trailing slash from serverUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await fetchIssuesByLabel("https://forgejo.example.com/", owner, repo, triageLabel, batchLimit, token);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("//api");
    expect(url).toContain("https://forgejo.example.com/api/v1/repos");
  });

  it("includes Authorization: token header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await fetchIssuesByLabel(serverUrl, owner, repo, triageLabel, batchLimit, token);

    const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init?.headers).toBeDefined();
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`token ${token}`);
  });

  it("returns Issue[] with labels[].id", async () => {
    const mockResponse = [
      {
        number: 1,
        title: "First issue",
        body: "Body of first issue",
        html_url: "https://forgejo.example.com/myorg/myrepo/issues/1",
        user: { login: "alice" },
        labels: [{ name: "triage", id: 100 }, { name: "bug", id: 200 }],
        created_at: "2024-01-01T00:00:00Z",
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await fetchIssuesByLabel(serverUrl, owner, repo, triageLabel, batchLimit, token);

    expect(results.length).toBe(1);
    expect(results[0].number).toBe(1);
    expect(results[0].title).toBe("First issue");
    expect(results[0].body).toBe("Body of first issue");
    expect(results[0].html_url).toBe("https://forgejo.example.com/myorg/myrepo/issues/1");
    expect(results[0].user.login).toBe("alice");
    expect(results[0].labels).toEqual([
      { name: "triage", id: 100 },
      { name: "bug", id: 200 },
    ]);
    expect(results[0].created_at).toBe("2024-01-01T00:00:00Z");
  });

  it("nullifies body when body is null", async () => {
    const mockResponse = [
      {
        number: 2,
        title: "Issue without body",
        body: null,
        html_url: "https://forgejo.example.com/myorg/myrepo/issues/2",
        user: { login: "bob" },
        labels: [{ name: "triage", id: 100 }],
        created_at: "2024-01-02T00:00:00Z",
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await fetchIssuesByLabel(serverUrl, owner, repo, triageLabel, batchLimit, token);

    expect(results[0].body).toBeNull();
  });

  it("truncates result to batchLimit when server returns more items", async () => {
    const mockResponse = Array.from({ length: 20 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      body: `Body ${i + 1}`,
      html_url: `https://forgejo.example.com/myorg/myrepo/issues/${i + 1}`,
      user: { login: "user" },
      labels: [{ name: "triage", id: 100 }],
      created_at: `2024-01-0${i + 1}T00:00:00Z`,
    }));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await fetchIssuesByLabel(serverUrl, owner, repo, triageLabel, batchLimit, token);

    expect(results.length).toBe(batchLimit);
    expect(results[0].number).toBe(1);
    expect(results[batchLimit - 1].number).toBe(batchLimit);
  });

  it("throws when response is not ok (500)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("error details"),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await expect(
      fetchIssuesByLabel(serverUrl, owner, repo, triageLabel, batchLimit, token),
    ).rejects.toThrow("Issues API failed: 500 Internal Server Error");
  });

  it("throws when response is not ok (404)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("repo not found"),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await expect(
      fetchIssuesByLabel(serverUrl, owner, repo, triageLabel, batchLimit, token),
    ).rejects.toThrow("Issues API failed: 404 Not Found");
  });

  it("returns empty array when no issues match", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    const results = await fetchIssuesByLabel(serverUrl, owner, repo, triageLabel, batchLimit, token);

    expect(results).toEqual([]);
  });
});

describe("removeLabelFromIssue", () => {
  const serverUrl = "https://forgejo.example.com";
  const token = "test-token";
  const owner = "myorg";
  const repo = "myrepo";
  const issueIndex = 42;
  const labelId = 7;

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("issues a DELETE to the correct endpoint with correct params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await removeLabelFromIssue(serverUrl, owner, repo, issueIndex, labelId, token);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${serverUrl}/api/v1/repos/${owner}/${repo}/issues/${issueIndex}/labels/${labelId}`);
    expect(init?.method).toBe("DELETE");
  });

  it("strips trailing slash from serverUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await removeLabelFromIssue(
      `${serverUrl}/`,
      owner,
      repo,
      issueIndex,
      labelId,
      token,
    );

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("//api");
    expect(url).toBe("https://forgejo.example.com/api/v1/repos/myorg/myrepo/issues/42/labels/7");
  });

  it("includes Authorization: token header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await removeLabelFromIssue(serverUrl, owner, repo, issueIndex, labelId, token);

    const [_url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`token ${token}`);
  });

  it("resolves on 204", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await expect(
      removeLabelFromIssue(serverUrl, owner, repo, issueIndex, labelId, token),
    ).resolves.toBeUndefined();
  });

  it("resolves on 404 (label not present on issue)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await expect(
      removeLabelFromIssue(serverUrl, owner, repo, issueIndex, labelId, token),
    ).resolves.toBeUndefined();
  });

  it("throws on 500 with status in the message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("error details"),
    });
    global.fetch = mockFetch as unknown as typeof global.fetch;

    await expect(
      removeLabelFromIssue(serverUrl, owner, repo, issueIndex, labelId, token),
    ).rejects.toThrow("removeLabelFromIssue failed: 500 Internal Server Error");
  });
});
