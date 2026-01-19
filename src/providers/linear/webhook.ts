import { Hono } from "hono";
import { createHmac } from "crypto";
import { config } from "../../config";
import { logger } from "../../logger";
import type { WebhookPayload, WebhookFilterResult, AgentTask } from "../../types";
import { LinearIssueClient } from "./client";
import * as queue from "../../services/queue";
import { resolve } from "path";

const linearWebhook = new Hono();

// Lazy-loaded client instance
let client: LinearIssueClient | null = null;

function getClient(): LinearIssueClient {
  if (!client) {
    client = new LinearIssueClient();
  }
  return client;
}

/**
 * Validate the Linear webhook signature
 */
function validateSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  const expectedSignature = hmac.digest("hex");

  // Linear sends the signature as a hex string
  return signature === expectedSignature;
}

/**
 * Check if a webhook payload should be processed
 * Only process label-added events for the trigger label
 */
async function shouldProcess(
  payload: WebhookPayload
): Promise<WebhookFilterResult> {
  // Only process Issue events
  if (payload.type !== "Issue") {
    logger.debug("Ignoring non-Issue webhook", { type: payload.type });
    return { shouldProcess: false };
  }

  // Only process update actions
  if (payload.action !== "update") {
    logger.debug("Ignoring non-update action", { action: payload.action });
    return { shouldProcess: false };
  }

  // Check if labels were changed
  const updatedFrom = payload.updatedFrom;
  if (!updatedFrom?.labelIds) {
    logger.debug("No label changes in webhook");
    return { shouldProcess: false };
  }

  // Get current and previous label IDs
  const currentLabelIds = payload.data.labelIds || [];
  const previousLabelIds = updatedFrom.labelIds || [];

  // Find newly added labels
  const addedLabelIds = currentLabelIds.filter(
    (id) => !previousLabelIds.includes(id)
  );

  if (addedLabelIds.length === 0) {
    logger.debug("No labels were added");
    return { shouldProcess: false };
  }

  // Check if any added label is the trigger label
  const linearClient = getClient();
  for (const labelId of addedLabelIds) {
    const label = await linearClient.getLabel(labelId);
    if (
      label &&
      label.name.toLowerCase() === config.linearTriggerLabel.toLowerCase()
    ) {
      logger.info(`Trigger label "${config.linearTriggerLabel}" was added`, {
        issueId: payload.data.id,
      });
      return {
        shouldProcess: true,
        issueId: payload.data.id,
        addedLabelIds,
      };
    }
  }

  logger.debug("Added labels do not include trigger label", {
    addedLabelIds,
    triggerLabel: config.linearTriggerLabel,
  });
  return { shouldProcess: false };
}

/**
 * POST /webhook/linear - Handle incoming Linear webhooks
 */
linearWebhook.post("/", async (c) => {
  // Check if Linear is configured
  if (!config.linearApiKey || !config.linearWebhookSecret) {
    logger.warn("Linear webhook received but Linear is not configured");
    return c.json({ error: "Linear not configured" }, 503);
  }

  // Get raw body for signature validation
  const rawBody = await c.req.text();

  // Validate signature
  const signature = c.req.header("Linear-Signature") ?? null;
  if (!validateSignature(rawBody, signature, config.linearWebhookSecret)) {
    logger.warn("Invalid webhook signature received", {
      ip: c.req.header("x-forwarded-for") || "unknown",
    });
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse payload
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch (e) {
    logger.error("Failed to parse webhook payload", { error: String(e) });
    return c.json({ error: "Invalid JSON" }, 400);
  }

  logger.debug("Received Linear webhook", {
    type: payload.type,
    action: payload.action,
    issueId: payload.data.id,
  });

  // Check if we should process this webhook
  const filterResult = await shouldProcess(payload);
  if (!filterResult.shouldProcess || !filterResult.issueId) {
    return c.json({ status: "ignored" }, 200);
  }

  // Fetch full issue details
  const linearClient = getClient();
  const issue = await linearClient.getIssue(filterResult.issueId);
  if (!issue) {
    logger.error("Issue not found", { issueId: filterResult.issueId });
    return c.json({ error: "Issue not found" }, 400);
  }

  // Get repository from custom field
  const repo = linearClient.getRepository(issue);
  if (!repo) {
    logger.error("Repository not specified in issue custom field", {
      issueId: issue.identifier,
      customFieldName: config.repoCustomFieldName,
    });
    return c.json(
      {
        error: `Repository not specified. Please set the "${config.repoCustomFieldName}" custom field.`,
      },
      400
    );
  }

  // Check if already queued or running
  if (queue.isQueued(issue.id) || queue.isRunning(issue.id)) {
    logger.warn("Issue already queued or running", { issueId: issue.identifier });
    return c.json({ status: "already_processing" }, 200);
  }

  // Create task and add to queue
  const branchName = linearClient.getBranchName(issue);
  const worktreePath = resolve(config.worktreesPath, branchName);
  const task: AgentTask = {
    issueId: issue.id,
    identifier: issue.identifier,
    repo,
    worktreePath,
    status: "queued",
    title: issue.title,
    provider: "linear",
  };

  queue.addTask(task);
  logger.info("Issue enqueued for processing", {
    issueId: issue.identifier,
    repo,
    provider: "linear",
  });

  return c.json({ status: "enqueued", issueId: issue.identifier }, 200);
});

export { linearWebhook };
