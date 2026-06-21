import type { Logger, PromptKey, RawPromptsConfig } from "../types.js";
import {
  CLASSIFY_FORMAT_SUFFIX,
  REPLY_FORMAT_SUFFIX,
  DUPLICATE_FORMAT_SUFFIX,
  COMMENT_REPLY_FORMAT_SUFFIX,
} from "./index.js";

// Cap measured in characters (UTF-16 code units), not bytes. ~76.8K chars,
// generous enough for any real prompt while preventing context blow-up from a
// misconfigured path pointing at a large file.
const MAX_PROMPT_SIZE = 75 * 1024;
const PATH_REGEX = /^[a-z0-9_./-]+$/i;

const FORMAT_SUFFIXES: Record<PromptKey, string> = {
  classify: CLASSIFY_FORMAT_SUFFIX,
  reply: REPLY_FORMAT_SUFFIX,
  duplicate: DUPLICATE_FORMAT_SUFFIX,
  commentReply: COMMENT_REPLY_FORMAT_SUFFIX,
};

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
): Promise<Partial<Record<PromptKey, string>> | undefined> {
  if (raw === undefined) {
    return undefined;
  }

  const resolved: Partial<Record<PromptKey, string>> = {};

  for (const [key, entry] of Object.entries(raw)) {
    if (entry === undefined) {
      continue;
    }

    const suffix = FORMAT_SUFFIXES[key as PromptKey];
    if (suffix === undefined) {
      // Unknown key — RawPromptsConfig should prevent this. Surface as a bug.
      logger.error(
        { promptKey: key },
        `No format suffix registered for prompt key; skipping`,
      );
      continue;
    }

    if (typeof entry === "string") {
      // Inline prompt: trim and append suffix
      resolved[key as PromptKey] = entry.trim() + suffix;
      continue;
    }

    // File-based prompt — validate shape. A bad shape is a config error.
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.file !== "string"
    ) {
      logger.error(
        { promptKey: key },
        `Prompt entry must be a string or { file: string }; using built-in default`,
      );
      continue;
    }

    const filePath = entry.file;

    // Validate path before any network call. An invalid path is a config error.
    try {
      validatePath(filePath);
    } catch (err: unknown) {
      logger.error(
        { promptKey: key, filePath, err },
        `Invalid prompt file path; using built-in default`,
      );
      continue;
    }

    // Network fetch — transient failures are recoverable, log at warn.
    try {
      let content = await fetchFileContent(owner, repo, filePath, octokit);

      // Truncate if over the size cap.
      if (content.length > MAX_PROMPT_SIZE) {
        logger.warn(
          { promptKey: key, filePath, size: content.length },
          `Prompt file exceeds ${MAX_PROMPT_SIZE} chars, truncating`,
        );
        content = content.slice(0, MAX_PROMPT_SIZE);
      }

      resolved[key as PromptKey] = content + suffix;
    } catch (err: unknown) {
      logger.warn(
        { promptKey: key, filePath, err },
        `Failed to fetch custom prompt file, using built-in default`,
      );
      // Skip this key — consumer falls back to the built-in default.
    }
  }

  return Object.keys(resolved).length > 0 ? resolved : undefined;
}
