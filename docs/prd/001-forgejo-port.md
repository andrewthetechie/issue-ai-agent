# PRD 0001 — Port action from GitHub to Forgejo

## Problem Statement

The issue-ai-agent GitHub Action is tightly coupled to the GitHub platform. Users running self-hosted Forgejo instances cannot use it because it calls GitHub-specific APIs, hardcodes GitHub conventions (config paths, bot detection, branding), and is distributed through the GitHub Marketplace. A Forgejo-native fork is needed that works out of the box on any Forgejo instance with zero GitHub dependency.

## Solution

Fork the action to target Forgejo exclusively. Replace the one GitHub-incompatible API call (issue search) with a direct call to the Forgejo REST API. Wire the Octokit client to the Forgejo instance URL for all other API calls (which are already compatible). Update all naming, defaults, and conventions to be Forgejo-native. The feature set — classify, label, duplicate search, and reply — remains identical.

## User Stories

1. As a Forgejo instance operator, I want to install an AI issue triage action from a Forgejo-native source, so that I do not depend on GitHub infrastructure.
2. As a Forgejo repository maintainer, I want the action to work with zero configuration beyond adding a workflow file, so that I can start triaging issues immediately.
3. As a Forgejo repository maintainer, I want the action to read my config from `.forgejo/issue-ai.yml`, so that my config lives alongside my Forgejo Actions workflows.
4. As a Forgejo repository maintainer, I want the action's `forgejo-server-url` to default to `${{ github.server_url }}`, so that the action points at the correct Forgejo instance without manual configuration.
5. As a Forgejo repository maintainer, I want to pass a Forgejo token via `forgejo-token`, so that the input name makes clear what kind of token is expected.
6. As a Forgejo repository maintainer, I want the action to authenticate against the Forgejo API using `Authorization: token <TOKEN>`, so that all API calls succeed.
7. As a Forgejo repository maintainer, I want the action to classify newly opened issues into categories (bug, feature, question, docs, duplicate, invalid, security), so that issues are triaged automatically.
8. As a Forgejo repository maintainer, I want the action to apply labels based on classification results, so that issues are organised without manual effort.
9. As a Forgejo repository maintainer, I want the action to search for duplicate issues using the Forgejo search API, so that duplicate issues are flagged before a reply is posted.
10. As a Forgejo repository maintainer, I want duplicate search results scoped to the triggering repository only, so that issues from other repos on the same instance do not appear as false duplicates.
11. As a Forgejo repository maintainer, I want the action to post an AI-generated reply to newly opened issues, so that reporters receive an immediate acknowledgement.
12. As a Forgejo repository maintainer, I want the action to reply to follow-up comments on issues, so that conversations receive contextual AI responses.
13. As a Forgejo repository maintainer, I want the action to skip replying to comments authored by its own token identity (and to any account I list in `exclude.users`), so that the action does not reply to itself or to other bots — even when I run it under a personal access token, where Forgejo's platform-level recursion prevention does not apply.
14. As a Forgejo repository maintainer, I want to configure the action using the same YAML schema as before, so that I can adopt the fork without learning a new config format.
15. As a Forgejo repository maintainer, I want the action to fall back to a sensible default config when `.forgejo/issue-ai.yml` is absent, so that the action is useful before any config is written.
16. As a Forgejo repository maintainer, I want the action to output `category`, `priority`, `labels-applied`, and `reply-posted` for use in downstream workflow steps, so that I can build conditional logic on top of triage results.
17. As a Forgejo repository maintainer, I want the action to support both Anthropic and OpenAI as LLM providers, so that I can choose the model that fits my cost and capability needs.
18. As a Forgejo repository maintainer, I want to point the LLM client at a custom base URL, so that I can use a self-hosted or proxied model endpoint.

## Implementation Decisions

### API client strategy
Octokit (via `@actions/github`) is retained for all API calls except issue search. The `forgejo-server-url` action input (default: `${{ github.server_url }}`, which Forgejo Actions populates with the instance URL — see Further Notes) is read at startup and passed to Octokit as an **additive** option: `github.getOctokit(token, { baseUrl: \`${forgejoServerUrl}/api/v1\` })`. This is new wiring, not a change to an existing `baseUrl` (the current code calls `github.getOctokit(token)` with no options).

The action uses **four Octokit endpoints plus one direct `fetch`**:

| Endpoint | Transport | Call sites | Forgejo equivalent |
|---|---|---|---|
| create comment | Octokit (`issues.createComment`) | 2 (`pipeline.ts` reply, `comment-handler.ts` reply) | `POST /repos/{owner}/{repo}/issues/{index}/comments` |
| add labels | Octokit (`issues.addLabels`) | 1 (`labels.ts`, with per-label retry) | `POST /repos/{owner}/{repo}/issues/{index}/labels` |
| get repo content | Octokit (`repos.getContent`) | 1 (`config/loader.ts`) | `GET /repos/{owner}/{repo}/contents/{filepath}` (returns base64 `content` + `encoding`) |
| get authenticated user | Octokit (`users.getAuthenticated`) — **new** | 1 (`main.ts` startup, for the self-guard) | `GET /user` (returns `User.login`) |
| issue search | direct `fetch` (replaces Octokit) | 1 (`forgejo/search.ts`) | `GET /repos/issues/search` |

All four Octokit endpoints have confirmed matching paths and request/response shapes in `context/swagger.v1.json`. Octokit's default string-token auth already emits the `Authorization: token <TOKEN>` scheme that Forgejo requires, so the retained calls authenticate without change.

### Issue search replacement
The search module is replaced with a Forgejo-native implementation. The GitHub Octokit search call is replaced with a direct `fetch` to `GET ${serverUrl}/api/v1/repos/issues/search` with params `q=<keywords>&owner=<owner>&type=issues&state=open&limit=5`.

The GitHub-only query helper `buildSearchQuery` is replaced by `buildSearchKeywords`, which keeps the existing keyword extraction (strip punctuation, drop stop-words and words ≤2 chars, cap at 5 words) but returns **plain keywords only**. The GitHub search qualifiers it previously emitted — `repo:owner/repo`, `is:issue`, `is:open`, `in:title` — are dropped because Forgejo's `q` is a free-text query, not GitHub search syntax. Their intent is preserved by other means: `is:issue` → `type=issues`; `is:open` → `state=open` (which is also Forgejo's default for this endpoint, so the original "open issues only" semantics hold regardless); `repo:owner/repo` → `owner=<owner>` param plus the client-side `full_name` filter below (the endpoint offers an `owner` filter but no repo-name filter).

Results are filtered client-side by `repository.full_name === "${owner}/${repo}"` to scope results to the triggering repo only, with the triggering issue number and any pull requests excluded. Authentication uses `Authorization: token <TOKEN>` (Forgejo's required header format, not Bearer).

### ActionContext changes
`ActionContext` gains two new fields: `botLogin: string` (used by the comment handler's self-guard) and retains the existing fields. The token is intentionally **not** stored on `ActionContext` to avoid latent credential leaks if the context is ever logged, serialized, or debug-dumped. Instead, `serverUrl` and `token` are threaded as explicit parameters to `runPipeline` and then to `searchSimilarIssues`. The comment handler receives `ActionContext` but does not read `token` or `serverUrl`.

`botLogin` is resolved once at startup via `octokit.rest.users.getAuthenticated()` (`GET /user`), which returns the login of the identity backing the token. If this call fails, the action fails (`core.setFailed`) rather than continuing without an identity — identity resolution is treated as a hard precondition. This means the issue-triage path also depends on `GET /user` succeeding, which is an accepted simplification (single startup identity resolution) given the auto token can always read `/user`.

### Bot-comment guard
The `sender.type === "Bot"` check is removed. Forgejo's User object has **no `type` field** (confirmed against `context/swagger.v1.json`), so the original check was inert on Forgejo. It is replaced with a **self-identity guard**: the handler returns early when `sender.login === actx.botLogin`, or when `config.exclude.users` includes `sender.login`.

The previously proposed `[bot]` suffix heuristic is **not** used: it is a GitHub-App naming convention with no documented Forgejo equivalent (the swagger spec contains no `[bot]` reference), and it would neither catch Forgejo's own actions identity nor a maintainer's PAT.

The primary defense against the action replying to itself is Forgejo's platform-level recursion prevention (see Further Notes): a comment authored with the workflow's automatic token does not trigger another `issue_comment` workflow. The self-identity guard is defense-in-depth that additionally covers the personal-access-token case, where that platform prevention does not apply. A consequence: when the action runs under a maintainer's own PAT, the maintainer's own comments (same login as the token) are also skipped — intended, as it prevents the loop for PAT setups.

### Directory and type renames
- `src/github/` directory renamed to `src/forgejo/`
- `GitHubIssue` interface renamed to `Issue`
- All import paths updated accordingly

### `action.yml` changes
- `name`: "Issue AI Agent for Forgejo"
- `description`: updated to reference Forgejo instead of GitHub
- `author`: updated to fork maintainer
- `github-token` input renamed to `forgejo-token` (description updated; default `${{ github.token }}` unchanged)
- New `forgejo-server-url` input added (default: `${{ github.server_url }}`)
- `config-path` default changed to `.forgejo/issue-ai.yml`

### Config loader fallback
The hardcoded fallback path in `loadConfig` is updated from `.github/issue-ai.yml` to `.forgejo/issue-ai.yml` to match the `action.yml` default.

### LLM prompt strings
All system prompt strings updated to reference "Forgejo Issue" instead of "GitHub Issue". The phrase "GitHub-flavored Markdown" is retained as it names a real format specification.

## Testing Decisions

A good test exercises the module's public interface and asserts on observable outputs (return values, HTTP calls made, headers sent) — not internal implementation details like helper function existence or intermediate variable names.

### Search module
The existing search tests are **augmented, not replaced wholesale**. The current file only tests the pure keyword helper; that coverage is kept (renamed to `buildSearchKeywords`) and new network tests are added.

Keyword tests (kept, adapted from the existing `buildSearchQuery` tests):
- Stop-words and words ≤2 chars are dropped
- Output is capped at 5 keywords
- Special characters are stripped
- The output contains **no** GitHub qualifiers (`repo:`, `is:issue`, `is:open`, `in:title`)

Network tests (new — mock `fetch` globally) assert:
- The correct Forgejo endpoint URL is constructed from `serverUrl` (`${serverUrl}/api/v1/repos/issues/search`)
- The `Authorization: token <TOKEN>` header is present
- The `q`, `owner`, `type=issues`, and `state=open` query parameters are correct
- Issues where `repository.full_name` does not match `owner/repo` are filtered out of results
- The triggering issue number is excluded from results
- Pull requests are excluded from results

Prior art: existing `test/search.test.ts` (keep keyword tests, add fetch tests).

### Comment handler self-guard
Replace the existing bot-sender test in `test/comment-handler.test.ts` with self-identity-guard tests. The handler now reads `actx.botLogin` (resolved at startup); tests set it on the fixture context:
- When `sender.login === actx.botLogin`, assert the handler returns early without posting a comment (own-comment case)
- When `config.exclude.users` includes `sender.login`, assert the handler returns early (third-party bot case)
- Negative case: a `sender.login` that is neither `botLogin` nor in `exclude.users` proceeds and posts a reply

The startup `GET /user` call (`octokit.rest.users.getAuthenticated`) is mocked where the comment handler is exercised end-to-end; its failure-fails-the-action behavior is covered in `main`/startup tests rather than the handler unit test.

Prior art: existing bot-sender test block in `test/comment-handler.test.ts` (currently uses `sender: { type: "Bot" }`).

### Octokit `baseUrl` wiring
Not unit tested. It is a single additive option on `getOctokit` and is only meaningful against a live Forgejo instance. Integration validation is sufficient.

### Startup identity resolution (`GET /user`)
Covered in startup/`main` tests: assert `botLogin` is populated from the mocked `users.getAuthenticated` response and threaded onto `ActionContext`, and that a rejected `getAuthenticated` results in `core.setFailed` (action fails) rather than silent continuation.

## Out of Scope

- Supporting both GitHub and Forgejo in the same action — this fork is Forgejo-only
- Changes to the LLM provider system (Anthropic/OpenAI support unchanged)
- Changes to the classification, labeling, reply, or duplicate-detection logic
- GitHub Marketplace listing or branding beyond updating `action.yml` metadata
- Documentation updates (README, demo GIF)
- Any Forgejo-specific features not present in the original (e.g. Forgejo-native webhooks, reactions)

## Further Notes

The Forgejo REST API version this implementation targets is documented in `context/swagger.v1.json` in the repository root. API compatibility questions should be verified against that file rather than the Forgejo documentation website, which may reflect a different version. (The bundled spec self-identifies as `15.0.2+gitea-1.22.0` — a Gitea-lineage spec; treat Forgejo-vs-Gitea drift in runtime behavior, distinct from API shape, as still worth live confirmation.)

The `GITHUB_TOKEN` environment variable fallback in the entry point is intentionally retained — Forgejo Actions runners set this variable under the same name (also exposed as `FORGEJO_TOKEN`), as the workflow's automatic token.

### Resolved platform assumptions (Forgejo Actions docs)

These three assumptions were confirmed against the official Forgejo Actions documentation (`forgejo.org/docs/latest/user/actions/`), resolving the open questions from the PRD review:

1. **Server URL** — Forgejo Actions sets `GITHUB_SERVER_URL` (and `FORGEJO_SERVER_URL`) to the URL of the Forgejo instance running the workflow. The `github` context's `server_url` therefore points at the instance, so the `forgejo-server-url` default of `${{ github.server_url }}` is correct.
2. **Automatic token** — The automatic token is created for the duration of the workflow and has write permission to the repository; it is exposed as both `GITHUB_TOKEN` and `FORGEJO_TOKEN`. This is the identity that `GET /user` resolves into `botLogin`.
3. **Recursion prevention** — Per the *basic concepts* page, verbatim: "In order to avoid infinite recursion, no workflow will be triggered as a side effect of a change authored with this token." So a comment the action posts with the automatic token does not fire another `issue_comment` run. This is the primary reason the bot-comment guard was redesigned (see *Bot-comment guard*): self-looping is impossible under the auto token at the platform level, and the self-identity guard exists only to cover personal-access-token setups, where this prevention does not apply.
