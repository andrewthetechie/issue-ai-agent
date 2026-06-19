import type { RelatedIssue } from "../types.js";

export async function searchSimilarIssues(
  owner: string,
  repo: string,
  title: string,
  issueNumber: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
): Promise<RelatedIssue[]> {
  const query = buildSearchQuery(title, owner, repo);

  const keywords = query.split("in:title ")[1]?.trim();
  if (!keywords) {
    return [];
  }

  const response = await octokit.rest.search.issuesAndPullRequests({
    q: query,
    per_page: 5,
    sort: "updated",
    order: "desc",
  });

  return response.data.items
    .filter((item: { number: number; pull_request?: unknown }) => item.number !== issueNumber && !item.pull_request)
    .map((item: { number: number; title: string; html_url: string }) => ({
      number: item.number,
      title: item.title,
      url: item.html_url,
    }));
}

export const STOP_WORDS = new Set(["the", "and", "for", "not", "but", "are", "was", "has", "this", "that", "with", "from", "into", "can", "all", "its", "our"]);

export function buildSearchQuery(title: string, owner: string, repo: string): string {
  const words = title
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 5)
    .join(" ");

  return `repo:${owner}/${repo} is:issue is:open in:title ${words}`;
}
