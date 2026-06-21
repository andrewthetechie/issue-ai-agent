# Plan: Resolve Standards Review Findings (review-2)

This plan fixes the four Standards-axis findings from the two-axis review of the
configurable-prompts work (commits `a98fff3..HEAD`). Each fix is self-contained
and includes exact before/after code. Apply them in order. After each fix, run
`npx tsc --noEmit` and `npm test` — both must stay green (93 tests).

Scope: findings 1–4 only. Do **not** change any other behaviour.

---

## Finding 1 — `loadConfig` has a required param after a defaulted one

**Problem:** In `src/config/loader.ts`, `configPath` has a default value but is
followed by the required `logger` param. This makes the default unreachable
(every caller must pass `configPath`) and breaks the repo convention that
optional/defaulted params come last.

**Fix:** Reorder the signature so `logger` (required) comes before `configPath`
(defaulted). Update the two call sites and the test call sites.

### 1a. `src/config/loader.ts` (lines 6–13)

Before:
```ts
export async function loadConfig(
  owner: string,
  repo: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  configPath: string = ".forgejo/issue-ai.yml",
  logger: Logger,
): Promise<RepoConfig> {
```

After:
```ts
export async function loadConfig(
  owner: string,
  repo: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  logger: Logger,
  configPath: string = ".forgejo/issue-ai.yml",
): Promise<RepoConfig> {
```

### 1b. `src/pipeline.ts` (line 48)

Before:
```ts
    config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.configPath, log);
```

After:
```ts
    config = await loadConfig(actx.owner, actx.repo, actx.octokit, log, actx.configPath);
```

### 1c. `src/comment-handler.ts` (line 47)

Before:
```ts
    config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.configPath, actx.logger);
```

After:
```ts
    config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.logger, actx.configPath);
```

### 1d. `test/config.test.ts` — four call sites (around lines 53, 78, 115, 140)

Each call currently passes args in the order
`("owner", "repo", mockOctokit, ".forgejo/issue-ai.yml", mockLogger)`.
Swap the last two args so they read
`("owner", "repo", mockOctokit, mockLogger, ".forgejo/issue-ai.yml")`.

Example (the pattern is identical for all four):

Before:
```ts
    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      ".forgejo/issue-ai.yml",
      mockLogger,
    );
```

After:
```ts
    const config = await loadConfig(
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
      ".forgejo/issue-ai.yml",
    );
```

> Note: `test/comment-handler.test.ts`, `test/pipeline.test.ts`, and
> `test/main.test.ts` mock `loadConfig` with `vi.fn()` and never call the real
> implementation, so they need **no** changes.

---

## Finding 2 — `prompts` typed as `Record<string, string>` (untyped key map)

**Problem:** `RepoConfig.prompts` and the resolver use `Record<string, string>`,
which discards the known key names. A typo like `config.prompts?.classifyy`
compiles and silently yields `undefined`. The repo otherwise models config with
explicit named fields (see `RawPromptsConfig`).

**Fix:** Introduce a `PromptKey` union and use `Partial<Record<PromptKey, string>>`.

### 2a. `src/types.ts`

Add a `PromptKey` type next to the existing prompt types (after line 38,
`export type PromptConfigEntry = ...`):

```ts
export type PromptKey = "classify" | "reply" | "duplicate" | "commentReply";
```

Then change the `prompts` field on `RepoConfig` (line 68).

Before:
```ts
  prompts?: Record<string, string>;
```

After:
```ts
  prompts?: Partial<Record<PromptKey, string>>;
```

### 2b. `src/prompts/resolver.ts`

Update the import (line 1) to include `PromptKey`:

Before:
```ts
import type { Logger, RawPromptsConfig } from "../types.js";
```

After:
```ts
import type { Logger, PromptKey, RawPromptsConfig } from "../types.js";
```

Type the suffix map (line 12):

Before:
```ts
const FORMAT_SUFFIXES: Record<string, string> = {
```

After:
```ts
const FORMAT_SUFFIXES: Record<PromptKey, string> = {
```

Update the function's return type (line 55) and the local `resolved`
accumulator (line 60). These are also touched by Finding 3 — apply the final
combined version shown in Finding 3 below. The net type changes are:

- Return type: `Promise<Record<string, string> | undefined>` →
  `Promise<Partial<Record<PromptKey, string>> | undefined>`
- `const resolved: Record<string, string> = {};` →
  `const resolved: Partial<Record<PromptKey, string>> = {};`
- Assignments `resolved[key] = ...` → `resolved[key as PromptKey] = ...`
  (the loop iterates `Object.entries`, so `key` is `string`; the suffix lookup
  below proves the key is a valid `PromptKey` before assignment).
- Suffix lookup `FORMAT_SUFFIXES[key]` → `FORMAT_SUFFIXES[key as PromptKey]`.

No consumer changes are needed: `config.prompts?.classify` etc. in
`classifier.ts`, `replier.ts`, `duplicate.ts`, and `comment-handler.ts` continue
to type-check (the keys are now part of the named union).

---

## Finding 3 — broad `catch` swallows config/programmer errors as warnings

**Problem:** The single `try/catch` in `resolvePrompts` wraps path validation,
entry-shape validation, the unknown-key guard, **and** the network fetch
together. A genuine misconfiguration (bad path, wrong shape) is logged at `warn`
identically to a transient fetch failure. The repo distinguishes config errors
(`logger.error`) from recoverable ones (`logger.warn`). Config/programmer errors
should be `logger.error`; only the network fetch should be `warn`.

**Fix:** Restructure the loop body so validation happens outside the network
`try`, logging config errors with `logger.error` and only fetch failures with
`logger.warn`. This change also incorporates the Finding 2 type updates.

### 3a. `src/prompts/resolver.ts` — replace the loop body (lines 48–119)

Replace the entire `resolvePrompts` function (from `export async function` to its
closing brace) with:

```ts
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
```

Key behavioural changes vs. the original:
- Config errors (unknown key, malformed shape, invalid/absolute/traversal path)
  now log at `logger.error` and `continue`.
- Only the `fetchFileContent` call (including the empty-content error it throws)
  and truncation remain under `warn`.
- Resolved values are still omitted on any failure, so consumers still fall back
  to the built-in default. The public return contract is unchanged except the
  narrower type.

### 3b. `test/prompts/resolver.test.ts` — update assertions for the now-`error` cases

Four tests currently assert `expect(mockLogger.warn).toHaveBeenCalled()` for
cases that are now logged via `logger.error`. Change the assertion to
`expect(mockLogger.error).toHaveBeenCalled()` in each, and update the test title
from "logs warning" to "logs error":

1. Path traversal test (around line 103, `{ file: "../../.env" }`):
   - Title: `"logs warning and omits key for path traversal (no network call)"`
     → `"logs error and omits key for path traversal (no network call)"`
   - Line 112: `expect(mockLogger.warn)` → `expect(mockLogger.error)`
2. Absolute path test (around line 117, `{ file: "/etc/passwd" }`):
   - Title: "logs warning ..." → "logs error ..."
   - Line 126: `expect(mockLogger.warn)` → `expect(mockLogger.error)`
3. Invalid characters test (around line 131, `"prompts/custom file.md"`):
   - Title: "logs warning ..." → "logs error ..."
   - Line 140: `expect(mockLogger.warn)` → `expect(mockLogger.error)`
4. Malformed entry test (around line 145, `{ path: "prompts/x.md" }`):
   - Title: "logs warning ..." → "logs error ..."
   - Line 155: `expect(mockLogger.warn)` → `expect(mockLogger.error)`

Leave unchanged (these stay `warn`):
- Missing file / 404 test (around line 99).
- Non-404 octokit failure test (around line 174).
- Oversized truncation test (around line 214).

> The `mockLogger` already stubs `error` (see the mock at lines 17–22), so no
> mock setup changes are required.

---

## Finding 4 — size-cap comment says "75KB" but cap is in chars (UTF-16 units)

**Problem:** `MAX_PROMPT_SIZE = 75 * 1024` is compared against `content.length`,
which counts UTF-16 code units (characters), not bytes. The `// 75KB` comment and
the log message ("exceeds ... chars") are inconsistent: the comment implies
bytes. This is a documentation/clarity issue only — do **not** change the cap
value or switch to a byte-based measurement (that is out of scope per the spec,
which accepts the char-based cap).

**Fix:** Make the comment accurately describe the unit. In
`src/prompts/resolver.ts` line 9:

Before:
```ts
const MAX_PROMPT_SIZE = 75 * 1024; // 75KB
```

After:
```ts
// Cap measured in characters (UTF-16 code units), not bytes. ~76.8K chars,
// generous enough for any real prompt while preventing context blow-up from a
// misconfigured path pointing at a large file.
const MAX_PROMPT_SIZE = 75 * 1024;
```

The existing log message ("exceeds ${MAX_PROMPT_SIZE} chars, truncating") is
already correct and needs no change.

---

## Verification

After applying all four fixes:

1. `npx tsc --noEmit` — must report no errors.
2. `npm test` — all 93 tests must pass (4 resolver test assertions updated in 3b;
   no change to the total count).
3. Sanity-check the diff touches only: `src/config/loader.ts`, `src/pipeline.ts`,
   `src/comment-handler.ts`, `src/types.ts`, `src/prompts/resolver.ts`,
   `test/config.test.ts`, `test/prompts/resolver.test.ts`.
