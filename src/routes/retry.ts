import { Hono } from "hono";
import { resolve } from "path";
import { config } from "../config";
import { logger } from "../logger";
import { getIssue, getRepositoryFromIssue } from "../services/linear-client";
import * as queue from "../services/queue";
import { triggerProcessing } from "../services/processor";
import type { AgentTask } from "../types";

const retry = new Hono();

/**
 * POST /retry/:issueId - Manually retry a failed or stuck issue
 */
retry.post("/:issueId", async (c) => {
  const issueId = c.req.param("issueId");

  logger.info(`Manual retry requested for issue ${issueId}`);

  // Check if already queued or running
  if (queue.isQueued(issueId)) {
    logger.warn(`Issue ${issueId} is already queued`);
    return c.json({ error: "Issue already queued" }, 409);
  }

  if (queue.isRunning(issueId)) {
    logger.warn(`Issue ${issueId} is already running`);
    return c.json({ error: "Issue already running" }, 409);
  }

  // Fetch fresh issue data from Linear
  const issue = await getIssue(issueId);
  if (!issue) {
    logger.error(`Issue ${issueId} not found`);
    return c.json({ error: "Issue not found" }, 404);
  }

  // Get repository from custom field
  const repo = getRepositoryFromIssue(issue);
  if (!repo) {
    logger.error(`Repository not specified for issue ${issue.identifier}`);
    return c.json(
      {
        error: `Repository not specified. Please set the "${config.repoCustomFieldName}" custom field.`,
      },
      400
    );
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
  logger.info(`Issue ${issue.identifier} added to queue for retry`);

  // Trigger immediate processing
  triggerProcessing();

  return c.json({ queued: true, issueId: issue.identifier }, 200);
});

export { retry };
