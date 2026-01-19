import { Hono } from "hono";
import { resolve } from "path";
import { config } from "../config";
import { logger } from "../logger";
import { getClient, isProviderConfigured } from "../providers";
import * as queue from "../services/queue";
import { triggerProcessing } from "../services/processor";
import type { AgentTask, IssueProvider } from "../types";

const retry = new Hono();

/**
 * POST /retry/:issueId - Manually retry a failed or stuck issue
 *
 * Query parameters:
 * - provider: "linear" | "github" (defaults to "linear" for backwards compatibility)
 */
retry.post("/:issueId", async (c) => {
  const issueId = c.req.param("issueId");
  const providerParam = c.req.query("provider") as IssueProvider | undefined;
  const provider: IssueProvider = providerParam || "linear";

  logger.info(`Manual retry requested for issue ${issueId}`, { provider });

  // Validate provider is configured
  if (!isProviderConfigured(provider)) {
    logger.error(`Provider ${provider} is not configured`);
    return c.json({ error: `Provider "${provider}" is not configured` }, 400);
  }

  // Check if already queued or running
  if (queue.isQueued(issueId)) {
    logger.warn(`Issue ${issueId} is already queued`);
    return c.json({ error: "Issue already queued" }, 409);
  }

  if (queue.isRunning(issueId)) {
    logger.warn(`Issue ${issueId} is already running`);
    return c.json({ error: "Issue already running" }, 409);
  }

  // Get the appropriate client
  const client = getClient(provider);

  // Fetch fresh issue data
  const issue = await client.getIssue(issueId);
  if (!issue) {
    logger.error(`Issue ${issueId} not found`);
    return c.json({ error: "Issue not found" }, 404);
  }

  // Get repository from issue
  const repo = client.getRepository(issue);
  if (!repo) {
    logger.error(`Repository not specified for issue ${issue.identifier}`);
    return c.json(
      {
        error: `Repository not specified for this issue.`,
      },
      400
    );
  }

  // Get branch name from client
  const branchName = client.getBranchName(issue);
  const worktreePath = resolve(config.worktreesPath, branchName);

  // Create task and add to queue
  const task: AgentTask = {
    issueId: issue.id,
    identifier: issue.identifier,
    repo,
    worktreePath,
    status: "queued",
    title: issue.title,
    provider,
  };

  queue.addTask(task);
  logger.info(`Issue ${issue.identifier} added to queue for retry`, { provider });

  // Trigger immediate processing
  triggerProcessing();

  return c.json({ queued: true, issueId: issue.identifier, provider }, 200);
});

export { retry };
