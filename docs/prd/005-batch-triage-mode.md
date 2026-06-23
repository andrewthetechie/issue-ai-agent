# PRD 005: Batch Triage Mode

## Problem Statement

The issue triage agent currently only activates in response to individual GitHub/Forgejo events (`issues.opened`, `issue_comment.created`). Repositories that already have a backlog of untriaged issues — or that want to periodically sweep for issues needing attention — have no way to trigger the agent proactively. Maintainers must manually classify, label, and search for duplicates across a potentially large backlog.

## Solution

Add a **batch triage mode** that activates when the workflow is triggered by a `schedule` or `workflow_dispatch` event. In batch mode, the agent fetches open issues tagged with a configurable triage label (default: `triage`), processes up to a configurable limit of them (default: 5, oldest first), and removes the triage label from each issue it successfully handles. This allows maintainers to drain a backlog incrementally across scheduled runs without any manual intervention.

## User Stories

1. As a maintainer, I want the agent to run on a schedule so that newly filed issues are triaged automatically without requiring me to set up event-driven workflows for every issue type.
2. As a maintainer, I want the agent to pick up a fixed number of issues per run so that I can control API costs and rate limit exposure.
3. As a maintainer, I want the agent to process the oldest untriaged issues first so that no issue starves while newer ones are handled.
4. As a maintainer, I want to trigger the triage sweep manually via `workflow_dispatch` so that I can run a batch on demand without waiting for the next scheduled run.
5. As a maintainer, I want to use a label (default: `triage`) to mark which issues the batch agent should pick up, so that I can control which issues enter the automated triage queue.
6. As a maintainer, I want to configure the triage label name in the repo config file so that I can match my existing labeling conventions.
7. As a maintainer, I want to configure the batch size limit in the repo config file so that I can tune cost and throughput for my repo's volume.
8. As a maintainer, I want the triage label removed from an issue after the agent successfully classifies and labels it, so that the issue does not get picked up again on the next run.
9. As a maintainer, I want the triage label left in place if classification or labeling fails, so that the issue is retried on the next scheduled run rather than silently skipped.
10. As a maintainer, I want the agent to apply existing exclude rules (excluded users, excluded labels) in batch mode, so that bot-filed issues and already-resolved issues are never accidentally processed.
11. As a maintainer, I want excluded issues to have their triage label removed and receive a brief comment explaining the exclusion, so that issue authors understand why automated triage did not run and the issue does not re-enter the batch queue.
12. As a maintainer, I want the agent to search for duplicate issues even in batch mode, so that stale duplicate issues in the backlog are identified.
13. As a maintainer, I want the agent to post a short templated comment when it finds a duplicate in batch mode, so that the duplicate relationship is surfaced even though no generic acknowledgment reply is posted.
14. As a maintainer, I want no generic acknowledgment reply posted to old issues in batch mode, so that issue authors are not spammed with out-of-context "thanks for filing" responses.
15. As a maintainer, I want a single workflow file covering all four trigger types (`issues`, `issue_comment`, `schedule`, `workflow_dispatch`) so that there is one place to configure the agent.
16. As a maintainer, I want the action to report `issues-processed` and `issues-failed` output counts in batch mode, so that I can observe batch run health from the workflow summary.
17. As a maintainer, I want the batch sweep to process issues sequentially so that failures are predictable and rate limit exposure is minimised.
18. As a maintainer, I want duplicate search failures in batch mode to not block triage label removal, so that a transient LLM error doesn't cause an issue to be re-processed unnecessarily.

## Implementation Decisions

- **Mode detection:** The action infers batch mode from `github.event_name`. Events `schedule` and `workflow_dispatch` → batch mode. Events `issues` and `issue_comment` → existing event-driven mode. No new action input is added. `main.ts` currently casts `ctx.eventName as "issues" | "issue_comment"` and routes only those two (the `else` branch warns "Unsupported event"); routing is extended to dispatch the two new event names to `runBatchPipeline`.

- **New top-level function `runBatchPipeline`:** Analogous to `runPipeline`, this function is the entry point for batch mode. Its signature mirrors `runPipeline` exactly: `runBatchPipeline(actx: ActionContext, serverUrl: string, token: string)`. The explicit `serverUrl`/`token` params are required because `searchSimilarIssues` (and the new `fetchIssuesByLabel` / `removeLabelFromIssue`) need them, and `token` is deliberately kept off `ActionContext` to avoid credential leaks if the context is ever logged (see `src/types.ts`). It returns a `BatchResult` with `issuesProcessed` and `issuesFailed` counts. It owns the fetch-loop, per-issue dispatch, and triage label removal. A new `BatchResult` interface is added to `src/types.ts`.

- **Per-issue batch steps:** classify → apply labels → duplicate search → (post duplicate comment only if duplicates found) → remove triage label. The reply step is unconditionally skipped in batch mode. The existing `classifyIssue`, `applyLabels`, `searchSimilarIssues`, and `detectDuplicates` functions are reused without modification.

- **New duplicate-comment step:** There is no existing reusable code path that posts a duplicate-only comment — in the event-driven pipeline, duplicates are surfaced *only* by being embedded into the LLM reply via `draftReply` (`src/replier.ts`), and `runPipeline` otherwise just stores `relatedIssues` on the classification. Because the reply step is skipped in batch mode, batch mode needs a **new, small, non-LLM comment step**: a function (e.g. `postDuplicateComment`) that renders a short static markdown template listing the detected duplicate issue numbers/links and posts it via `octokit.rest.issues.createComment`. This is a templated comment, not a prompt — it does not call the LLM and therefore does not violate the "no new LLM prompt" non-goal.

- **Triage label removal condition:** The triage label is removed only when both classify and label steps succeed. A duplicate search failure (and a duplicate-comment post failure) does not block removal. If classify or label fails, the triage label is left in place for retry on the next run.

- **`shouldExclude` extraction:** `shouldExclude` is currently a private, non-exported function in `src/pipeline.ts` keyed to the webhook `payload.issue` shape. Before it can be reused in batch mode (where issues come from a fetch as `Issue` objects, not from a payload), it is extracted to a shared location (e.g. `src/utils.ts` or a small `src/exclude.ts`) and generalized to accept `{ user: { login } | undefined, labels: Array<{ name: string }> }` plus the `RepoConfig`. `runPipeline` is updated to call the extracted function with the payload issue; `runBatchPipeline` calls it with each fetched `Issue`.

- **New Forgejo function `fetchIssuesByLabel`:** Fetches open issues carrying the configured triage label, oldest first, capped at `batchLimit`. Implemented in the raw-`fetch` style of `search.ts` (not octokit), calling the repo-scoped endpoint `GET {serverUrl}/api/v1/repos/{owner}/{repo}/issues?state=open&type=issues&labels={triageLabel}&sort=oldest&limit={batchLimit}` with an `Authorization: token {token}` header. Forgejo's issues endpoint supports oldest-first ordering server-side via `sort=oldest` (verified against `context/swagger.v1.json`; there is no separate `order` param), and `type=issues` excludes pull requests. The returned list is still truncated to `batchLimit` client-side as a defensive bound. Lives in the `forgejo/` module alongside `search.ts` and `labels.ts`.

- **New Forgejo function `removeLabelFromIssue`:** Removes a single label from an issue by name. Implemented in the raw-`fetch` style of `search.ts` (consistent with `fetchIssuesByLabel`), calling `DELETE {serverUrl}/api/v1/repos/{owner}/{repo}/issues/{index}/labels/{id}` (resolving the label id, or using the by-name delete endpoint if available) with an `Authorization: token {token}` header. A `404` (label not present on the issue) is treated as success — the desired end state is "label absent."

- **Config schema additions:** Config is parsed by a hand-written snake_case→camelCase mapper in `src/config/loader.ts` (there is no schema validator), so this touches three files: `RepoConfig` in `src/types.ts`, `DEFAULT_CONFIG` in `src/config/schema.ts`, and the mapping in `loader.ts`. A new optional `batch` object is added. In YAML (snake_case) it is:
  - `batch.triage_label` (string, default: `"triage"`) — the label used to find issues for batch processing
  - `batch.batch_limit` (number, default: `5`) — maximum issues processed per run

  These map onto `RepoConfig.batch.{ triageLabel: string; batchLimit: number }` (camelCase) following the existing convention (e.g. `max_issue_length` → `maxIssueLength`).

- **`ActionContext` type extension:** `eventName` is widened to include `"schedule"` and `"workflow_dispatch"` alongside the existing `"issues"` and `"issue_comment"` values. The cast in `main.ts` is widened to match.

- **Action outputs in batch mode:** `issues-processed` (count of successfully triaged issues) and `issues-failed` (count of issues that errored and were skipped). These two outputs must also be declared in `action.yml` (which currently declares only `category`, `priority`, `labels-applied`, `reply-posted`). The existing per-issue outputs are not set in batch mode.

- **Sequential processing:** Issues are processed one at a time. No concurrency.

- **No `workflow_dispatch` inputs:** The config file is the sole source of truth for `triage_label` and `batch_limit`. Manual dispatch runs use whatever values are in the config.

- **Exclude rules apply:** Before processing each fetched issue, the extracted `shouldExclude` logic (excluded users, excluded labels) is applied. Issues that match are **drained**: the triage label is removed (so the issue is not re-queued on the next run) and an explanatory comment is posted via `postExcludeRemovalComment` stating whether the exclusion reason is `"user"` (the issue author is on the configured exclude list) or `"label"` (the issue carries a configured excluded label). This drain behaviour is always-on (no config flag to disable it). Drain failures (label removal or comment post errors) are swallowed with a warning and do not count against `issuesFailed`. Excluded issues are not processed and do not count against either `issuesProcessed` or `issuesFailed`.

## Testing Decisions

Good tests for this feature assert observable external behavior — what labels end up on issues, what comments are posted, what counts are returned — without asserting on internal call sequences or implementation details.

**`runBatchPipeline` (primary seam):** The highest-value tests live here. Mock the Forgejo API (issue fetch, label apply, label remove, comment post — note fetch/remove use raw `fetch`, so stub `globalThis.fetch` as `search.test.ts` does, while label apply/comment go through the mocked octokit) and the LLM client. Assert that: the correct number of issues are processed up to the limit; the triage label is removed on success and retained on classify/label failure; a duplicate comment is posted when duplicates are found and not otherwise; a duplicate-comment post failure does not block label removal; excluded issues are bypassed and not counted as failures; issues are processed oldest-first. Prior art: `test/pipeline.test.ts`.

**`fetchIssuesByLabel` (Forgejo fetch seam):** Unit tests (stubbing `fetch`) asserting the request URL carries `state=open`, `type=issues`, `labels={triageLabel}`, `sort=oldest`, and `limit={batchLimit}`, and that the returned list is truncated to `batchLimit`. Prior art: `test/search.test.ts`.

**`removeLabelFromIssue` (label removal seam):** Unit tests (stubbing `fetch`) asserting the correct `DELETE` request is made and that a 404 (label not present) is treated as success rather than throwing. Prior art: `test/search.test.ts` (raw-fetch style) and `test/labels.test.ts`.

**`shouldExclude` extraction (regression):** A unit test for the extracted/generalized function asserting it excludes by user and by label given an `Issue`-shaped input, and that `runPipeline`'s existing exclude behavior is unchanged. Prior art: `test/pipeline.test.ts`.

**`main.ts` routing (entry seam):** Tests asserting that `schedule` and `workflow_dispatch` event names invoke `runBatchPipeline` and set `issues-processed`/`issues-failed` outputs, while existing event names continue to invoke the existing handlers. Prior art: `test/main.test.ts`.

## Out of Scope

- `workflow_dispatch` inputs for per-run override of `triage_label` or `batch_limit`.
- Concurrent issue processing.
- Randomised or priority-based issue ordering (oldest-first is the only strategy).
- A generic acknowledgment reply in batch mode.
- Any new LLM prompt specific to batch mode — existing classify and duplicate prompts are reused. (The new duplicate-comment step uses a static markdown template, not an LLM prompt, so it is not in scope here.)
- Automatic creation of the triage label if it doesn't exist in the repository.

## Further Notes

The triage label (default: `triage`) is distinct from the repo's existing `needs-triage` label documented in `docs/agents/triage-labels.md`. Maintainers should decide which label they want to use as the batch queue entry point and configure accordingly. The default `triage` was chosen to avoid collision with the more semantically specific `needs-triage` label already in use.

Note that `needs-triage` is not merely documented — the classifier applies it as a fallback `suggestedLabel` (see `src/classifier.ts`). Maintainers who set `batch.triage_label` to `needs-triage` therefore risk a re-enqueue loop: the agent's own fallback could put an issue back into the batch queue. This is another reason the default is the inert `triage` label, and it should be called out in the README/config docs.

The consuming repository's workflow (documented in `README.md`, currently showing only `issues` and `issue_comment` triggers) needs to be updated to add `schedule` and `workflow_dispatch` triggers in a single workflow file. This is a docs/README change in this repo, not a workflow file shipped by the action itself.
