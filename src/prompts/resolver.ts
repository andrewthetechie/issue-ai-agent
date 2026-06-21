import type { Logger, RawPromptsConfig } from "../types.js";
import {
  CLASSIFY_FORMAT_SUFFIX,
  REPLY_FORMAT_SUFFIX,
  DUPLICATE_FORMAT_SUFFIX,
  COMMENT_REPLY_FORMAT_SUFFIX,
} from "./index.js";

const MAX_PROMPT_SIZE = 75 * 1024; // 75KB
const PATH_REGEX = /^[a-z0-9_./-]+$/i;

const FORMAT_SUFFIXES: Record<string, string> = {
  classify: CLASSIFY_FORMAT_SUFFIX,
  reply: REPLY_FORMAT_SUFFIX,
  duplicate: DUPLICATE_FORMAT_SUFFIX,
  commentReply: COMMENT_REPLY_FORMAT_SUFFIX,
};

interface OctokitError extends Error {
  status: number;
}

function validatePath(path: string): void {
  if (path.startsWith("/")) {
    throw new Error(`Prompt file path must not be absolute: ${path}`);
  }
  if (path.includes("..")) {
    throw new Error(`Prompt file path must not contain '..': ${path}`);
  }
  if (!PATH_REGEX.test(path)) {
    throw new Error(
      `Prompt file path contains invalid characters: ${path}`,
    );
  }
}

async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
): Promise<string> {
  const response = await octokit.rest.repos.getContent({ owner, repo, path });
  const data = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!data.content) {
    throw new Error(`File content is empty: ${path}`);
  }
  return Buffer.from(data.content, "base64").toString("utf-8");
}

export async function resolvePrompts(
  raw: RawPromptsConfig | undefined,
  owner: string,
  repo: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  logger: Logger,
): Promise<Record<string, string> | undefined> {
  if (raw === undefined) {
    return undefined;
  }

  const resolved: Record<string, string> = {};

  for (const [key, entry] of Object.entries(raw)) {
    if (entry === undefined) {
      continue;
    }

    const suffix = FORMAT_SUFFIXES[key] || "";

    if (typeof entry === "string") {
      // Inline prompt: trim and append suffix
      resolved[key] = entry.trim() + suffix;
      continue;
    }

    // File-based prompt
    const filePath = entry.file;

    // Validate path before any network call
    validatePath(filePath);

    let content: string;
    try {
      content = await fetchFileContent(owner, repo, filePath, octokit);
    } catch (err: unknown) {
      const error = err as OctokitError;
      if (error.status === 404) {
        logger.warn(
          { promptKey: key, filePath },
          `Prompt file not found, using built-in default`,
        );
        continue; // Skip this key — falls back to built-in default
      }
      throw err;
    }

    // Truncate if over 75KB
    if (content.length > MAX_PROMPT_SIZE) {
      logger.warn(
        { promptKey: key, filePath, size: content.length },
        `Prompt file exceeds ${MAX_PROMPT_SIZE} bytes, truncating`,
      );
      content = content.slice(0, MAX_PROMPT_SIZE);
    }

    resolved[key] = content + suffix;
  }

  return Object.keys(resolved).length > 0 ? resolved : undefined;
}
