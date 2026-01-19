import { config } from "../../config";
import { logger } from "../../logger";
import type { Issue, IssueLabel, IssueComment, ParentIssue } from "../../types";
import type { IssueClient } from "../types";

/**
 * GitHub API response types
 */
interface GitHubLabel {
  id: number;
  name: string;
  color: string;
}

interface GitHubUser {
  login: string;
  id: number;
}

interface GitHubComment {
  id: number;
  body: string;
  created_at: string;
  user: GitHubUser;
}

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  labels: GitHubLabel[];
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  state: "open" | "closed";
}

/**
 * GitHub issue client implementing the IssueClient interface
 *
 * Uses the GitHub REST API to manage issues. Status updates are done
 * via labels rather than workflow states.
 *
 * Issue identifiers are in the format "owner/repo#123"
 */
export class GitHubIssueClient implements IssueClient {
  readonly provider = "github" as const;
  private baseUrl = "https://api.github.com";

  constructor() {
    if (!config.githubToken) {
      throw new Error("GITHUB_TOKEN is required for GitHub provider");
    }
  }

  /**
   * Make an authenticated request to the GitHub API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(`GitHub API: ${method} ${path}`);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "issue-agent",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    // Handle 204 No Content responses
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Parse a GitHub issue identifier (owner/repo#123) into its components
   */
  private parseIdentifier(issueId: string): {
    owner: string;
    repo: string;
    number: number;
  } {
    // Format: owner/repo#123
    const match = issueId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) {
      throw new Error(
        `Invalid GitHub issue identifier: ${issueId}. Expected format: owner/repo#123`
      );
    }
    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    };
  }

  /**
   * Fetch an issue from GitHub and convert to generic Issue format
   */
  async getIssue(issueId: string): Promise<Issue | null> {
    try {
      const { owner, repo, number } = this.parseIdentifier(issueId);
      logger.debug(`Fetching GitHub issue ${owner}/${repo}#${number}`);

      const ghIssue = await this.request<GitHubIssue>(
        "GET",
        `/repos/${owner}/${repo}/issues/${number}`
      );

      // Fetch comments if configured
      let comments: IssueComment[] = [];
      if (config.includeComments) {
        const ghComments = await this.request<GitHubComment[]>(
          "GET",
          `/repos/${owner}/${repo}/issues/${number}/comments`
        );
        comments = ghComments.map((comment) => ({
          id: String(comment.id),
          body: comment.body,
          createdAt: comment.created_at,
          user: { name: comment.user.login },
        }));
      }

      // Convert labels
      const labels: IssueLabel[] = ghIssue.labels.map((label) => ({
        id: String(label.id),
        name: label.name,
      }));

      // GitHub doesn't have native parent issues, but we could potentially
      // parse references from the body. For now, leave undefined.
      const parent: ParentIssue | undefined = undefined;

      const issue: Issue = {
        id: issueId, // Use the full identifier as ID
        identifier: issueId,
        title: ghIssue.title,
        description: ghIssue.body ?? undefined,
        labels,
        comments,
        parent,
        repository: `${owner}/${repo}`,
        metadata: {
          number: ghIssue.number,
          state: ghIssue.state,
          owner,
          repo,
        },
      };

      logger.debug(`Fetched GitHub issue ${issueId}: ${issue.title}`);
      return issue;
    } catch (e) {
      if (e instanceof Error && e.message.includes("404")) {
        logger.warn(`GitHub issue ${issueId} not found`);
        return null;
      }
      logger.error(`Failed to fetch GitHub issue ${issueId}`, {
        error: String(e),
      });
      throw e;
    }
  }

  /**
   * Update the status of an issue by adding/removing labels
   */
  async updateStatus(
    issueId: string,
    status: "in_progress" | "review"
  ): Promise<void> {
    const { owner, repo, number } = this.parseIdentifier(issueId);

    // Get current labels
    const ghIssue = await this.request<GitHubIssue>(
      "GET",
      `/repos/${owner}/${repo}/issues/${number}`
    );

    const currentLabels = ghIssue.labels.map((l) => l.name);
    const inProgressLabel = config.githubInProgressLabel;
    const reviewLabel = config.githubReviewLabel;

    // Calculate new label set
    let newLabels = currentLabels.filter(
      (l) => l !== inProgressLabel && l !== reviewLabel
    );

    if (status === "in_progress") {
      newLabels.push(inProgressLabel);
    } else if (status === "review") {
      newLabels.push(reviewLabel);
    }

    // Update labels
    await this.request("PATCH", `/repos/${owner}/${repo}/issues/${number}`, {
      labels: newLabels,
    });

    logger.info(`Updated GitHub issue ${issueId} status to "${status}"`);
  }

  /**
   * Add a comment to an issue
   */
  async addComment(issueId: string, body: string): Promise<void> {
    const { owner, repo, number } = this.parseIdentifier(issueId);

    await this.request(
      "POST",
      `/repos/${owner}/${repo}/issues/${number}/comments`,
      { body }
    );

    logger.info(`Added comment to GitHub issue ${issueId}`);
  }

  /**
   * Get repository from issue
   * For GitHub, this is already stored in the issue's repository field
   */
  getRepository(issue: Issue): string | null {
    return issue.repository ?? null;
  }

  /**
   * Branch name for GitHub: owner-repo-123
   * This avoids conflicts between different repos
   */
  getBranchName(issue: Issue): string {
    const metadata = issue.metadata as {
      owner: string;
      repo: string;
      number: number;
    };
    return `${metadata.owner}-${metadata.repo}-${metadata.number}`;
  }
}
