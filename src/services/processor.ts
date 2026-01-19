import { logger } from "../logger";
import * as queue from "./queue";
import { runAgent } from "./agent-runner";
import { saveState } from "./state";

let isProcessing = false;

/**
 * Process the next task in the queue if capacity is available
 */
async function processNext(): Promise<void> {
  // Check if we can start a new agent
  if (!queue.canStartNew()) {
    logger.debug("At max concurrent agents, waiting...");
    return;
  }

  // Get next task
  const task = queue.getNext();
  if (!task) {
    logger.debug("Queue is empty");
    return;
  }

  // Mark as running and save state
  queue.markRunning(task);
  await saveState(queue.getRunningTasks());

  try {
    // Run the agent
    const result = await runAgent(task);

    if (result.success) {
      queue.markComplete(task.issueId);
    } else {
      queue.markFailed(task.issueId, result.error);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error(`Unexpected error running agent`, { error, issueId: task.identifier });
    queue.markFailed(task.issueId, error);
  } finally {
    // Update state after completion
    await saveState(queue.getRunningTasks());
  }

  // Check for more work
  processNext();
}

/**
 * Start the queue processor
 * This should be called on server startup
 */
export function startProcessor(): void {
  if (isProcessing) {
    logger.warn("Processor already started");
    return;
  }

  isProcessing = true;
  logger.info("Queue processor started");

  // Check for work periodically
  setInterval(() => {
    if (queue.size() > 0 && queue.canStartNew()) {
      processNext();
    }
  }, 1000);
}

/**
 * Trigger immediate processing (called when new task is added)
 */
export function triggerProcessing(): void {
  if (!isProcessing) {
    logger.warn("Processor not started, call startProcessor() first");
    return;
  }

  // Process immediately if we have capacity
  if (queue.canStartNew()) {
    processNext();
  }
}
