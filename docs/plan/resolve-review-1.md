# Plan — Resolve Code Review 1 (PRD 0002 Configurable Prompts)

This plan fixes four findings from the code review of the configurable-prompts branch.
Each item is self-contained: it states the file, the exact lines, the current code, the
target code, and how to verify. Follow them in order. Run the verification commands at the
end of each item before moving on.

## Context you need first

The feature lets repo maintainers override system prompts via `.forgejo/issue-ai.yml`.
Relevant files:

- `src/prompts/resolver.ts` — resolves raw prompt config (inline string or `{ file }`) into
  final prompt strings. This is where most fixes land.
- `src/config/loader.ts` — calls `resolvePrompts()` and assembles `RepoConfig`.
- `src/types.ts` — `PromptConfigEntry`, `RawPromptsConfig`, `Logger` types.
- `docs/prd/002-configurable-prompts.md` — the spec.
- Tests: `test/prompts/resolver.test.ts`, `test/config.test.ts`.

Key type definitions (from `src/types.ts:38-45`):

```ts
export type PromptConfigEntry = string | { file: string };

export interface RawPromptsConfig {
  classify?: PromptConfigEntry;
  reply?: PromptConfigEntry;
  duplicate?: PromptConfigEntry;
  commentReply?: PromptConfigEntry;
}
```

Run the full test suite at any time with:

```
npx vitest run
```

Type-check with:

```
npx tsc --noEmit
```

---

## Item S1 — Make prompt resolution best-effort per key (HARD BLOCKER)

### Problem

In `src/prompts/resolver.ts`, the resolver assumes any non-string entry is a valid
`{ file: string }`. A malformed config (e.g. an object without a `file` key, a typo like
`path:` instead of `file:`), an empty file, or any non-404 octokit error (rate limit, 500)
throws and the exception escapes both `resolvePrompts()` and `loadConfig()` — aborting the
entire triage pipeline. `loadConfig()` only catches the 404 case for the config file itself
(`src/config/loader.ts:30-36`), not errors from prompt resolution.

This violates PRD User Stories 10 and 11: a misconfigured prompt must log a warning and fall
back to the built-in default, never break triage.

### Fix

Wrap each key's resolution so that **any** failure logs a warning and falls back to the
built-in default (by skipping that key, same as the existing 404 path). Only validate the
entry shape up front. Programmer-error-only paths may still throw, but config-driven failures
must not.

### File: `src/prompts/resolver.ts`

Current resolution loop (lines 66-110):

```ts
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
```

Replace the entire loop body with the version below. The whole per-key body is wrapped in a
single `try/catch`; any thrown error (bad shape, invalid path, empty file, octokit failure of
any kind) logs a warning and `continue`s to the built-in default. Note the suffix lookup also
changes per Item M2 (no silent `|| ""`).

```ts
  for (const [key, entry] of Object.entries(raw)) {
    if (entry === undefined) {
      continue;
    }

    try {
      const suffix = FORMAT_SUFFIXES[key];
      if (suffix === undefined) {
        // Unknown key — RawPromptsConfig should prevent this. Surface as a bug.
        throw new Error(`No format suffix registered for prompt key: ${key}`);
      }

      if (typeof entry === "string") {
        // Inline prompt: trim and append suffix
        resolved[key] = entry.trim() + suffix;
        continue;
      }

      // File-based prompt — validate shape before doing anything else.
      if (
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.file !== "string"
      ) {
        throw new Error(
          `Prompt entry must be a string or { file: string }: ${key}`,
        );
      }

      const filePath = entry.file;

      // Validate path before any network call.
      validatePath(filePath);

      let content = await fetchFileContent(owner, repo, filePath, octokit);

      // Truncate if over the size cap.
      if (content.length > MAX_PROMPT_SIZE) {
        logger.warn(
          { promptKey: key, filePath, size: content.length },
          `Prompt file exceeds ${MAX_PROMPT_SIZE} chars, truncating`,
        );
        content = content.slice(0, MAX_PROMPT_SIZE);
      }

      resolved[key] = content + suffix;
    } catch (err: unknown) {
      logger.warn(
        { promptKey: key, err },
        `Failed to resolve custom prompt, using built-in default`,
      );
      // Skip this key — consumer falls back to the built-in default.
      continue;
    }
  }
```

Notes:

- The `OctokitError` interface and the special-cased `error.status === 404` block are no
  longer needed — every failure now degrades the same way. You may delete the
  `interface OctokitError` block (lines 19-21) if nothing else references it (it isn't
  referenced elsewhere).
- `fetchFileContent` (lines 37-50) already throws `"File content is empty"` for empty files;
  that now becomes a warning + fallback automatically. Leave `fetchFileContent` as-is.
- `validatePath` (lines 23-35) still throws; those throws are now caught per-key. Leave it
  as-is except for the Item S3-related regex note below (regex change is documentation-only;
  see S3).

### Tests to update/add: `test/prompts/resolver.test.ts`

The existing 404 test asserts a warning is logged and the result is `undefined`. It still
passes because the catch logs `warn` and the key is skipped. Verify these existing tests still
pass:

- `"logs warning and omits key when file not found (404)"` (lines 85-101) — still valid.
- `"throws error for path traversal without making network call"` (lines 103-115) — **this
  now changes**: path traversal is caught per-key, so it no longer rejects. Update it to
  assert a warning + omitted key instead of a throw.
- `"throws error for absolute path..."` (lines 117-129) — same change.
- `"throws error for invalid characters in path"` (lines 131-143) — same change.

Rewrite those three "throws" tests to the new contract. Example for the path-traversal case:

```ts
  it("logs warning and omits key for path traversal (no network call)", async () => {
    const result = await resolvePrompts(
      { classify: { file: "../../.env" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(mockOctokit.rest.repos.getContent).not.toHaveBeenCalled();
  });
```

Apply the same shape to the absolute-path and invalid-characters tests (change the `file`
value to `/etc/passwd` and `prompts/custom file.md` respectively). The
`expect(...).not.toHaveBeenCalled()` assertion still holds because `validatePath` throws
before any fetch.

Add one new test for the malformed-object case (the original blocker):

```ts
  it("logs warning and omits key for malformed entry without file", async () => {
    const result = await resolvePrompts(
      // @ts-expect-error — intentionally malformed config from YAML
      { classify: { path: "prompts/x.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(mockOctokit.rest.repos.getContent).not.toHaveBeenCalled();
  });
```

Add one new test for a non-404 octokit error:

```ts
  it("logs warning and omits key when octokit fails with non-404", async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue({
      status: 500,
      message: "Internal Server Error",
    });

    const result = await resolvePrompts(
      { reply: { file: "prompts/custom-reply.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
```

### Verify S1

```
npx vitest run test/prompts/resolver.test.ts
npx tsc --noEmit
```

All resolver tests pass; no type errors.

---

## Item M2 — Drop the silent format-suffix default

### Problem

`src/prompts/resolver.ts:71` does `const suffix = FORMAT_SUFFIXES[key] || "";`. The `|| ""`
silently ships a custom prompt with **no** format suffix if a key is ever missing from the map.
The PRD ("Further Notes") states suffix injection is "intentional and non-optional." A missing
suffix is a programming error and should surface, not silently degrade.

### Fix

This is already handled inside the Item S1 rewrite above:

```ts
      const suffix = FORMAT_SUFFIXES[key];
      if (suffix === undefined) {
        throw new Error(`No format suffix registered for prompt key: ${key}`);
      }
```

Because this lives inside the per-key `try/catch` from S1, a genuinely unknown key (only
reachable via a programming error, since `RawPromptsConfig` constrains the keys) logs a warning
and falls back rather than crashing — while still never silently emitting a suffix-less prompt.

If you are doing M2 independently of S1, at minimum replace line 71
`const suffix = FORMAT_SUFFIXES[key] || "";` with the explicit `undefined` check + throw above.

### Verify M2

Covered by the resolver suite. The existing test
`"appends correct format suffix for each key"` (lines 168-186) confirms every known key still
gets its suffix.

```
npx vitest run test/prompts/resolver.test.ts
```

---

## Item M1 — Make the `loadConfig` logger required

### Problem

`loadConfig()` declares `logger?: Logger` (optional) and builds an inline `noopLogger` that
swallows the resolver's warnings (`src/config/loader.ts:54-68`). Every production caller already
passes a real logger, so the optional parameter and the swallow-everything fallback only exist
for old tests — and they silently discard the User-Story-10 diagnostics.

### Fix

Make `logger` a required parameter and delete the inline no-op logger.

### File: `src/config/loader.ts`

Current signature (lines 6-13):

```ts
export async function loadConfig(
  owner: string,
  repo: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  octokit: any,
  configPath: string = ".forgejo/issue-ai.yml",
  logger?: Logger,
): Promise<RepoConfig> {
```

Change `logger?: Logger` to `logger: Logger` (required):

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

Note: `configPath` has a default value but now precedes a required `logger`. That is legal in
TypeScript (a parameter with a default is still optional positionally, but callers must pass a
value for `logger`). All current callers already pass `configPath` explicitly (see below), so
this is fine. Do not add a default to `logger`.

Current no-op logger block + call (lines 53-68):

```ts
  // Resolve prompts (file-based and inline)
  // Fallback no-op logger if none provided
  const noopLogger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => noopLogger,
  };
  const resolvedPrompts = await resolvePrompts(
    rawPrompts,
    owner,
    repo,
    octokit,
    logger ?? noopLogger,
  );
```

Replace with:

```ts
  // Resolve prompts (file-based and inline)
  const resolvedPrompts = await resolvePrompts(
    rawPrompts,
    owner,
    repo,
    octokit,
    logger,
  );
```

### Call sites — already correct, verify only

Both production callers already pass a logger; no edits needed, just confirm:

- `src/pipeline.ts:48` — `config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.configPath, log);`
- `src/comment-handler.ts:47` — `config = await loadConfig(actx.owner, actx.repo, actx.octokit, actx.configPath, actx.logger);`

### Tests — verify only, no edits expected

- `test/config.test.ts` — all four `loadConfig(...)` calls (lines 53, 78, 115, 140) already pass
  `mockLogger` as the 5th argument. No change needed.
- `test/pipeline.test.ts`, `test/comment-handler.test.ts`, `test/main.test.ts` — these mock the
  entire `loadConfig` module via `vi.fn()` (e.g. `test/pipeline.test.ts:50`,
  `test/comment-handler.test.ts:17`, `test/main.test.ts:89`), so they never call the real
  signature. No change needed.

If `npx tsc --noEmit` reports any call to `loadConfig` missing the `logger` argument, add the
caller's logger at that call site. Based on the current tree, none should appear.

### Verify M1

```
npx tsc --noEmit
npx vitest run test/config.test.ts test/pipeline.test.ts test/comment-handler.test.ts test/main.test.ts
```

No type errors; all listed suites pass.

---

## Item S3 — Update the PRD to allow case-insensitive prompt paths

### Problem

`src/prompts/resolver.ts:10` defines `PATH_REGEX = /^[a-z0-9_./-]+$/i;`. The `i` flag makes the
character class case-insensitive, so uppercase letters in paths are accepted. The PRD says
"Only relative paths with **lowercase** letters, digits, `-`, `_`, `.`, and `/` are accepted."
The code is intentionally more permissive; rather than tighten the code, update the PRD to match.

### Fix — documentation only, no code change

### File: `docs/prd/002-configurable-prompts.md`

Current "Path validation" section (lines 92-96):

```md
### Path validation

Prompt file paths are validated before fetching:
- Paths starting with `/` are rejected (absolute paths not allowed).
- Paths containing `..` segments are rejected (path traversal prevention).
- Only relative paths with lowercase letters, digits, `-`, `_`, `.`, and `/` are accepted.
```

Replace the last bullet (line 96) so it reads:

```md
- Only relative paths with letters (case-insensitive), digits, `-`, `_`, `.`, and `/` are accepted.
```

Do **not** change `PATH_REGEX` in the code. Leave the `/i` flag in place.

### Verify S3

No code or tests affected. Confirm the PRD bullet now matches the regex behavior (uppercase
allowed). Optionally add a positive resolver test confirming an uppercase path is accepted:

```ts
  it("accepts uppercase characters in file path", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from("Custom prompt").toString("base64"),
        type: "file",
      },
    });

    const result = await resolvePrompts(
      { classify: { file: "Prompts/Custom.md" } },
      "owner",
      "repo",
      mockOctokit,
      mockLogger,
    );

    expect(result!.classify).toContain("Custom prompt");
  });
```

---

## Final verification (all items)

Run the full suite and type-check:

```
npx tsc --noEmit
npx vitest run
```

Expected outcome:

- All tests pass.
- No type errors.
- Malformed/missing/oversized/error-prone prompt configs degrade to built-in defaults with a
  logged warning, never crashing triage (S1, M2).
- `loadConfig` requires a logger; no silent no-op swallowing warnings (M1).
- PRD path-validation wording matches the case-insensitive regex (S3).
