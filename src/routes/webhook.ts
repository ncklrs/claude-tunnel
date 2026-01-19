import { Hono } from "hono";
import { createHmac } from "crypto";
import { config } from "../config";
import { logger } from "../logger";
import type { WebhookPayload, WebhookFilterResult, AgentTask } from "../types";
import { getIssue, getRepositoryFromIssue, getLabel } from "../services/linear-client";
import * as queue from "../services/queue";
import { resolve } from "path";

const webhook = new Hono();

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
  for (const labelId of addedLabelIds) {
    const label = await getLabel(labelId);
    if (
      label &&
      label.name.toLowerCase() === config.triggerLabel.toLowerCase()
    ) {
      logger.info(`Trigger label "${config.triggerLabel}" was added`, {
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
    triggerLabel: config.triggerLabel,
  });
  return { shouldProcess: false };
}

/**
 * POST /webhook/linear - Handle incoming Linear webhooks
 */
webhook.post("/linear", async (c) => {
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

  logger.debug("Received webhook", {
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
  const issue = await getIssue(filterResult.issueId);
  if (!issue) {
    logger.error("Issue not found", { issueId: filterResult.issueId });
    return c.json({ error: "Issue not found" }, 400);
  }

  // Get repository from custom field
  const repo = getRepositoryFromIssue(issue);
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
  const worktreePath = resolve(config.worktreesPath, issue.identifier);
  const task: AgentTask = {
    issueId: issue.id,
    identifier: issue.identifier,
    repo,
    worktreePath,
    status: "queued",
    title: issue.title,
  };

  queue.addTask(task);
  logger.info("Issue enqueued for processing", {
    issueId: issue.identifier,
    repo,
  });

  return c.json({ status: "enqueued", issueId: issue.identifier }, 200);
});

export { webhook };
