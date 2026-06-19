import * as core from "@actions/core";
import * as github from "@actions/github";
import type { ActionContext, Logger } from "./types.js";
import { runPipeline } from "./pipeline.js";
import { handleComment } from "./comment-handler.js";

function formatMessage(msgOrObj: unknown, msg?: string): string {
  return typeof msgOrObj === "string"
    ? msgOrObj
    : `${msg ?? ""} ${JSON.stringify(msgOrObj)}`.trim();
}

function createActionLogger(): Logger {
  const logger: Logger = {
    info: (msgOrObj: unknown, msg?: string) => core.info(formatMessage(msgOrObj, msg)),
    warn: (msgOrObj: unknown, msg?: string) => core.warning(formatMessage(msgOrObj, msg)),
    error: (msgOrObj: unknown, msg?: string) => core.error(formatMessage(msgOrObj, msg)),
    debug: (msgOrObj: unknown, msg?: string) => core.debug(formatMessage(msgOrObj, msg)),
    child: () => logger,
  };

  return logger;
}

export async function main(): Promise<void> {
  const token = core.getInput("github-token") || process.env.GITHUB_TOKEN;
  if (!token) {
    core.setFailed("github-token input or GITHUB_TOKEN env var is required");
    return;
  }

  const anthropicKey = core.getInput("anthropic-api-key");
  const openaiKey = core.getInput("openai-api-key");
  const llmProvider = core.getInput("llm-provider");
  const configPath = core.getInput("config-path");

  if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;
  if (openaiKey) process.env.OPENAI_API_KEY = openaiKey;
  if (llmProvider) process.env.LLM_PROVIDER = llmProvider;

  const llmBaseURL = core.getInput("llm-base-url");
  if (llmBaseURL) {
    const provider = llmProvider || "anthropic";
    if (provider === "openai") {
      process.env.OPENAI_BASE_URL = llmBaseURL;
    } else {
      process.env.ANTHROPIC_BASE_URL = llmBaseURL;
    }
  }

  const octokit = github.getOctokit(token);

  let botLogin: string;
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    botLogin = data.login;
  } catch (error) {
    core.setFailed(
      `Failed to resolve bot identity: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const ctx = github.context;
  const { owner, repo } = ctx.repo;

  const actx: ActionContext = {
    owner,
    repo,
    botLogin,
    octokit,
    logger: createActionLogger(),
    configPath,
    eventName: ctx.eventName as "issues" | "issue_comment",
    payload: ctx.payload as ActionContext["payload"],
  };

  try {
    if (actx.eventName === "issues") {
      const result = await runPipeline(actx);

      core.setOutput("category", result.classification?.category ?? "");
      core.setOutput("priority", result.classification?.priority ?? "");
      core.setOutput("labels-applied", result.labelsApplied.join(","));
      core.setOutput("reply-posted", String(result.replyPosted));

      for (const error of result.errors) {
        core.error(`Pipeline error (${error.step}): ${error.message}`);
      }
    } else if (actx.eventName === "issue_comment") {
      await handleComment(actx);
    } else {
      core.warning(`Unsupported event: ${actx.eventName}`);
    }
  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
