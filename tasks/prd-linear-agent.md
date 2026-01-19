# PRD: Linear Agent

## Introduction

A locally-running service that automatically attempts tasks tagged in Linear using Claude Code. When an issue receives a configured trigger label, the service spawns an isolated agent session that takes a first pass at the work, commits to a branch, creates a PR, and reports back to Linear.

This reduces activation energy for well-defined tasks—the agent handles context switching, environment setup, and initial implementation, often completing straightforward work entirely.

## Goals

- Automatically process Linear issues tagged with a trigger label
- Create isolated git worktrees for each task to prevent conflicts
- Execute Claude Code with rich context from the issue
- Push changes, create PRs, and update Linear with results
- Support concurrent agent execution with configurable limits
- Provide robust error handling with recovery and cleanup
- Enable easy local deployment via cloudflared tunnel

## User Stories

### US-001: Webhook Server Setup
**Description:** As a developer, I need a server that receives Linear webhooks so that issue events can trigger agent runs.

**Acceptance Criteria:**
- [ ] Hono server runs on configurable port (default 3847)
- [ ] `POST /webhook/linear` endpoint receives webhooks
- [ ] Webhook signature validation using `LINEAR_WEBHOOK_SECRET`
- [ ] Invalid signatures return 401, logged as warning
- [ ] Missing required fields return 400 with error details
- [ ] Valid webhooks return 200 immediately, process async
- [ ] Typecheck passes

### US-002: Health and Status Endpoints
**Description:** As an operator, I want health and status endpoints so I can monitor the service.

**Acceptance Criteria:**
- [ ] `GET /health` returns 200 with basic health info
- [ ] `GET /status` returns current queue depth and running agents
- [ ] Status includes agent details: issue ID, start time, repo
- [ ] Typecheck passes

### US-003: Configuration System
**Description:** As a developer, I need a flexible configuration system so the service can be customized per environment.

**Acceptance Criteria:**
- [ ] Configuration loaded from environment variables
- [ ] `.env` file support for local development
- [ ] Optional `config.json` for additional overrides
- [ ] All config options have sensible defaults where applicable
- [ ] Missing required config (API keys) throws clear error on startup
- [ ] Config interface matches spec: Linear settings, Git paths, Agent settings, Server port
- [ ] Typecheck passes

### US-004: Linear Client - Issue Fetching
**Description:** As the agent runner, I need to fetch full issue details from Linear so I can build context for Claude.

**Acceptance Criteria:**
- [ ] Fetch issue by ID with title, description, labels, comments
- [ ] Fetch parent issue context for sub-issues
- [ ] Fetch custom field value for "Repository" field
- [ ] Handle issues without custom field gracefully (use default repo or error)
- [ ] Typecheck passes

### US-005: Linear Client - Status Updates
**Description:** As the agent runner, I need to update issue status in Linear so humans can track progress.

**Acceptance Criteria:**
- [ ] Update issue status to "In Progress" when agent starts
- [ ] Update issue status to "Review" when agent completes successfully
- [ ] Status names are configurable (map to team's actual status names)
- [ ] Typecheck passes

### US-006: Linear Client - Comments
**Description:** As the agent runner, I need to add comments to Linear issues so humans see what happened.

**Acceptance Criteria:**
- [ ] Add comment when agent starts: "Agent started working on this issue"
- [ ] Add comment on completion with: summary, branch link, PR link
- [ ] Add comment on failure with: error details, log excerpt
- [ ] Comments use markdown formatting for readability
- [ ] Typecheck passes

### US-007: Prompt Builder
**Description:** As the agent runner, I need to construct prompts for Claude Code that include full issue context.

**Acceptance Criteria:**
- [ ] Prompt includes: issue title, description, repo, branch name
- [ ] Prompt includes parent issue context if sub-issue
- [ ] Prompt optionally includes issue comments (configurable)
- [ ] Prompt includes clear requirements section
- [ ] Output format matches spec template
- [ ] Typecheck passes

### US-008: Agent Runner - Worktree Management
**Description:** As the system, I need to create isolated git worktrees for each issue so concurrent agents don't conflict.

**Acceptance Criteria:**
- [ ] Resolve repo path from `reposBasePath` + custom field value
- [ ] Create worktree: `git worktree add {worktreesPath}/{issue-id} -b {issue-id}`
- [ ] Handle existing worktree gracefully (reuse or error with clear message)
- [ ] Worktree created from main/master branch (configurable base)
- [ ] Typecheck passes

### US-009: Agent Runner - Claude Code Execution
**Description:** As the system, I need to spawn Claude Code in the worktree to attempt the task.

**Acceptance Criteria:**
- [ ] Spawn `claude -p "{prompt}"` in worktree directory
- [ ] Capture stdout and stderr to log file at `logs/{issue-id}.log`
- [ ] Configurable timeout (default 30 minutes)
- [ ] Kill process on timeout, update Linear with timeout error
- [ ] Typecheck passes

### US-010: Agent Runner - Git Operations
**Description:** As the system, I need to commit and push agent changes so they're available for review.

**Acceptance Criteria:**
- [ ] After Claude completes, check for changes with `git status`
- [ ] If changes: `git add -A && git commit -m "feat: {issue-title}"`
- [ ] Push branch: `git push -u origin {issue-id}`
- [ ] Handle push failures (auth, network) with clear error
- [ ] Typecheck passes

### US-011: Agent Runner - PR Creation
**Description:** As the system, I need to create a PR automatically so reviewers can easily access the changes.

**Acceptance Criteria:**
- [ ] Create PR using GitHub CLI or API after successful push
- [ ] PR title: issue title
- [ ] PR body: link to Linear issue, summary of changes
- [ ] PR targets main/master branch (configurable)
- [ ] Return PR URL for inclusion in Linear comment
- [ ] Handle PR creation failure gracefully (still update Linear with branch)
- [ ] Typecheck passes

### US-012: Task Queue
**Description:** As the system, I need a queue to manage incoming tasks so agents run in controlled order.

**Acceptance Criteria:**
- [ ] In-memory queue for pending tasks
- [ ] Configurable max concurrent agents (default: 1)
- [ ] FIFO processing order
- [ ] Queue status visible via `/status` endpoint
- [ ] Typecheck passes

### US-013: Manual Retry Endpoint
**Description:** As an operator, I want to manually retry failed issues so I can recover from transient failures.

**Acceptance Criteria:**
- [ ] `POST /retry/{issueId}` endpoint
- [ ] Fetches fresh issue data from Linear
- [ ] Adds to queue for processing
- [ ] Returns 404 if issue not found
- [ ] Returns 409 if issue already in queue or running
- [ ] Typecheck passes

### US-014: Webhook Event Filtering
**Description:** As the system, I need to filter webhooks to only process relevant events so we don't run agents unnecessarily.

**Acceptance Criteria:**
- [ ] Only process "Issue" resource type
- [ ] Only process label-added events
- [ ] Only trigger when added label matches `triggerLabel` config
- [ ] Ignore label removal events
- [ ] Ignore other issue update events
- [ ] Typecheck passes

### US-015: Error Recovery - Orphan Cleanup
**Description:** As an operator, I want orphaned worktrees cleaned up on restart so disk space isn't wasted.

**Acceptance Criteria:**
- [ ] On startup, scan worktrees directory
- [ ] Identify orphans: worktrees without corresponding running agent
- [ ] Option to auto-clean or list for manual review
- [ ] Log cleanup actions
- [ ] Typecheck passes

### US-016: Error Recovery - State Persistence
**Description:** As an operator, I want agent state persisted so recovery is possible after crashes.

**Acceptance Criteria:**
- [ ] Track running agents in a state file (JSON)
- [ ] On startup, check for incomplete runs
- [ ] Option to resume or abandon incomplete runs
- [ ] State file updated atomically to prevent corruption
- [ ] Typecheck passes

### US-017: Cloudflared Tunnel Setup
**Description:** As a developer, I need documentation and tooling for cloudflared tunnel so Linear webhooks can reach my local machine.

**Acceptance Criteria:**
- [ ] README includes cloudflared installation instructions
- [ ] README includes tunnel configuration for the webhook endpoint
- [ ] Optional: npm script to start tunnel alongside server
- [ ] Document webhook URL format for Linear configuration
- [ ] Typecheck passes (for any scripts)

### US-018: Logging System
**Description:** As an operator, I need structured logging so I can debug issues and monitor agent behavior.

**Acceptance Criteria:**
- [ ] Per-agent log files at `logs/{issue-id}.log`
- [ ] Server logs to stdout with timestamps
- [ ] Log levels: error, warn, info, debug (configurable)
- [ ] Logs include: issue ID, repo, timestamps, key events
- [ ] Typecheck passes

## Functional Requirements

- FR-01: Server listens on configurable port (default 3847) using Hono framework
- FR-02: `POST /webhook/linear` validates signature and processes label-added events
- FR-03: `GET /health` returns service health status
- FR-04: `GET /status` returns queue depth and running agent details
- FR-05: `POST /retry/{issueId}` re-queues a failed issue for processing
- FR-06: Configuration loaded from env vars, `.env` file, and optional `config.json`
- FR-07: Linear client fetches issue details including custom "Repository" field
- FR-08: Linear client updates issue status (In Progress, Review)
- FR-09: Linear client adds comments with agent status and results
- FR-10: Prompt builder constructs Claude Code prompt with full issue context
- FR-11: Agent runner creates git worktree at `{worktreesPath}/{issue-id}`
- FR-12: Agent runner spawns `claude -p "{prompt}"` with 30-minute default timeout
- FR-13: Agent runner captures output to `logs/{issue-id}.log`
- FR-14: Agent runner commits changes: `git add -A && git commit -m "feat: {title}"`
- FR-15: Agent runner pushes branch: `git push -u origin {issue-id}`
- FR-16: Agent runner creates PR via GitHub CLI or API
- FR-17: Queue manages concurrent execution up to `maxConcurrentAgents` limit
- FR-18: On startup, system checks for and handles orphaned worktrees
- FR-19: On startup, system checks for incomplete runs and offers recovery
- FR-20: Webhook signature validation rejects invalid requests with 401

## Non-Goals

- Web UI for monitoring (future enhancement)
- Slack/Discord notifications (future enhancement)
- Multi-repo per issue support (future enhancement)
- Auto-cleanup of merged worktrees (future enhancement)
- Cost tracking for Claude API usage (future enhancement)
- Custom prompt templates per label/project (future enhancement)
- Redis-backed queue (in-memory sufficient for local use)
- Authentication for status/retry endpoints (local-only service)
- Windows support (macOS/Linux only initially)

## Design Considerations

### Project Structure
```
linear-agent/
├── src/
│   ├── index.ts           # Entry point
│   ├── server.ts          # Hono server setup
│   ├── routes/
│   │   ├── webhook.ts     # Linear webhook handler
│   │   ├── health.ts      # Health endpoints
│   │   └── retry.ts       # Manual retry endpoint
│   ├── services/
│   │   ├── agent-runner.ts
│   │   ├── linear-client.ts
│   │   ├── prompt-builder.ts
│   │   └── queue.ts
│   ├── config.ts
│   ├── logger.ts
│   └── types.ts
├── logs/                   # Agent output logs
├── .env.example
├── config.json.example
├── package.json
├── tsconfig.json
└── README.md
```

### Linear Status Mapping
Default mapping (configurable):
- Starting state: Any (typically "Todo" or "Backlog")
- Agent working: "In Progress"
- Agent complete: "Review"
- Agent failed: Stays in current state, comment added

## Technical Considerations

- **Runtime:** Bun for fast startup and built-in TypeScript support
- **Framework:** Hono for lightweight, fast HTTP handling
- **Linear SDK:** `@linear/sdk` for typed API access
- **Process Execution:** Bun's native `spawn` or `Bun.spawn`
- **Git Operations:** Shell commands via Bun subprocess
- **PR Creation:** GitHub CLI (`gh pr create`) for simplicity
- **State File:** Simple JSON file, atomic writes via temp file + rename
- **Tunnel:** cloudflared for exposing local server to Linear webhooks

### Dependencies
```json
{
  "dependencies": {
    "hono": "^4.x",
    "@linear/sdk": "^2.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.x"
  }
}
```

### Environment Variables
```
LINEAR_API_KEY=lin_api_xxxxx
LINEAR_WEBHOOK_SECRET=xxxxx
TRIGGER_LABEL=ai-attempt
REPO_CUSTOM_FIELD_NAME=Repository
REPOS_BASE_PATH=~/code
WORKTREES_PATH=~/worktrees
MAX_CONCURRENT_AGENTS=1
INCLUDE_COMMENTS=true
PORT=3847
```

## Success Metrics

- Tasks automatically attempted when tagged (measure: webhook → agent start time)
- Completion rate: % of agent runs that finish without timeout/error
- Push success rate: % of completed runs that successfully push
- PR creation rate: % of pushes that create PRs
- Acceptance rate: % of PRs that get merged (human approves agent's work)
- Time from tag to PR created (automation latency)

## Open Questions

1. **Branch base:** Should agents branch from `main`, `develop`, or configurable per-repo?
2. **Existing branch handling:** If branch already exists, should we reuse, error, or create unique suffix?
3. **PR reviewers:** Should PRs auto-assign reviewers? Based on what?
4. **Worktree cleanup:** When should worktrees be cleaned up? After PR merge? After X days?
5. **Rate limiting:** Should we limit how many issues one person can tag in a time window?
