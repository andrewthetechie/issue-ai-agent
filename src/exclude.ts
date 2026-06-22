import type { RepoConfig } from "./types.js";

export function shouldExclude(
  issue: { user?: { login: string }; labels: Array<{ name: string }> },
  config: RepoConfig,
): boolean {
  if (issue.user && config.exclude.users.includes(issue.user.login)) {
    return true;
  }

  for (const label of issue.labels) {
    if (config.exclude.labels.includes(label.name)) {
      return true;
    }
  }

  return false;
}
