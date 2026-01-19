/**
 * Configuration for the Linear Agent service
 */
export interface Config {
  // Linear API
  linearApiKey: string;
  linearWebhookSecret: string;
  triggerLabel: string;
  repoCustomFieldName: string;

  // Git paths
  reposBasePath: string;
  worktreesPath: string;

  // Agent settings
  maxConcurrentAgents: number;
  includeComments: boolean;
  agentTimeout: number; // in milliseconds

  // Server
  port: number;

  // Recovery
  autoCleanOrphans: boolean;

  // Linear status mapping
  inProgressStatus: string;
  reviewStatus: string;

  // Logging
  logLevel: "error" | "warn" | "info" | "debug";
}

/**
 * Label from Linear
 */
export interface LinearLabel {
  id: string;
  name: string;
}

/**
 * Comment from Linear issue
 */
export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  user?: {
    name: string;
  };
}

/**
 * Custom field value from Linear
 */
export interface LinearCustomField {
  name: string;
  value: string | null;
}

/**
 * Parent issue reference
 */
export interface LinearParentIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
}

/**
 * Issue fetched from Linear with all relevant context
 */
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  labels: LinearLabel[];
  comments: LinearComment[];
  customFields: LinearCustomField[];
  parent?: LinearParentIssue;
  state?: {
    id: string;
    name: string;
  };
  team?: {
    id: string;
    key: string;
  };
}

/**
 * Status of an agent task
 */
export type AgentTaskStatus = "queued" | "running" | "completed" | "failed";

/**
 * A task representing work for the agent
 */
export interface AgentTask {
  issueId: string;
  identifier: string;
  repo: string;
  worktreePath: string;
  status: AgentTaskStatus;
  startedAt?: Date;
  title: string;
}

/**
 * Result from running an agent
 */
export interface AgentResult {
  success: boolean;
  error?: string;
  branchName?: string;
  prUrl?: string;
  summary?: string;
  hasChanges: boolean;
}

/**
 * Item in the processing queue
 */
export interface QueueItem {
  task: AgentTask;
  addedAt: Date;
}

/**
 * Webhook payload from Linear
 */
export interface WebhookPayload {
  action: "create" | "update" | "remove";
  type: "Issue" | "Comment" | "Project" | string;
  createdAt: string;
  data: {
    id: string;
    identifier?: string;
    title?: string;
    description?: string;
    labelIds?: string[];
    teamId?: string;
  };
  updatedFrom?: {
    labelIds?: string[];
    stateId?: string;
    [key: string]: unknown;
  };
  url?: string;
}

/**
 * Result of checking if a webhook should be processed
 */
export interface WebhookFilterResult {
  shouldProcess: boolean;
  issueId?: string;
  addedLabelIds?: string[];
}

/**
 * Queue status for the /status endpoint
 */
export interface QueueStatus {
  queueDepth: number;
  runningCount: number;
  runningAgents: Array<{
    issueId: string;
    identifier: string;
    repo: string;
    startedAt: Date;
  }>;
}

/**
 * Persisted state for crash recovery
 */
export interface PersistedState {
  runningAgents: AgentTask[];
  savedAt: string;
}
