import type { Issue, IssueProvider } from "../types";

/**
 * Result of fetching an issue
 */
export interface GetIssueResult {
  issue: Issue;
  /** Provider-specific raw data for advanced use cases */
  raw?: unknown;
}

/**
 * Common interface for all issue provider clients
 *
 * Each provider (Linear, GitHub, etc.) implements this interface to provide
 * a unified way to interact with issues regardless of the source platform.
 */
export interface IssueClient {
  /** The provider this client handles */
  readonly provider: IssueProvider;

  /**
   * Fetch an issue by ID
   * @param issueId - The provider-specific issue ID
   */
  getIssue(issueId: string): Promise<Issue | null>;

  /**
   * Update the status of an issue
   * - Linear: Changes workflow state
   * - GitHub: Adds/removes labels
   *
   * @param issueId - The provider-specific issue ID
   * @param status - Status name ("in_progress" or "review")
   */
  updateStatus(issueId: string, status: "in_progress" | "review"): Promise<void>;

  /**
   * Add a comment to an issue
   * @param issueId - The provider-specific issue ID
   * @param body - Markdown body of the comment
   */
  addComment(issueId: string, body: string): Promise<void>;

  /**
   * Get the repository identifier from an issue
   * - Linear: From custom field
   * - GitHub: From the issue's repository
   *
   * @param issue - The issue to extract repository from
   * @returns Repository path (e.g., "owner/repo" or just "repo-name")
   */
  getRepository(issue: Issue): string | null;

  /**
   * Get the branch name for an issue
   * - Linear: Uses identifier (e.g., "ENG-123")
   * - GitHub: Formats as "owner-repo-123"
   *
   * @param issue - The issue to generate branch name for
   */
  getBranchName(issue: Issue): string;
}
