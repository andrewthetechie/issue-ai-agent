import type { RelatedIssue } from "../types.js";
import { normalizeServerUrl } from "../utils.js";

export const STOP_WORDS = new Set(["the", "and", "for", "not", "but", "are", "was", "has", "this", "that", "with", "from", "into", "can", "all", "its", "our"]);

export function buildSearchKeywords(title: string): string {
  const words = title
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 5)
    .join(" ");

  return words;
}

export async function searchSimilarIssues(
  owner: string,
  repo: string,
  title: string,
  issueNumber: number,
  serverUrl: string,
  token: string,
): Promise<RelatedIssue[]> {
  const keywords = buildSearchKeywords(title);
  if (!keywords) {
    return [];
  }

  const baseUrl = normalizeServerUrl(serverUrl);
  const url = `${baseUrl}/api/v1/repos/issues/search?q=${encodeURIComponent(keywords)}&owner=${encodeURIComponent(owner)}&type=issues&state=open&limit=5`;

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Search API failed: ${response.status} ${response.statusText} — ${body}`);
  }

  const data = await response.json();

  const items = Array.isArray(data) ? data : [];

  return items
    .filter((item: { repository?: { full_name?: string }; pull_request?: unknown }) => {
      // Exclude pull requests
      if (item.pull_request) return false;
      // Filter to only the target repo
      if (item.repository?.full_name !== `${owner}/${repo}`) return false;
      return true;
    })
    .filter((item: { number: number }) => item.number !== issueNumber)
    .map((item: { number: number; title: string; html_url: string }) => ({
      number: item.number,
      title: item.title,
      url: item.html_url,
    }));
}
