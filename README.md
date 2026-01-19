# Issue Agent

A locally-running service that automatically attempts tasks from Linear or GitHub Issues using Claude Code. When an issue receives a configured trigger label, the service spawns an isolated agent session that takes a first pass at the work, commits to a branch, creates a PR, and reports back to the issue tracker.

## Features

- **Multi-provider support**: Works with both Linear and GitHub Issues simultaneously
- **Webhook-triggered**: Automatically processes issues when a trigger label is added
- **Isolated execution**: Each task runs in its own git worktree to prevent conflicts
- **Claude Code integration**: Uses Claude Code CLI to attempt the work
- **Issue tracking integration**: Updates issue status, adds comments with results, creates PRs
- **Concurrent execution**: Configurable number of concurrent agents
- **Crash recovery**: Persists state and recovers incomplete tasks on restart
- **Orphan cleanup**: Automatically cleans up abandoned worktrees

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

At minimum, configure one provider (Linear or GitHub) plus the git paths:

```bash
# Git paths (required)
REPOS_BASE_PATH=~/code
WORKTREES_PATH=~/worktrees

# Linear (optional - configure if using Linear)
LINEAR_API_KEY=lin_api_xxxxx
LINEAR_WEBHOOK_SECRET=xxxxx

# GitHub (optional - configure if using GitHub)
GITHUB_TOKEN=ghp_xxxxx
GITHUB_WEBHOOK_SECRET=xxxxx
```

### 3. Set up your provider(s)

#### Linear Setup

<details>
<summary>Click to expand Linear setup instructions</summary>

##### Create a Custom Field

1. Go to Linear Settings > Custom Fields
2. Create a new Text field called "Repository"
3. This field should contain the repository path relative to `REPOS_BASE_PATH` (e.g., `my-project` or `org/project`)

##### Create a Trigger Label

1. Create a label that will trigger the agent (e.g., `ai-attempt`)
2. Set this label name in `LINEAR_TRIGGER_LABEL` env var (defaults to `ai-attempt`)

##### Configure Webhook

1. Go to Linear Settings > API > Webhooks
2. Create a new webhook:
   - URL: Your tunnel URL + `/webhook/linear` (see Tunnel Setup below)
   - Events: Select "Issues" with "Issue updated" events
3. Copy the webhook signing secret to `LINEAR_WEBHOOK_SECRET`

</details>

#### GitHub Setup

<details>
<summary>Click to expand GitHub setup instructions</summary>

##### Create a Personal Access Token

1. Go to GitHub Settings > Developer settings > Personal access tokens
2. Create a token with `repo` scope
3. Set this token in `GITHUB_TOKEN`

##### Create Labels

Create these labels in your repository (or customize via env vars):
- `ai-attempt` - Trigger label (configurable via `GITHUB_TRIGGER_LABEL`)
- `in-progress` - Added when agent starts (configurable via `GITHUB_IN_PROGRESS_LABEL`)
- `review` - Added when agent completes (configurable via `GITHUB_REVIEW_LABEL`)

##### Configure Webhook

1. Go to your repository Settings > Webhooks
2. Create a new webhook:
   - Payload URL: Your tunnel URL + `/webhook/github`
   - Content type: `application/json`
   - Secret: Generate a secret and set it in `GITHUB_WEBHOOK_SECRET`
   - Events: Select "Issues" (specifically "Issues labeled")
3. Save the webhook

</details>

### 4. Set up Cloudflared Tunnel

Webhooks need to reach your local server. Use cloudflared to create a tunnel:

#### Install cloudflared

```bash
# macOS
brew install cloudflared

# Linux
# See https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
```

#### Start the tunnel

```bash
cloudflared tunnel --url http://localhost:3847
```

This will output a URL like `https://random-name.trycloudflare.com`. Use this URL for your webhooks:
- Linear: `https://random-name.trycloudflare.com/webhook/linear`
- GitHub: `https://random-name.trycloudflare.com/webhook/github`

### 5. Start the server

```bash
bun run dev
```

## Usage

### With Linear

1. Create or open an issue in Linear
2. Set the "Repository" custom field to the repo path (e.g., `my-project`)
3. Add the trigger label (e.g., `ai-attempt`)

### With GitHub

1. Create or open an issue in your GitHub repository
2. Add the trigger label (e.g., `ai-attempt`)
3. The repository is automatically detected from the issue

### What happens next

The agent will:
1. Create a worktree for the issue
2. Update the issue status (Linear: workflow state, GitHub: labels)
3. Run Claude Code with the issue context
4. Commit and push changes
5. Create a PR
6. Update the issue with results

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check, returns uptime and configured providers |
| `/status` | GET | Queue depth, running agents, and configured providers |
| `/webhook/linear` | POST | Linear webhook receiver |
| `/webhook/github` | POST | GitHub webhook receiver |
| `/retry/:issueId` | POST | Manually retry an issue (use `?provider=linear` or `?provider=github`) |

## Environment Variables

### Required (at least one provider)

| Variable | Description |
|----------|-------------|
| `REPOS_BASE_PATH` | Base path where repos are cloned |
| `WORKTREES_PATH` | Path for creating worktrees |

### Linear Provider (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `LINEAR_API_KEY` | - | Linear API key |
| `LINEAR_WEBHOOK_SECRET` | - | Webhook signing secret |
| `LINEAR_TRIGGER_LABEL` | `ai-attempt` | Label that triggers the agent |
| `REPO_CUSTOM_FIELD_NAME` | `Repository` | Custom field name for repo path |
| `IN_PROGRESS_STATUS` | `In Progress` | Workflow state when agent starts |
| `REVIEW_STATUS` | `In Review` | Workflow state when agent completes |

### GitHub Provider (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | - | GitHub personal access token |
| `GITHUB_WEBHOOK_SECRET` | - | Webhook signing secret |
| `GITHUB_TRIGGER_LABEL` | `ai-attempt` | Label that triggers the agent |
| `GITHUB_IN_PROGRESS_LABEL` | `in-progress` | Label added when agent starts |
| `GITHUB_REVIEW_LABEL` | `review` | Label added when agent completes |

### Agent Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONCURRENT_AGENTS` | `1` | Max concurrent agent executions |
| `INCLUDE_COMMENTS` | `true` | Include issue comments in prompt |
| `AGENT_TIMEOUT` | `1800000` | Agent timeout in ms (30 min) |
| `PORT` | `3847` | Server port |
| `AUTO_CLEAN_ORPHANS` | `false` | Auto-cleanup orphan worktrees |
| `LOG_LEVEL` | `info` | Log level (error/warn/info/debug) |

## Scripts

```bash
# Development
bun run dev          # Start the server
bun run typecheck    # Run TypeScript type checking

# Production
bun run build        # Build for production
```

## Architecture

```
Linear (webhook)          GitHub (webhook)
    ↓                          ↓
    └──────────┬───────────────┘
               ↓
       cloudflared tunnel
               ↓
       Local server (port 3847)
               ↓
       ┌───────┴───────┐
       ↓               ↓
 /webhook/linear  /webhook/github
       ↓               ↓
       └───────┬───────┘
               ↓
    Provider Abstraction (IssueClient)
               ↓
         Task Queue
               ↓
         Agent Runner
               ↓
    Claude Code CLI (in worktree)
               ↓
    Git push + PR + Issue update
```

## File Structure

```
issue-agent/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Hono server setup
│   ├── config.ts             # Configuration loader
│   ├── logger.ts             # Logging utilities
│   ├── types.ts              # TypeScript interfaces
│   ├── providers/
│   │   ├── types.ts          # IssueClient interface
│   │   ├── index.ts          # Provider registry
│   │   ├── linear/
│   │   │   ├── client.ts     # Linear API client
│   │   │   └── webhook.ts    # Linear webhook handler
│   │   └── github/
│   │       ├── client.ts     # GitHub API client
│   │       └── webhook.ts    # GitHub webhook handler
│   ├── routes/
│   │   └── retry.ts          # Manual retry endpoint
│   └── services/
│       ├── prompt-builder.ts # Prompt construction
│       ├── queue.ts          # Task queue management
│       ├── agent-runner.ts   # Agent orchestration
│       ├── git.ts            # Git operations
│       ├── processor.ts      # Queue processor
│       └── state.ts          # State persistence
├── logs/                     # Agent output logs
├── .env.example              # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## Troubleshooting

### Webhook not triggering

1. Check cloudflared is running and the tunnel URL is correct
2. Verify webhook is configured with the correct URL
3. Check webhook secret matches the configured env var
4. Check server logs for signature validation errors

### Agent not finding repository

**Linear:**
1. Ensure `REPOS_BASE_PATH` is set correctly
2. Verify the "Repository" custom field value matches a directory in `REPOS_BASE_PATH`
3. The repo value should be relative to `REPOS_BASE_PATH` (e.g., `my-project`, not `~/code/my-project`)

**GitHub:**
1. Ensure `REPOS_BASE_PATH` contains the repository
2. The repo path is `owner/repo` (e.g., `myorg/myproject`)

### Status not updating

**Linear:**
1. Verify `IN_PROGRESS_STATUS` and `REVIEW_STATUS` match your workflow state names exactly
2. Check Linear API key has write permissions

**GitHub:**
1. Verify the labels exist in your repository
2. Check GitHub token has `repo` scope

### Retry endpoint

To manually retry an issue:

```bash
# Linear issue
curl -X POST "http://localhost:3847/retry/issue-uuid?provider=linear"

# GitHub issue
curl -X POST "http://localhost:3847/retry/owner/repo%23123?provider=github"
```

Note: GitHub issue IDs are URL-encoded (`#` → `%23`).

## License

MIT
