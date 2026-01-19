# Linear Agent

A locally-running service that automatically attempts tasks tagged in Linear using Claude Code. When an issue receives a configured trigger label, the service spawns an isolated agent session that takes a first pass at the work, commits to a branch, creates a PR, and reports back to Linear.

## Features

- **Webhook-triggered**: Automatically processes issues when a trigger label is added
- **Isolated execution**: Each task runs in its own git worktree to prevent conflicts
- **Claude Code integration**: Uses Claude Code CLI to attempt the work
- **Linear integration**: Updates issue status, adds comments with results, creates PRs
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

Required configuration:
- `LINEAR_API_KEY`: Your Linear API key (from Linear Settings > API > Personal API keys)
- `LINEAR_WEBHOOK_SECRET`: Webhook secret (generated when creating webhook in Linear)
- `REPOS_BASE_PATH`: Directory where your repositories are cloned (e.g., `~/code`)
- `WORKTREES_PATH`: Directory where worktrees will be created (e.g., `~/worktrees`)

### 3. Set up Linear

#### Create a Custom Field

1. Go to Linear Settings > Custom Fields
2. Create a new Text field called "Repository"
3. This field should contain the repository path relative to `REPOS_BASE_PATH` (e.g., `my-project` or `org/project`)

#### Create a Trigger Label

1. Create a label that will trigger the agent (e.g., `ai-attempt`)
2. Set this label name in `TRIGGER_LABEL` env var

#### Configure Webhook

1. Go to Linear Settings > API > Webhooks
2. Create a new webhook:
   - URL: Your tunnel URL + `/webhook/linear` (see Tunnel Setup below)
   - Events: Select "Issues" with "Issue updated" events
3. Copy the webhook signing secret to `LINEAR_WEBHOOK_SECRET`

### 4. Set up Cloudflared Tunnel

Linear webhooks need to reach your local server. Use cloudflared to create a tunnel:

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

This will output a URL like `https://random-name.trycloudflare.com`. Use this URL for your Linear webhook:
```
https://random-name.trycloudflare.com/webhook/linear
```

### 5. Start the server

```bash
bun run dev
```

## Usage

1. Create or open an issue in Linear
2. Set the "Repository" custom field to the repo path (e.g., `my-project`)
3. Add the trigger label (e.g., `ai-attempt`)
4. The agent will:
   - Create a worktree for the issue
   - Update the issue status to "In Progress"
   - Run Claude Code with the issue context
   - Commit and push changes
   - Create a PR
   - Update the issue with results

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check, returns uptime |
| `/status` | GET | Queue depth and running agents |
| `/webhook/linear` | POST | Linear webhook receiver |
| `/retry/:issueId` | POST | Manually retry an issue |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LINEAR_API_KEY` | Yes | - | Linear API key |
| `LINEAR_WEBHOOK_SECRET` | Yes | - | Webhook signing secret |
| `TRIGGER_LABEL` | No | `ai-attempt` | Label that triggers the agent |
| `REPO_CUSTOM_FIELD_NAME` | No | `Repository` | Custom field name for repo path |
| `REPOS_BASE_PATH` | Yes | - | Base path where repos are cloned |
| `WORKTREES_PATH` | Yes | - | Path for creating worktrees |
| `MAX_CONCURRENT_AGENTS` | No | `1` | Max concurrent agent executions |
| `INCLUDE_COMMENTS` | No | `true` | Include issue comments in prompt |
| `AGENT_TIMEOUT` | No | `1800000` | Agent timeout in ms (30 min) |
| `PORT` | No | `3847` | Server port |
| `AUTO_CLEAN_ORPHANS` | No | `false` | Auto-cleanup orphan worktrees |
| `IN_PROGRESS_STATUS` | No | `In Progress` | Status when agent starts |
| `REVIEW_STATUS` | No | `In Review` | Status when agent completes |
| `LOG_LEVEL` | No | `info` | Log level (error/warn/info/debug) |

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
Linear (webhook)
    ↓
cloudflared tunnel
    ↓
Local server (port 3847)
    ↓
Queue → Agent Runner
    ↓
Claude Code CLI (in worktree)
    ↓
Git push + PR + Linear update
```

## File Structure

```
linear-agent/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Hono server setup
│   ├── config.ts             # Configuration loader
│   ├── logger.ts             # Logging utilities
│   ├── types.ts              # TypeScript interfaces
│   ├── routes/
│   │   ├── webhook.ts        # Linear webhook handler
│   │   └── retry.ts          # Manual retry endpoint
│   └── services/
│       ├── linear-client.ts  # Linear API client
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
2. Verify webhook is configured in Linear with the correct URL
3. Check `LINEAR_WEBHOOK_SECRET` matches the webhook signing secret
4. Check server logs for signature validation errors

### Agent not finding repository

1. Ensure `REPOS_BASE_PATH` is set correctly
2. Verify the "Repository" custom field value matches a directory in `REPOS_BASE_PATH`
3. The repo value should be relative to `REPOS_BASE_PATH` (e.g., `my-project`, not `~/code/my-project`)

### Status not updating in Linear

1. Verify `IN_PROGRESS_STATUS` and `REVIEW_STATUS` match your workflow state names exactly
2. Check Linear API key has write permissions
3. Review logs for API errors

## License

MIT
