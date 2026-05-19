# Issue AI Agent

AI-powered GitHub Issue triage bot — automatically classifies, labels, and replies to new issues.

> **Status**: Phase 1 MVP (Classification + Auto-Reply). Self-hosted, BYOK (Bring Your Own Key).

## What It Does

When someone opens an issue in your repository, Issue AI Agent:

1. **Classifies** the issue into a category (bug, feature, question, docs, duplicate, invalid, security)
2. **Labels** it with matching labels and a priority level (critical, high, medium, low)
3. **Replies** with a contextual comment — bugs get asked for reproduction steps, features get acknowledged, etc.

All in ~8 seconds, powered by Claude.

## Quick Start

### Prerequisites

- Node.js >= 20.18.1 or >= 22
- An Anthropic API key
- A GitHub account with permission to create GitHub Apps

### Step 1: Create a GitHub App

1. Go to **Settings > Developer settings > GitHub Apps > New GitHub App**
2. Fill in:
   - **GitHub App name**: anything you like (e.g., `my-issue-bot`)
   - **Homepage URL**: your repo URL
   - **Webhook URL**: your server URL, or `https://smee.io/<your-channel>` for local dev
   - **Webhook secret**: pick a secret (use `development` for local testing)
3. Set **Repository permissions**:
   - **Issues** → Read & Write
   - **Contents** → Read-only (to load repo config)
   - **Metadata** → Read-only
4. Subscribe to **Issues** events
5. Click **Create GitHub App**
6. Note the **App ID** and generate a **Private Key** (.pem file)

### Step 2: Install the App

On the app's settings page, click **Install App** and select the repositories you want it to manage.

### Step 3: Deploy

```bash
git clone https://github.com/alexyan0431/issue-ai-agent.git
cd issue-ai-agent
npm ci
cp .env.example .env
```

Edit `.env`:

```env
APP_ID=your-app-id
WEBHOOK_SECRET=your-webhook-secret
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
ANTHROPIC_API_KEY=sk-ant-...
LOG_LEVEL=info
```

Build and run:

```bash
npm run build
npm start
```

### Step 4: Local Development (Optional)

For local webhook testing, use [smee.io](https://smee.io/) to proxy webhooks:

```bash
# Terminal 1: proxy webhooks to localhost
npx smee-client -u https://smee.io/<your-channel> -t http://localhost:3000/api/github/webhooks

# Terminal 2: run the bot
npm run build && npm start
```

## Configuration

Create `.github/issue-ai.yml` in any repository where the bot is installed. The bot works out of the box with sensible defaults — no config file required.

```yaml
# .github/issue-ai.yml
enabled: true

features:
  classify: true    # Auto-classify issues
  reply: true       # Post AI-drafted replies

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
  model: claude-haiku-4-5-20251001     # Claude model to use
  max_tokens: 2048                      # Max tokens per LLM response
```

### Config Reference

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Master on/off switch |
| `features.classify` | `true` | Enable issue classification + labeling |
| `features.reply` | `true` | Enable AI-drafted reply comments |
| `label_mapping` | *(see defaults above)* | Maps AI categories to your repo's label names |
| `security.max_issue_length` | `10000` | Truncate issue body beyond this length |
| `exclude.labels` | `["wontfix", "skip-ai"]` | Skip issues carrying these labels |
| `exclude.users` | `["dependabot[bot]"]` | Skip issues opened by these users |
| `llm.model` | `claude-haiku-4-5-20251001` | Anthropic model identifier |
| `llm.max_tokens` | `2048` | Max tokens for LLM responses |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_ID` | Yes | GitHub App ID |
| `WEBHOOK_SECRET` | Yes | Webhook secret for signature verification |
| `PRIVATE_KEY` | Yes | GitHub App private key (PEM format) |
| `ANTHROPIC_API_KEY` | No* | Anthropic API key. If unset, bot runs in **dev mode** with mock responses |
| `WEBHOOK_PROXY_URL` | No | Webhook proxy URL (e.g., smee.io channel) |
| `LOG_LEVEL` | No | Log verbosity: `debug`, `info`, `warn`, `error` (default: `debug`) |
| `PORT` | No | Server port (default: `3000`) |

*\*Required for production. Dev mode is for testing webhook flow without LLM costs.*

## Development

```bash
npm ci              # Install dependencies
npm run build       # Compile TypeScript
npm test            # Run tests (Vitest)
npm run test:watch  # Watch mode
npm run dev         # TypeScript watch mode
```

### Architecture

```
GitHub Webhook (issues.opened)
  → classify  — Claude classifies the issue (category + priority)
  → label     — Maps classification to repo labels via GitHub API
  → reply     — Drafts and posts a contextual comment via Claude
```

Key design decisions:
- **Stateless** — no database; reads config from each repo's `.github/issue-ai.yml`
- **Error-resilient** — each pipeline step catches its own errors, so a classification failure doesn't block the reply
- **Security-first** — input sanitization (zero-width chars, control chars, length limits) + explicit untrusted-data markers in prompts

## Roadmap

- [x] **Phase 1**: Issue classification + auto-reply (current)
- [ ] **Phase 2**: Bug sandbox reproduction
- [ ] **Phase 3**: Auto-fix PR via mini-swe-agent
- [ ] **Phase 4**: Multi-model support (OpenAI, Ollama), GitHub Marketplace, i18n

## License

[MIT](LICENSE)
