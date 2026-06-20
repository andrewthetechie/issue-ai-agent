import type { Logger } from "./types.js";
import type { Issue, IssueClassification, IssueCategory, IssuePriority, RepoConfig } from "./types.js";
import type { LLMProvider } from "./llm/provider.js";
import { CLASSIFY_SYSTEM_PROMPT } from "./prompts/classify.js";
import { buildSafeIssueContent } from "./sanitizer.js";

const VALID_CATEGORIES: IssueCategory[] = ["bug", "feature", "question", "docs", "duplicate", "invalid", "security"];
const VALID_PRIORITIES: IssuePriority[] = ["critical", "high", "medium", "low"];

export function parseClassificationResponse(raw: string): IssueClassification {
  let jsonStr = raw.trim();

  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : "question";
    const priority = VALID_PRIORITIES.includes(parsed.priority) ? parsed.priority : "medium";

    return {
      category,
      priority,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      summary: String(parsed.summary || "Unable to summarize").substring(0, 200),
      suggestedLabels: Array.isArray(parsed.suggestedLabels)
        ? parsed.suggestedLabels.map(String).slice(0, 5)
        : [category],
      reasoning: String(parsed.reasoning || "").substring(0, 300),
    };
  } catch {
    return {
      category: "question",
      priority: "medium",
      confidence: 0.3,
      summary: "Failed to classify issue automatically",
      suggestedLabels: ["needs-triage"],
      reasoning: "LLM response was not valid JSON",
    };
  }
}

export async function classifyIssue(
  issue: Issue,
  sanitizedBody: string,
  sanitizedTitle: string,
  config: RepoConfig,
  llmClient: LLMProvider,
  logger: Logger,
): Promise<IssueClassification> {
  const userContent = buildSafeIssueContent(
    sanitizedTitle,
    sanitizedBody,
    issue.labels.map((l) => l.name),
  );

  logger.info({ issueNumber: issue.number, title: sanitizedTitle }, "Classifying issue");

  const response = await llmClient.complete(
    config.llm.model,
    CLASSIFY_SYSTEM_PROMPT,
    [{ role: "user", content: userContent }],
    config.llm.maxTokens,
  );

  const classification = parseClassificationResponse(response.text);

  logger.info(
    { issueNumber: issue.number, category: classification.category, priority: classification.priority, confidence: classification.confidence },
    "Issue classified",
  );

  return classification;
}
