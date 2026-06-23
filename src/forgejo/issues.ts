import type { Issue } from "../types.js";
import { normalizeServerUrl } from "../utils.js";

export async function fetchIssuesByLabel(
  serverUrl: string,
  owner: string,
  repo: string,
  triageLabel: string,
  batchLimit: number,
  token: string,
): Promise<Issue[]> {
  const baseUrl = normalizeServerUrl(serverUrl);
  const url = `${baseUrl}/api/v1/repos/${owner}/${repo}/issues?state=open&type=issues&labels=${encodeURIComponent(triageLabel)}&sort=oldest&limit=${batchLimit}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Issues API failed: ${response.status} ${response.statusText} — ${body}`);
  }

  const data = await response.json();

  const items = Array.isArray(data) ? data : [];

  return items
    .slice(0, batchLimit)
    .map((item: { number: number; title: string; body: string | null; html_url: string; user?: { login: string } | null; labels?: Array<{ name: string; id: number }> | null; created_at: string }) => ({
      number: item.number,
      title: item.title,
      body: item.body ?? null,
      html_url: item.html_url,
      user: { login: item.user?.login ?? "" },
      labels: (item.labels ?? []).map((label: { name: string; id: number }) => ({ name: label.name, id: label.id })),
      created_at: item.created_at,
    }));
}

/**
 * Removes a label from an issue by label id via the Forgejo API.
 *
 * Endpoint: DELETE /api/v1/repos/{owner}/{repo}/issues/{issueIndex}/labels/{labelId}
 *
 * A 404 response (label not present on the issue) is treated as success
 * because the desired end state is "label absent".
 */
export async function removeLabelFromIssue(
  serverUrl: string,
  owner: string,
  repo: string,
  issueIndex: number,
  labelId: number,
  token: string,
): Promise<void> {
  const baseUrl = normalizeServerUrl(serverUrl);
  const url = `${baseUrl}/api/v1/repos/${owner}/${repo}/issues/${issueIndex}/labels/${labelId}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `token ${token}`,
    },
  });

  if (response.status === 404) {
    // Label not present on the issue — desired end state is "label absent"
    return;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`removeLabelFromIssue failed: ${response.status} ${response.statusText} — ${body}`);
  }

  return;
}
