import type { LinearIssue } from "../types";

/**
 * Build a prompt for Claude Code from Linear issue context
 */
export function buildPrompt(
  issue: LinearIssue,
  repo: string,
  branch: string
): string {
  const sections: string[] = [];

  // Header with task context
  sections.push(`You are working on: ${issue.title}`);
  sections.push("");

  // Issue identifier for reference
  sections.push(`Issue: ${issue.identifier}`);
  sections.push(`Repository: ${repo}`);
  sections.push(`Branch: ${branch}`);
  sections.push("");

  // Main description
  if (issue.description) {
    sections.push("## Description");
    sections.push("");
    sections.push(issue.description);
    sections.push("");
  }

  // Parent issue context (if this is a sub-issue)
  if (issue.parent) {
    sections.push("## Parent Issue Context");
    sections.push("");
    sections.push(`Parent: ${issue.parent.identifier} - ${issue.parent.title}`);
    if (issue.parent.description) {
      sections.push("");
      sections.push("Parent Description:");
      sections.push(issue.parent.description);
    }
    sections.push("");
  }

  // Labels for context
  if (issue.labels.length > 0) {
    sections.push("## Labels");
    sections.push("");
    sections.push(issue.labels.map((l) => `- ${l.name}`).join("\n"));
    sections.push("");
  }

  // Comments for additional context
  if (issue.comments.length > 0) {
    sections.push("## Discussion");
    sections.push("");
    for (const comment of issue.comments) {
      const author = comment.user?.name || "Unknown";
      const date = new Date(comment.createdAt).toLocaleDateString();
      sections.push(`**${author}** (${date}):`);
      sections.push(comment.body);
      sections.push("");
    }
  }

  // Requirements and guidelines
  sections.push("## Requirements");
  sections.push("");
  sections.push("Please address the issue described above. Guidelines:");
  sections.push("");
  sections.push("- Make changes to address the issue requirements");
  sections.push("- Keep changes focused and minimal - only modify what's necessary");
  sections.push("- Write clear, meaningful commit messages");
  sections.push("- Ensure code compiles and passes type checks");
  sections.push("- Follow existing code patterns and conventions in the repository");
  sections.push("- If tests exist, ensure they pass");
  sections.push("");
  sections.push(
    "When complete, your changes will be committed and pushed to the branch for review."
  );

  return sections.join("\n");
}

/**
 * Build a summary of what the agent accomplished for the Linear comment
 */
export function buildCompletionSummary(
  hasChanges: boolean,
  branchName: string,
  prUrl?: string | null,
  error?: string
): string {
  if (error) {
    return `## Agent Failed

The agent encountered an error while working on this issue:

\`\`\`
${error}
\`\`\`

Please review the error and retry if appropriate.`;
  }

  if (!hasChanges) {
    return `## Agent Completed

The agent analyzed this issue but determined no code changes were necessary, or the changes could not be completed.

Please review and provide additional context if needed.`;
  }

  const sections: string[] = [];
  sections.push("## Agent Completed");
  sections.push("");
  sections.push(`Branch: \`${branchName}\``);

  if (prUrl) {
    sections.push("");
    sections.push(`Pull Request: ${prUrl}`);
  }

  sections.push("");
  sections.push("The agent has made changes to address this issue. Please review the changes and provide feedback.");

  return sections.join("\n");
}
