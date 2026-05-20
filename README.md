# Issue AI Agent

AI-powered GitHub Issue triage Action — automatically classifies, labels, and replies to new issues.

> **Status**: Phase 1 (Classification + Auto-Reply). GitHub Action, BYOK (Bring Your Own Key).

## What It Does

When someone opens an issue in your repository, Issue AI Agent:

1. **Classifies** the issue into a category (bug, feature, question, docs, duplicate, invalid, security)
2. **Labels** it with matching labels and a priority level (critical, high, medium, low)
3. **Detects duplicates** by searching existing issues and linking potential matches
4. **Replies** with a contextual comment — bugs get asked for reproduction steps, features get acknowledged, etc.
5. **Handles follow-up comments** — replies to user comments with relevant information

All in ~8 seconds, powered by Claude or GPT.

## Demo

**User submits an issue:**

> **Login page crashes on Chrome** · opened by @user123
>
> When I click the login button on Chrome 120, the page goes blank.
> This only happens after the latest deploy.

**Bot responds automatically (~8s):**

> **Issue AI Agent** :robot: commented
>
> Thanks for reporting this crash! I've classified and labeled this issue.
>
> To help us reproduce, could you provide:
> - Chrome version and OS
> - Any console error messages
> - Steps to reproduce
>
> -- Issue AI Agent :robot:

**Labels added:** `bug`, `priority:high`

**Duplicate detected?** The bot also searches existing issues and links potential duplicates in the reply.

**User follows up with more info:**

> @user123 commented
>
> I'm on Chrome 120.0.6099.130, macOS Sonoma. Console shows `TypeError: Cannot read properties of null`.

**Bot replies to the comment:**

> **Issue AI Agent** :robot: commented
>
> Thanks for the details! The `TypeError: Cannot read properties of null` suggests the login handler may be receiving an undefined state after the deploy. We'll investigate.
>
> -- Issue AI Agent :robot:

## Quick Start

### Step 1: Add a workflow file

Create `.github/workflows/issue-ai.yml` in your repository:

```yaml
name: Issue AI Agent

on:
  issues:
    types: [opened]
  issue_comment:
    types: [created]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read
    steps:
      - uses: alexyan0431/issue-ai-agent@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Step 2: Add your API key as a repository secret

Go to **Settings > Secrets and variables > Actions > New repository secret**:

- Name: `ANTHROPIC_API_KEY`
- Value: your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))

### Step 3: Open an issue

That's it. The bot will automatically classify, label, and reply to new issues.

## Configuration

Create `.github/issue-ai.yml` in your repository to customize behavior. The bot works out of the box with sensible defaults — no config file required.

```yaml
# .github/issue-ai.yml
enabled: true

features:
  classify: true        # Auto-classify issues
  reply: true           # Post AI-drafted replies
  duplicateSearch: true  # Detect duplicate issues
  commentReply: true     # Reply to follow-up comments

label_mapping:
  bug: ["bug"]
  feature: ["enhancement"]
  question: ["question"]
  docs: ["documentation"]
  duplicate: ["duplicate"]
  invalid: ["invalid"]
  security: ["security"]

security:
  max_issue_length: 10000    # Max chars of issue body to process

exclude:
  labels: ["wontfix", "skip-ai"]       # Skip issues with these labels
  users: ["dependabot[bot]"]           # Skip issues from these users

llm:
  provider: anthropic                   # "anthropic" or "openai"
  model: claude-haiku-4-5-20251001     # Model to use
  max_tokens: 2048                      # Max tokens per LLM response
```

### Config Reference

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Master on/off switch |
| `features.classify` | `true` | Enable issue classification + labeling |
| `features.reply` | `true` | Enable AI-drafted reply comments |
| `features.duplicateSearch` | `true` | Search for duplicate issues and link them |
| `features.commentReply` | `true` | Reply to follow-up comments on issues |
| `label_mapping` | *(see defaults above)* | Maps AI categories to your repo's label names |
| `security.max_issue_length` | `10000` | Truncate issue body beyond this length |
| `exclude.labels` | `["wontfix", "skip-ai"]` | Skip issues carrying these labels |
| `exclude.users` | `["dependabot[bot]"]` | Skip issues opened by these users |
| `llm.provider` | `"anthropic"` | LLM provider: `"anthropic"` or `"openai"` |
| `llm.model` | `claude-haiku-4-5-20251001` | Model identifier (use `gpt-4o-mini` for OpenAI) |
| `llm.max_tokens` | `2048` | Max tokens for LLM responses |

## Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | No | `${{ github.token }}` | GitHub token for API access |
| `anthropic-api-key` | No | | Anthropic API key for Claude |
| `openai-api-key` | No | | OpenAI API key |
| `llm-provider` | No | `anthropic` | Which LLM provider to use |
| `llm-base-url` | No | | Custom base URL for LLM API (applies to selected provider) |
| `config-path` | No | `.github/issue-ai.yml` | Path to config file in repo |

At least one API key is required. If neither is set, the bot runs in **dev mode** with mock responses.

### Action Outputs

| Output | Description |
|--------|-------------|
| `category` | Classified issue category |
| `priority` | Classified issue priority |
| `labels-applied` | Comma-separated list of applied labels |
| `reply-posted` | Whether a reply comment was posted |

## Using OpenAI

```yaml
steps:
  - uses: alexyan0431/issue-ai-agent@v1
    with:
      openai-api-key: ${{ secrets.OPENAI_API_KEY }}
      llm-provider: openai
```

### Using OpenAI-compatible APIs (GLM, DeepSeek, etc.)

```yaml
steps:
  - uses: alexyan0431/issue-ai-agent@v1
    with:
      openai-api-key: ${{ secrets.LLM_API_KEY }}
      llm-provider: openai
      llm-base-url: https://open.bigmodel.cn/api/paas/v4
```

And in `.github/issue-ai.yml`:

```yaml
llm:
  provider: openai
  model: gpt-4o-mini
```

### Using Anthropic-compatible APIs (GLM via cc-switch, etc.)

```yaml
steps:
  - uses: alexyan0431/issue-ai-agent@v1
    with:
      anthropic-api-key: ${{ secrets.LLM_API_KEY }}
      llm-provider: anthropic
      llm-base-url: https://open.bigmodel.cn/api/anthropic
```

And in `.github/issue-ai.yml`:

```yaml
llm:
  provider: anthropic
  model: glm-5
```

## Development

```bash
npm ci              # Install dependencies
npm run build       # Compile TypeScript
npm run bundle      # Bundle for GitHub Action (dist/index.js)
npm test            # Run tests (Vitest)
npm run test:watch  # Watch mode
npm run dev         # TypeScript watch mode
```

### Architecture

```
GitHub Action (issues.opened / issue_comment.created)
  → loadConfig()    — Fetch .github/issue-ai.yml via GitHub API
  → shouldExclude() — Check exclude rules
  → classify        — LLM classifies the issue (category + priority)
  → label           — Maps classification to repo labels via GitHub API
  → duplicate       — Searches similar issues, LLM confirms duplicates
  → reply           — Drafts and posts a contextual comment via LLM
```

Key design decisions:
- **Stateless** — no database; reads config from each repo's `.github/issue-ai.yml`
- **Error-resilient** — each pipeline step catches its own errors, so a classification failure doesn't block the reply
- **Security-first** — input sanitization (zero-width chars, control chars, length limits) + explicit untrusted-data markers in prompts

## License

[MIT](LICENSE)
