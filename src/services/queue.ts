import { config } from "../config";
import { logger } from "../logger";
import type { AgentTask, QueueItem, QueueStatus } from "../types";

// In-memory queue for pending tasks
const pendingQueue: QueueItem[] = [];

// Map of currently running agents by issue ID
const runningAgents: Map<string, AgentTask> = new Map();

/**
 * Add a task to the queue
 */
export function addTask(task: AgentTask): void {
  // Check if already queued or running
  if (isQueued(task.issueId) || isRunning(task.issueId)) {
    logger.warn(`Task for issue ${task.issueId} already exists, skipping`);
    return;
  }

  const item: QueueItem = {
    task: { ...task, status: "queued" },
    addedAt: new Date(),
  };

  pendingQueue.push(item);
  logger.info(`Added task for issue ${task.identifier} to queue`, {
    queueDepth: pendingQueue.length,
  });
}

/**
 * Get the next task from the queue (FIFO)
 */
export function getNext(): AgentTask | null {
  const item = pendingQueue.shift();
  return item?.task ?? null;
}

/**
 * Get the number of pending tasks
 */
export function size(): number {
  return pendingQueue.length;
}

/**
 * Check if a new agent can be started based on concurrency limits
 */
export function canStartNew(): boolean {
  return runningAgents.size < config.maxConcurrentAgents;
}

/**
 * Mark a task as running
 */
export function markRunning(task: AgentTask): void {
  const runningTask: AgentTask = {
    ...task,
    status: "running",
    startedAt: new Date(),
  };
  runningAgents.set(task.issueId, runningTask);
  logger.info(`Agent started for issue ${task.identifier}`, {
    runningCount: runningAgents.size,
  });
}

/**
 * Mark a task as completed and remove from running
 */
export function markComplete(issueId: string): void {
  const task = runningAgents.get(issueId);
  if (task) {
    runningAgents.delete(issueId);
    logger.info(`Agent completed for issue ${task.identifier}`, {
      runningCount: runningAgents.size,
    });
  }
}

/**
 * Mark a task as failed and remove from running
 */
export function markFailed(issueId: string, error?: string): void {
  const task = runningAgents.get(issueId);
  if (task) {
    runningAgents.delete(issueId);
    logger.error(`Agent failed for issue ${task.identifier}`, {
      error,
      runningCount: runningAgents.size,
    });
  }
}

/**
 * Check if an issue is currently queued
 */
export function isQueued(issueId: string): boolean {
  return pendingQueue.some((item) => item.task.issueId === issueId);
}

/**
 * Check if an issue is currently being processed
 */
export function isRunning(issueId: string): boolean {
  return runningAgents.has(issueId);
}

/**
 * Get the current status of the queue and running agents
 */
export function getStatus(): QueueStatus {
  return {
    queueDepth: pendingQueue.length,
    runningCount: runningAgents.size,
    runningAgents: Array.from(runningAgents.values()).map((task) => ({
      issueId: task.issueId,
      identifier: task.identifier,
      repo: task.repo,
      startedAt: task.startedAt || new Date(),
    })),
  };
}

/**
 * Get all running tasks (for state persistence)
 */
export function getRunningTasks(): AgentTask[] {
  return Array.from(runningAgents.values());
}

/**
 * Restore running tasks (for crash recovery)
 */
export function restoreRunningTasks(tasks: AgentTask[]): void {
  for (const task of tasks) {
    runningAgents.set(task.issueId, task);
  }
  logger.info(`Restored ${tasks.length} running tasks from state`);
}

/**
 * Clear all tasks (for testing)
 */
export function clear(): void {
  pendingQueue.length = 0;
  runningAgents.clear();
}
