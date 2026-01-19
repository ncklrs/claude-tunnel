import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "crypto";
import { config } from "../../config";
import { logger } from "../../logger";
import type { AgentTask } from "../../types";
import { GitHubIssueClient } from "./client";
import * as queue from "../../services/queue";
import { resolve } from "path";

const githubWebhook = new Hono();

// Lazy-loaded client instance
let client: GitHubIssueClient | null = null;

function getClient(): GitHubIssueClient {
  if (!client) {
    client = new GitHubIssueClient();
  }
  return client;
}

/**
 * GitHub webhook payload types
 */
interface GitHubLabel {
  id: number;
  name: string;
}

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  labels: GitHubLabel[];
}

interface GitHubIssuesEvent {
  action: "labeled" | "unlabeled" | "opened" | "closed" | "edited" | string;
  issue: GitHubIssue;
  repository: GitHubRepository;
  label?: GitHubLabel; // Present for labeled/unlabeled actions
  sender: {
    login: string;
  };
}

/**
 * Validate the GitHub webhook signature
 * GitHub uses HMAC-SHA256 with the signature prefixed with "sha256="
 */
function validateSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  // GitHub signature format: sha256=<hex>
  if (!signature.startsWith("sha256=")) {
    return false;
  }

  const providedSignature = signature.slice(7); // Remove "sha256=" prefix
  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  const expectedSignature = hmac.digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(providedSignature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Check if a webhook payload should be processed
 * Only process issues.labeled events for the trigger label
 */
function shouldProcess(
  event: string | undefined,
  payload: GitHubIssuesEvent
): boolean {
  // Only process issues events
  if (event !== "issues") {
    logger.debug("Ignoring non-issues event", { event });
    return false;
  }

  // Only process labeled action
  if (payload.action !== "labeled") {
    logger.debug("Ignoring non-labeled action", { action: payload.action });
    return false;
  }

  // Check if the added label is the trigger label
  if (!payload.label) {
    logger.debug("No label in webhook payload");
    return false;
  }

  const triggerLabel = config.githubTriggerLabel.toLowerCase();
  const addedLabel = payload.label.name.toLowerCase();

  if (addedLabel !== triggerLabel) {
    logger.debug("Added label is not trigger label", {
      addedLabel: payload.label.name,
      triggerLabel: config.githubTriggerLabel,
    });
    return false;
  }

  logger.info(`Trigger label "${config.githubTriggerLabel}" was added`, {
    repo: payload.repository.full_name,
    issue: payload.issue.number,
  });

  return true;
}

/**
 * POST /webhook/github - Handle incoming GitHub webhooks
 */
githubWebhook.post("/", async (c) => {
  // Check if GitHub is configured
  if (!config.githubToken || !config.githubWebhookSecret) {
    logger.warn("GitHub webhook received but GitHub is not configured");
    return c.json({ error: "GitHub not configured" }, 503);
  }

  // Get raw body for signature validation
  const rawBody = await c.req.text();

  // Validate signature
  const signature = c.req.header("X-Hub-Signature-256") ?? null;
  if (!validateSignature(rawBody, signature, config.githubWebhookSecret)) {
    logger.warn("Invalid GitHub webhook signature received", {
      ip: c.req.header("x-forwarded-for") || "unknown",
    });
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Get event type
  const event = c.req.header("X-GitHub-Event");

  // Parse payload
  let payload: GitHubIssuesEvent;
  try {
    payload = JSON.parse(rawBody) as GitHubIssuesEvent;
  } catch (e) {
    logger.error("Failed to parse webhook payload", { error: String(e) });
    return c.json({ error: "Invalid JSON" }, 400);
  }

  logger.debug("Received GitHub webhook", {
    event,
    action: payload.action,
    repo: payload.repository?.full_name,
    issue: payload.issue?.number,
  });

  // Check if we should process this webhook
  if (!shouldProcess(event, payload)) {
    return c.json({ status: "ignored" }, 200);
  }

  // Build issue identifier: owner/repo#123
  const issueId = `${payload.repository.full_name}#${payload.issue.number}`;

  // Check if already queued or running
  if (queue.isQueued(issueId) || queue.isRunning(issueId)) {
    logger.warn("Issue already queued or running", { issueId });
    return c.json({ status: "already_processing" }, 200);
  }

  // Fetch full issue details
  const githubClient = getClient();
  const issue = await githubClient.getIssue(issueId);
  if (!issue) {
    logger.error("Issue not found", { issueId });
    return c.json({ error: "Issue not found" }, 400);
  }

  // Get repository (already available from the identifier)
  const repo = githubClient.getRepository(issue);
  if (!repo) {
    logger.error("Repository not available for issue", { issueId });
    return c.json({ error: "Repository not specified" }, 400);
  }

  // Create task and add to queue
  const branchName = githubClient.getBranchName(issue);
  const worktreePath = resolve(config.worktreesPath, branchName);
  const task: AgentTask = {
    issueId: issue.id,
    identifier: issue.identifier,
    repo,
    worktreePath,
    status: "queued",
    title: issue.title,
    provider: "github",
  };

  queue.addTask(task);
  logger.info("Issue enqueued for processing", {
    issueId: issue.identifier,
    repo,
    provider: "github",
  });

  return c.json({ status: "enqueued", issueId: issue.identifier }, 200);
});

export { githubWebhook };
