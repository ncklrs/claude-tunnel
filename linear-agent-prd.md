# Linear Agent PRD

## Overview

A local service that automatically attempts tasks tagged in Linear using Claude Code. Every tagged issue spawns an isolated agent session that takes a first pass at the work, commits to a branch, and reports back.

## Problem

Manual task execution creates friction. Even well-defined tasks require context switching to start. An agent that takes a first stab at every task reduces activation energy and often completes straightforward work entirely.

## Solution

A locally-running service that:
1. Receives webhooks from Linear when issues are tagged
2. Creates an isolated git worktree for the task
3. Spawns a Claude Code session with context from the issue
4. Commits and pushes results
5. Updates Linear with status and links

## Architecture

```
Linear (webhook) 
    ↓
cloudflared tunnel 
    ↓
Local Express server (port 3847)
    ↓
Agent Runner
    ↓
Claude Code CLI (in worktree)
    ↓
Git push + Linear API update
```

## Components

### 1. Webhook Server (`server.ts`)

Express/Hono server receiving Linear webhooks.

**Responsibilities:**
- Validate webhook signature
- Filter for label-added events matching configured trigger label
- Extract issue data and enqueue for processing

**Endpoint:**
- `POST /webhook/linear`

### 2. Linear Client (`linear-client.ts`)

Wrapper for Linear API operations.

**Operations:**
- Fetch full issue details including custom fields
- Update issue status
- Add comments
- Fetch custom field definitions (for repo reference field)

**Custom Field:**
- `Repository` - text field containing repo identifier (e.g., `tony-robbins/website` or just `website`)

### 3. Prompt Builder (`prompt-builder.ts`)

Constructs Claude Code prompt from issue context.

**Inputs:**
- Issue title
- Issue description
- Comments (optional, configurable)
- Labels
- Parent issue context (if sub-issue)

**Output format:**
```
You are working on: {title}

Context:
{description}

Repository: {repo}
Branch: {issue-id}

Requirements:
- Make changes to address the issue
- Commit with meaningful messages
- Keep changes focused and minimal

{additional context from comments if enabled}
```

### 4. Agent Runner (`agent-runner.ts`)

Manages git worktrees and Claude Code execution.

**Flow:**
1. Resolve repo path from config + custom field value
2. Create worktree: `git worktree add ../worktrees/{issue-id} -b {issue-id}`
3. Update Linear status to "In Progress"
4. Add comment: "Agent started working on this issue"
5. Spawn Claude Code: `claude -p "{prompt}"` in worktree directory
6. Capture stdout/stderr to log file
7. On completion:
   - `git add -A && git commit -m "feat: {issue-title}"` (if changes)
   - `git push -u origin {issue-id}`
   - Update Linear status to "Review"
   - Add comment with summary and branch link
8. On failure:
   - Update Linear with error status
   - Add comment with error details

**Concurrency:**
- Queue-based execution
- Configurable max concurrent agents (default: 1)

### 5. Configuration (`config.ts`)

```typescript
interface Config {
  // Linear
  linearApiKey: string;           // env: LINEAR_API_KEY
  linearWebhookSecret: string;    // env: LINEAR_WEBHOOK_SECRET
  triggerLabel: string;           // Label that triggers agent (e.g., "ai-attempt")
  repoCustomFieldName: string;    // Name of custom field containing repo reference
  
  // Git
  reposBasePath: string;          // Base path where repos live (e.g., ~/code)
  worktreesPath: string;          // Where to create worktrees (e.g., ~/worktrees)
  
  // Agent
  maxConcurrentAgents: number;    // Default: 1
  includeComments: boolean;       // Include issue comments in prompt
  
  // Server
  port: number;                   // Default: 3847
}
```

Configuration loaded from:
1. Environment variables
2. `.env` file
3. `config.json` (optional overrides)

## Linear Setup

### Custom Field
Create a text custom field called "Repository" at the team or workspace level.

### Webhook
Configure webhook in Linear settings:
- URL: `https://linear-agent.yourdomain.com/webhook/linear` (or ngrok URL)
- Events: Issue updates (specifically label changes)

### Labels
Create a label for triggering (e.g., "ai-attempt")

### Statuses
The agent will move issues between statuses. Recommended setup:
- "Todo" or "Backlog" - initial state
- "In Progress" - agent is working
- "Review" - agent completed, needs human review
- (existing states work, just configure mapping)

## Git Workflow

### Worktree Strategy
Each issue gets an isolated worktree:
```
~/code/website/                    # Main repo
~/worktrees/ISSUE-123/             # Worktree for issue
~/worktrees/ISSUE-124/             # Worktree for another issue
```

Benefits:
- No conflicts between concurrent tasks
- Easy cleanup
- Clear branch-per-issue mapping

### Branch Naming
Branch name = Linear issue ID (e.g., `ISSUE-123` or `ENG-456`)

### Commit Messages
Default format: `feat: {issue-title}`
Agent may create multiple commits if appropriate.

## Error Handling

### Webhook Errors
- Invalid signature: 401 response, log warning
- Missing required fields: 400 response, log error
- Processing errors: 500 response, retry logic

### Agent Errors
- Git errors (worktree exists, merge conflicts): Log, update Linear with error
- Claude Code errors: Capture stderr, update Linear with details
- Timeout (configurable, default 30min): Kill process, update Linear

### Recovery
- On restart, check for orphaned worktrees
- Option to resume or clean up incomplete runs

## API Endpoints

### `POST /webhook/linear`
Receives Linear webhooks. Returns 200 immediately, processes async.

### `GET /health`
Health check endpoint.

### `GET /status`
Returns current queue status and running agents.

### `POST /retry/{issueId}`
Manually retry a failed issue.

## File Structure

```
linear-agent/
├── src/
│   ├── server.ts
│   ├── agent-runner.ts
│   ├── linear-client.ts
│   ├── prompt-builder.ts
│   ├── config.ts
│   ├── queue.ts
│   └── types.ts
├── logs/
│   └── {issue-id}.log
├── .env.example
├── config.json.example
├── package.json
├── tsconfig.json
└── README.md
```

## Tech Stack

- Runtime: Node.js / Bun
- Language: TypeScript
- Server: Hono (lightweight, fast)
- Linear SDK: @linear/sdk
- Process management: Node child_process
- Queue: Simple in-memory (upgrade to Redis if needed)

## Future Enhancements

- PR creation after push
- Slack notifications
- Web UI for monitoring
- Support for multiple repos per issue
- Auto-cleanup of merged worktrees
- Cost tracking (Claude API usage)
- Custom prompt templates per label/project

## Success Metrics

- Tasks attempted automatically
- Completion rate (agent finishes without error)
- Acceptance rate (human approves agent's work)
- Time saved per task

## Open Questions

1. Should agent create PRs automatically or just push branches?
2. How to handle issues that reference multiple repos?
3. Should there be a way to provide additional context mid-run?
4. Cleanup policy for worktrees after merge?
