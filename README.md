<div align="center">

# ⚡ Issue AI Agent

**AI-powered Forgejo Issue triage — classify, label, and reply automatically**

[![Forgejo Action](https://img.shields.io/github/actions/workflow/status/andrewthetechie/issue-ai-agent/ci.yml?branch=main&label=CI&logo=github-actions&logoColor=white)](https://github.com/andrewthetechie/issue-ai-agent/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

## What It Does

When someone opens an issue in your repository, Issue AI Agent:

1. **Classifies** the issue into a category (bug, feature, question, docs, duplicate, invalid, security)
2. **Labels** it with matching labels and a priority level (critical, high, medium, low)
3. **Detects duplicates** by searching existing issues and linking potential matches
4. **Replies** with a contextual comment — bugs get asked for reproduction steps, features get acknowledged, etc.
5. **Handles follow-up comments** — replies to user comments with relevant information

Powered by your LLM of choice.

## Demo

![Demo: Issue AI Agent classifying and replying to a new issue](docs/demo.gif)

1. **User opens an issue** — describes a login page crash
2. **Bot classifies** — labels it `bug` / `priority: high` in ~8 seconds
3. **Bot replies** — asks for reproduction details
4. **Duplicate check** — searches existing issues and links potential matches
5. **Follow-up comments** — replies to user comments with relevant info

## Quick Start

### Step 1: Add a workflow file

Create `.forgejo/workflows/issue-ai.yml` in your repository:

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
      - uses: andrewthetechie/issue-ai-agent@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Step 2: Add your API key

Go to **Settings > Secrets and variables > Actions > New repository secret**:

- Name: `ANTHROPIC_API_KEY`
- Value: your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))

### Step 3: Open an issue

That's it. The bot will automatically classify, label, and reply to new issues.

## LLM Providers

The bot supports any Anthropic or OpenAI API. Use the three inputs — `<provider>-api-key`, `llm-provider`, and `llm-base-url` — to match your setup.

### Anthropic

```yaml
- uses: andrewthetechie/issue-ai-agent@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    llm-provider: anthropic
```

### OpenAI

```yaml
- uses: andrewthetechie/issue-ai-agent@v1
  with:
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    llm-provider: openai
```

### Custom API endpoint

If your provider exposes an Anthropic or OpenAI compatible API, point `llm-base-url` to its address:

```yaml
# Anthropic-compatible endpoint
- uses: andrewthetechie/issue-ai-agent@v1
  with:
    anthropic-api-key: ${{ secrets.LLM_API_KEY }}
    llm-provider: anthropic
    llm-base-url: https://your-provider.example.com/api/anthropic
```

```yaml
# OpenAI-compatible endpoint
- uses: andrewthetechie/issue-ai-agent@v1
  with:
    openai-api-key: ${{ secrets.LLM_API_KEY }}
    llm-provider: openai
    llm-base-url: https://your-provider.example.com/v1
```

If you use a custom model, create `.forgejo/issue-ai.yml` in your repo to specify it:

```yaml
llm:
  model: your-model-name
```

## Configuration

Create `.forgejo/issue-ai.yml` in your repository to customize behavior. The bot works out of the box with sensible defaults — no config file required.

```yaml
# .forgejo/issue-ai.yml
enabled: true
create_labels: false          # Auto-create missing labels (opt-in)

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

priority_label_mapping:
  critical: ["priority: critical"]
  high: ["priority: high"]
  medium: ["priority: medium"]
  low: ["priority: low"]

security:
  max_issue_length: 10000    # Max chars of issue body to process

exclude:
  labels: ["wontfix", "skip-ai"]       # Skip issues with these labels
  users: ["dependabot[bot]"]           # Skip issues from these users

llm:
  provider: anthropic                   # "anthropic" or "openai"
  model: claude-haiku-4-5-20251001     # Model to use
  max_tokens: 2048                      # Max tokens per LLM response

prompts:
  classify: |                           # Override the classification prompt
    You are a triage bot for my project...
  reply:
    file: prompts/custom-reply.md       # Or reference a file (relative to repo root)
  duplicate: |                          # Override duplicate detection prompt
    Custom duplicate detection instructions...
  commentReply:                         # Override comment reply prompt
    file: prompts/custom-comment-reply.md
```

> **Note:** File paths in `prompts` are resolved relative to the repository root. Paths with `..` segments or absolute paths are rejected. If a prompt file is missing, the action logs a warning and falls back to the built-in default. Prompt files are capped at 75 KB. For prompts that require structured output (`classify`, `duplicate`), a format suffix is always appended to guarantee valid JSON — even when the prompt body is entirely custom.

### Config Reference

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Master on/off switch |
| `create_labels` | `false` | Auto-create missing labels before applying them (opt-in) |
| `features.classify` | `true` | Enable issue classification + labeling |
| `features.reply` | `true` | Enable AI-drafted reply comments |
| `features.duplicateSearch` | `true` | Search for duplicate issues and link them |
| `features.commentReply` | `true` | Reply to follow-up comments on issues |
| `label_mapping` | *(see defaults above)* | Maps AI categories to your repo's label names |
| `priority_label_mapping` | *(see defaults above)* | Maps AI priority levels to your repo's priority label names |
| `security.max_issue_length` | `10000` | Truncate issue body beyond this length |
| `exclude.labels` | `["wontfix", "skip-ai"]` | Skip issues carrying these labels |
| `exclude.users` | `["dependabot[bot]"]` | Skip issues opened by these users |
| `llm.provider` | `"anthropic"` | LLM provider: `"anthropic"` or `"openai"` |
| `llm.model` | `claude-haiku-4-5-20251001` | Model identifier |
| `llm.max_tokens` | `2048` | Max tokens for LLM responses |
| `prompts.classify` | *(built-in default)* | Custom system prompt for issue classification. Accepts an inline YAML multiline string or `{ file: "path/to/prompt.md" }` |
| `prompts.reply` | *(built-in default)* | Custom system prompt for AI-drafted replies. Same inline-or-file format |
| `prompts.duplicate` | *(built-in default)* | Custom system prompt for duplicate detection. Same inline-or-file format |
| `prompts.commentReply` | *(built-in default)* | Custom system prompt for follow-up comment replies. Same inline-or-file format. Also accepts `comment_reply` (snake_case) as an alias |

### Priority Label Mapping

By default, the bot applies priority labels like `priority: high` and `priority: critical`. Use `priority_label_mapping` to customize these to match your repository's labelling convention.

**Default behaviour** (when the key is absent):

```yaml
priority_label_mapping:
  critical: ["priority: critical"]
  high: ["priority: high"]
  medium: ["priority: medium"]
  low: ["priority: low"]
```

**Full custom mapping** — replace with your own label names:

```yaml
priority_label_mapping:
  critical: ["P0"]
  high: ["P1"]
  medium: ["P2"]
  low: ["P3"]
```

**Multiple labels per priority** — apply more than one label for a given priority:

```yaml
priority_label_mapping:
  critical: ["P0", "urgent"]
  high: ["P1"]
  medium: ["P2"]
  low: ["P3"]
```

**Suppress a single priority tier** — omit a key or set it to an empty array:

```yaml
priority_label_mapping:
  critical: ["P0"]
  high: ["P1"]
  medium: ["P2"]
  # low is omitted — no label will be applied for low-priority issues
```

**Disable all priority labels** — set the mapping to an empty object:

```yaml
priority_label_mapping: {}
```

> **Note:** Unknown keys (e.g. `urgent`) in `priority_label_mapping` or `label_mapping` trigger a warning log but do not abort the workflow. Only the well-known keys (`critical`, `high`, `medium`, `low` for priority; `bug`, `feature`, `question`, `docs`, `duplicate`, `invalid`, `security` for labels) are recognized.

### Create Labels

By default, the bot only applies labels that already exist in your repository. If a label referenced by your `label_mapping` or `priority_label_mapping` doesn't exist, the application silently skips it.

Set `create_labels: true` to have the bot automatically create any missing labels before classification:

- **Opt-in:** Default is `false`; existing deployments are unaffected.
- **Creates the deduplicated union** of all `label_mapping` + `priority_label_mapping` values (uses defaults if unset). For the default config: `bug, enhancement, question, documentation, duplicate, invalid, security, priority: critical, priority: high, priority: medium, priority: low`.
- **Idempotent:** Runs once before classification per `issues` event. On steady state (all labels present), it makes one list call and zero creates.
- **Best-effort & non-fatal:** If the token lacks label-write permission (`write:issue`) or a single create fails, it's logged as a warning and the rest of the pipeline still runs.
- **Neutral styling:** Created labels get a grey colour (`#ededed`) and no description. Existing labels are never recoloured or modified.
- **Issues only:** Applies to the `issues` event path, not issue comments.

## Action Inputs & Outputs

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `forgejo-token` | No | `${{ github.token }}` | Forgejo token for API access |
| `forgejo-server-url` | No | `${{ github.server_url }}` | URL of the Forgejo instance |
| `anthropic-api-key` | No | | Anthropic API key |
| `openai-api-key` | No | | OpenAI API key |
| `llm-provider` | No | `anthropic` | Which LLM provider to use |
| `llm-base-url` | No | | Custom base URL for LLM API (applies to selected provider) |
| `config-path` | No | `.forgejo/issue-ai.yml` | Path to config file in repo |

At least one API key is required. If neither is set, the bot runs in **dev mode** with mock responses.

### Outputs

| Output | Description |
|--------|-------------|
| `category` | Classified issue category |
| `priority` | Classified issue priority |
| `labels-applied` | Comma-separated list of applied labels |
| `reply-posted` | Whether a reply comment was posted |

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
Forgejo Action (issues.opened / issue_comment.created)
  → loadConfig()    — Fetch .forgejo/issue-ai.yml via Forgejo API
  → shouldExclude() — Check exclude rules
  → classify        — LLM classifies the issue (category + priority)
  → label           — Maps classification to repo labels via Forgejo API
  → duplicate       — Searches similar issues, LLM confirms duplicates
  → reply           — Drafts and posts a contextual comment via LLM
```

Key design decisions:
- **Stateless** — no database; reads config from each repo's `.forgejo/issue-ai.yml`
- **Error-resilient** — each pipeline step catches its own errors, so a classification failure doesn't block the reply
- **Security-first** — input sanitization (zero-width chars, control chars, length limits) + explicit untrusted-data markers in prompts

## License

[MIT](LICENSE)
