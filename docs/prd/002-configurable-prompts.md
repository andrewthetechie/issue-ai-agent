# PRD 0002 — Configurable system prompts

## Problem Statement

The system prompts that instruct the LLM how to classify, reply, detect duplicates, and respond to comments are hardcoded in `src/prompts/`. Repository maintainers who want to customise the agent's behaviour — for example, to add project-specific triage criteria, change the tone of replies, or adapt the classification categories — must fork the entire action. There is no way to override prompts through the repo's config file.

## Solution

Add a `prompts` section to the repo config (`.forgejo/issue-ai.yml`) that lets maintainers override any system prompt. Each prompt can be provided either inline as a YAML multiline string or as a path to a plain-text file in the repo. For prompts that require structured output (classify, duplicate), a format suffix is always appended to guarantee the downstream parser receives the expected JSON shape — even when the prompt body is entirely custom.

## User Stories

1. As a repository maintainer, I want to override the classify system prompt in my repo config, so that I can add project-specific triage criteria without forking the action.
2. As a repository maintainer, I want to override the reply system prompt, so that I can customise the tone and content of AI-generated replies to match my project's voice.
3. As a repository maintainer, I want to override the duplicate detection system prompt, so that I can tune what the agent considers a duplicate for my project.
4. As a repository maintainer, I want to override the comment reply system prompt, so that I can customise how the agent responds to follow-up comments.
5. As a repository maintainer, I want to write a custom prompt inline in my YAML config using a multiline string, so that short customisations don't require a separate file.
6. As a repository maintainer, I want to store a custom prompt in a separate file and reference it from my config, so that long prompts stay readable and can be versioned independently.
7. As a repository maintainer, I want to override only some prompts and keep the defaults for others, so that I only customise what matters to my project.
8. As a repository maintainer, I want the classify prompt to always produce valid JSON output even when I supply a custom prompt, so that the labelling and reply pipeline does not break.
9. As a repository maintainer, I want the duplicate detection prompt to always produce valid JSON output even when I supply a custom prompt, so that duplicate detection does not break.
10. As a repository maintainer, I want a clear warning in the logs when my prompt file path is wrong, so that I can quickly diagnose why my custom prompt is not being applied.
11. As a repository maintainer, I want the action to fall back to the built-in prompt when my prompt file is missing, so that a misconfigured path does not break the entire triage pipeline.
12. As a repository maintainer, I want prompt file paths to be relative to the repo root, so that I can organise prompt files in a dedicated directory (e.g. `prompts/`) alongside my config.

## Implementation Decisions

### Config shape

A top-level `prompts` object is added to the repo config. Each key corresponds to a promptable feature. Each value is either a plain string (inline prompt) or an object with a `file` key (path to a plain-text file, relative to repo root):

```yaml
prompts:
  classify: |
    You are a triage bot for my project...
  reply:
    file: prompts/custom-reply.md
  duplicate: |
    Custom duplicate detection instructions...
  commentReply:
    file: prompts/custom-comment-reply.md
```

The four keys are `classify`, `reply`, `duplicate`, and `commentReply`. The key `comment_reply` (snake_case) is also accepted as an alias for `commentReply`, consistent with the existing config's snake_case support for compound keys (e.g. `label_mapping`, `max_issue_length`).

### Type additions

`types.ts` gains:

- `PromptConfigEntry = string | { file: string }` — the raw YAML shape for a single prompt entry.
- `RawPromptsConfig` — a record of the four prompt keys mapped to `PromptConfigEntry | undefined`, representing the unresolved config from YAML.
- `RepoConfig.prompts` — `Record<string, string> | undefined`, containing the fully resolved prompt strings after loading. `undefined` means no overrides; a string value means "use this instead of the built-in default."

### Format suffix extraction

Each file in `src/prompts/` currently exports a single monolithic string constant (e.g. `CLASSIFY_SYSTEM_PROMPT`) that includes both the prompt body and the format instruction. Each file will be split into two exports:

- `CLASSIFY_SYSTEM_PROMPT` — the full prompt (unchanged, for backward compatibility). Constructed as `CLASSIFY_PROMPT_BODY + CLASSIFY_FORMAT_SUFFIX`.
- `CLASSIFY_FORMAT_SUFFIX` — the format instruction alone (e.g. the JSON schema block at the end of the classify prompt).
- `CLASSIFY_PROMPT_BODY` — the prompt body without the format suffix (new).

The same split applies to `reply.ts`, `duplicate.ts`, and `comment-reply.ts`. For reply and comment-reply, the format suffix is lighter weight (e.g. "Reply with ONLY the comment text in plain Markdown. Do not wrap in code blocks.") but still enforced.

### Prompt resolver

A new module `src/prompts/resolver.ts` exports `resolvePrompts()`, which takes the raw `prompts` section from the YAML config and returns a flat `Record<string, string>` of resolved prompt strings (or `undefined` if no prompts were configured). It:

1. Iterates each key in the raw config.
2. For inline strings: trims whitespace and uses the string directly.
3. For `file:` entries: validates the path (no `..` segments, no leading `/`), fetches the file via `octokit.rest.repos.getContent()`, decodes the base64 content, caps at 75KB (truncates with a warning if exceeded), and uses the file content.
4. Appends the appropriate format suffix to every resolved prompt.
5. On missing file: logs a clear warning naming the missing file and the prompt key, and falls back to the built-in default (by returning `undefined` for that key rather than an empty string).

The resolver imports each `*_FORMAT_SUFFIX` from the prompt files so the suffix is a single source of truth.

### Config loader integration

`loadConfig()` in `src/config/loader.ts` calls `resolvePrompts()` after parsing the YAML and merges the result into the returned `RepoConfig`. The snake_case alias `comment_reply` is normalised to `commentReply` before resolution. The resolved prompts are stored as `config.prompts` (flat string record).

### Consumer integration

Each consumer that currently imports a prompt constant changes to an inline fallback:

- `classifier.ts`: `config.prompts?.classify ?? CLASSIFY_SYSTEM_PROMPT`
- `replier.ts`: `config.prompts?.reply ?? REPLY_SYSTEM_PROMPT`
- `duplicate.ts`: `config.prompts?.duplicate ?? DUPLICATE_SYSTEM_PROMPT`
- `comment-handler.ts`: `config.prompts?.commentReply ?? COMMENT_REPLY_SYSTEM_PROMPT`

No function signatures change. The `config` object is already available at every call site.

### Path validation

Prompt file paths are validated before fetching:
- Paths starting with `/` are rejected (absolute paths not allowed).
- Paths containing `..` segments are rejected (path traversal prevention).
- Only relative paths with lowercase letters, digits, `-`, `_`, `.`, and `/` are accepted.

### Prompt file format

Files referenced via `file:` are read as plain text. The entire file content is the prompt body. No YAML wrapping, no frontmatter, no interpolation — the file content is used verbatim (before the format suffix is appended).

## Testing Decisions

A good test exercises a module's public interface and asserts on observable outputs — return values, log messages, and network calls made — not internal implementation details.

### Prompt resolver (`test/prompts/resolver.test.ts` — new)

The resolver is the primary new seam. Tests mock `octokit.rest.repos.getContent` to control file-fetching behaviour:

- **Inline prompt**: resolving an inline string returns the trimmed string with the correct format suffix appended.
- **File prompt (happy path)**: resolving `{ file: "prompts/custom.md" }` fetches the file via octokit and returns the content with the format suffix appended.
- **Missing file**: resolving `{ file: "prompts/missing.md" }` when octokit returns 404 logs a warning and returns `undefined` for that key (not the full default — just absent from the resolved record).
- **Path traversal**: resolving `{ file: "../../.env" }` rejects the path without making a network call.
- **Absolute path**: resolving `{ file: "/etc/passwd" }` rejects the path without making a network call.
- **Oversized file**: resolving a file whose content exceeds 75KB truncates the content and logs a warning.
- **Format suffix injection**: each prompt key gets the correct suffix appended (classify gets JSON schema, duplicate gets JSON schema, reply gets markdown-only instruction, commentReply gets markdown-only instruction).
- **No prompts configured**: `undefined` input returns `undefined` output.
- **Mixed inline and file**: a config with both inline and file-based prompts resolves both correctly.

Prior art: `test/config.test.ts` (config-level tests), `test/classifier.test.ts` (mock-based unit tests).

### Config loader (`test/config.test.ts` — augmented)

Add tests to the existing config test file:

- Config with inline prompts returns resolved strings in `config.prompts`.
- Config with `file:` prompts resolves files and returns resolved strings.
- Config with `comment_reply` (snake_case) is normalised to `commentReply`.
- Config with no `prompts` section returns `prompts: undefined`.

Prior art: existing `test/config.test.ts` (tests `DEFAULT_CONFIG` and config loading).

### Consumer fallback

No new tests needed for consumers. The one-line change (`config.prompts?.classify ?? CLASSIFY_SYSTEM_PROMPT`) is covered by existing tests if the mock config objects include a `prompts` field. Verify that existing tests in `test/classifier.test.ts`, `test/replier.test.ts`, `test/duplicate.test.ts`, and `test/comment-handler.test.ts` still pass with the updated config shape.

## Out of Scope

- User message templates — the functions that build the user message (`buildReplyUserMessage`, `buildDuplicateUserMessage`, etc.) remain hardcoded. Only system prompts are configurable.
- Prompt versioning or migration — no mechanism to version or migrate prompts between config versions.
- Dynamic prompt selection based on issue properties — prompts are static per-repo, not conditional on issue category, labels, or author.
- Prompt preview or validation UI — no way to test a prompt before committing it to the repo.
- Local filesystem prompt loading — prompts are only fetched from the repo via the API, never from the local filesystem.

## Further Notes

The 75KB cap on prompt files is generous — roughly 15,000 words — but prevents accidental context-blowup from a misconfigured file path that points to a large source file or data dump.

The format suffix injection is intentional and non-optional. The downstream parsers (`parseClassificationResponse`, `parseDuplicateResponse`) are resilient to malformed JSON (they fall back to safe defaults), but the suffix ensures the LLM is explicitly instructed to produce the expected shape, reducing silent degradation.

The `CLASSIFY_SYSTEM_PROMPT` export is preserved for backward compatibility and as the default when no custom prompt is configured. Code that imports it directly (e.g. tests, documentation) continues to work unchanged.
