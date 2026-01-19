import { resolve } from "path";
import { config } from "../config";
import { logger, createIssueLogger, type IssueLogger } from "../logger";
import type { AgentTask, AgentResult, LinearIssue } from "../types";
import { getIssue, updateIssueStatus, addComment } from "./linear-client";
import { buildPrompt, buildCompletionSummary } from "./prompt-builder";
import {
  createWorktree,
  hasChanges,
  commitChanges,
  pushBranch,
  createPR,
} from "./git";

interface ClaudeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn Claude Code with a prompt in the specified directory
 */
async function spawnClaude(
  worktreePath: string,
  prompt: string,
  issueLogger: IssueLogger
): Promise<ClaudeResult> {
  issueLogger.info("Spawning Claude Code");

  const proc = Bun.spawn(["claude", "-p", prompt], {
    cwd: worktreePath,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Set up timeout
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    issueLogger.error(`Claude Code timed out after ${config.agentTimeout}ms`);
    proc.kill();
  }, config.agentTimeout);

  // Stream output to log file
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();

  let stdout = "";
  let stderr = "";

  // Read stdout
  const readStdout = async () => {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      stdout += text;
      issueLogger.debug(text.trim());
    }
  };

  // Read stderr
  const readStderr = async () => {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const text = new TextDecoder().decode(value);
      stderr += text;
      if (text.trim()) {
        issueLogger.warn(text.trim());
      }
    }
  };

  // Wait for completion
  await Promise.all([readStdout(), readStderr(), proc.exited]);
  clearTimeout(timeoutId);

  const exitCode = proc.exitCode ?? 1;
  issueLogger.info(`Claude Code exited with code ${exitCode}`);

  return { exitCode, stdout, stderr, timedOut };
}

/**
 * Run the agent for a task
 */
export async function runAgent(task: AgentTask): Promise<AgentResult> {
  const issueLogger = createIssueLogger(task.identifier);
  issueLogger.info(`Starting agent for ${task.identifier}: ${task.title}`);

  try {
    // Resolve full repo path
    const repoPath = resolve(config.reposBasePath, task.repo);
    issueLogger.info(`Repository path: ${repoPath}`);

    // Fetch issue details for prompt
    const issue = await getIssue(task.issueId);
    if (!issue) {
      throw new Error(`Issue ${task.identifier} not found`);
    }

    // Create worktree
    issueLogger.info(`Creating worktree at ${task.worktreePath}`);
    await createWorktree(repoPath, task.worktreePath, task.identifier);

    // Update Linear status to In Progress
    try {
      await updateIssueStatus(task.issueId, config.inProgressStatus);
    } catch (e) {
      issueLogger.warn(`Failed to update status to In Progress: ${e}`);
    }

    // Add starting comment to Linear
    try {
      await addComment(
        task.issueId,
        `## Agent Started\n\nThe agent has started working on this issue.\n\nBranch: \`${task.identifier}\`\nLog: \`${issueLogger.getLogPath()}\``
      );
    } catch (e) {
      issueLogger.warn(`Failed to add starting comment: ${e}`);
    }

    // Build prompt and run Claude
    const prompt = buildPrompt(issue, task.repo, task.identifier);
    issueLogger.debug("Built prompt for Claude");

    const claudeResult = await spawnClaude(
      task.worktreePath,
      prompt,
      issueLogger
    );

    if (claudeResult.timedOut) {
      const errorMessage = `Agent timed out after ${config.agentTimeout / 60000} minutes`;
      await handleFailure(task, issueLogger, errorMessage);
      return {
        success: false,
        error: errorMessage,
        hasChanges: false,
      };
    }

    if (claudeResult.exitCode !== 0) {
      const errorMessage = `Claude exited with code ${claudeResult.exitCode}: ${claudeResult.stderr || claudeResult.stdout}`;
      await handleFailure(task, issueLogger, errorMessage);
      return {
        success: false,
        error: errorMessage,
        hasChanges: false,
      };
    }

    // Check for changes
    const hasCodeChanges = await hasChanges(task.worktreePath);
    issueLogger.info(`Has changes: ${hasCodeChanges}`);

    if (!hasCodeChanges) {
      // No changes - still a success, just nothing to commit
      const summary = buildCompletionSummary(false, task.identifier);
      await addComment(task.issueId, summary);
      await updateIssueStatus(task.issueId, config.reviewStatus);

      return {
        success: true,
        branchName: task.identifier,
        hasChanges: false,
        summary: "No code changes were made",
      };
    }

    // Commit and push
    const commitMessage = `feat: ${task.title}`;
    await commitChanges(task.worktreePath, commitMessage);
    issueLogger.info("Committed changes");

    await pushBranch(task.worktreePath, task.identifier);
    issueLogger.info("Pushed to origin");

    // Create PR
    const prBody = `## Summary\n\nAutomatically generated by Linear Agent for [${task.identifier}](https://linear.app/issue/${task.identifier}).\n\n---\n\n*This PR was created by an AI agent. Please review carefully.*`;
    const prUrl = await createPR(
      task.worktreePath,
      `${task.identifier}: ${task.title}`,
      prBody
    );

    // Update Linear with completion
    try {
      const summary = buildCompletionSummary(true, task.identifier, prUrl);
      await addComment(task.issueId, summary);
      await updateIssueStatus(task.issueId, config.reviewStatus);
    } catch (e) {
      issueLogger.warn(`Failed to update Linear on completion: ${e}`);
    }

    issueLogger.info("Agent completed successfully");

    return {
      success: true,
      branchName: task.identifier,
      prUrl: prUrl ?? undefined,
      hasChanges: true,
      summary: `Created branch ${task.identifier}${prUrl ? ` and PR ${prUrl}` : ""}`,
    };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    issueLogger.error(`Agent failed: ${errorMessage}`);
    await handleFailure(task, issueLogger, errorMessage);

    return {
      success: false,
      error: errorMessage,
      hasChanges: false,
    };
  }
}

/**
 * Handle agent failure - update Linear with error
 */
async function handleFailure(
  task: AgentTask,
  issueLogger: IssueLogger,
  error: string
): Promise<void> {
  try {
    const summary = buildCompletionSummary(false, task.identifier, null, error);
    await addComment(task.issueId, summary);
  } catch (e) {
    issueLogger.error(`Failed to add error comment to Linear: ${e}`);
  }
}
