import { Probot } from "probot";
import { runPipeline } from "./pipeline.js";
import { handleComment } from "./comment-handler.js";

export default (app: Probot) => {
  app.on("issues.opened", async (context) => {
    const { owner, repo } = context.repo();
    const issueNumber = context.payload.issue.number;

    context.log.info({ owner, repo, issueNumber }, "Issue opened, starting pipeline");

    try {
      const result = await runPipeline(context);

      context.log.info(
        {
          owner,
          repo,
          issueNumber,
          category: result.classification?.category,
          labelsApplied: result.labelsApplied,
          replyPosted: result.replyPosted,
          errorCount: result.errors.length,
        },
        "Pipeline completed",
      );

      for (const error of result.errors) {
        context.log.error({ err: error.cause, step: error.step }, `Pipeline error: ${error.message}`);
      }
    } catch (error) {
      context.log.error({ err: error, owner, repo, issueNumber }, "Unexpected pipeline failure");
    }
  });

  app.on("issue_comment.created", async (context) => {
    await handleComment(context);
  });
};
