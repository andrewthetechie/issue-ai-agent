# PRD-005 Bundled Review Outcomes

This document captures the per-PRD re-review outcomes for PRDs 002, 003, and 004, which were
bundled into the PRD-005 (Batch Triage Mode) branch and reviewed under the PRD-005 review gate.

## Background

The PRD-005 review head (`94b4a0a`) against base (`0479d27`) contained the complete
implementations of three other PRDs alongside batch-triage code. This was flagged as finding
**CQ-001** (severity: major) by the `code_quality` reviewer:

> PRD-005 branch bundles full implementations of PRDs 002, 003, and 004.

Because the PRD-005 branch has since been merged, the bundled PRDs were re-reviewed
individually below under the PRD-005 review gate.

## Review Provenance

| Field | Value |
| --- | --- |
| Review base SHA | `0479d277350dd8e2ea8309e3e668b9ddb9f9a921` |
| Reviewed head SHA | `94b4a0a0a0983304c1797bb5d6b5fba0772c01e9` |
| Source reviewer | `code_quality` |
| Source finding | CQ-001 |
| Extra review round | PRD-005, round 2 |
| Artifact directory | `.sandcastle/extra-review-runs/prd-005/round-02-head-94b4a0a/` |

## PRD-002 — Configurable Prompts

**Spec:** `docs/prd/002-configurable-prompts.md`

**Files introduced or modified by this PRD:**

| File | Change |
| --- | --- |
| `src/prompts/classify.ts` | Split into `CLASSIFY_PROMPT_BODY` + `CLASSIFY_FORMAT_SUFFIX` |
| `src/prompts/reply.ts` | Split into `REPLY_PROMPT_BODY` + `REPLY_FORMAT_SUFFIX` |
| `src/prompts/duplicate.ts` | Split into `DUPLICATE_PROMPT_BODY` + `DUPLICATE_FORMAT_SUFFIX` |
| `src/prompts/comment-reply.ts` | Split into `COMMENT_REPLY_PROMPT_BODY` + `COMMENT_REPLY_FORMAT_SUFFIX` |
| `src/prompts/resolver.ts` | New: `resolvePrompts()` — resolves inline/file-based prompt config |
| `src/config/loader.ts` | Added `resolvePrompts` call; `logger` parameter made required |
| `src/types.ts` | Added `PromptConfigEntry`, `RawPromptsConfig`, `RepoConfig.prompts` |
| `src/config/schema.ts` | Added default for `prompts` |
| `src/classifier.ts` | Consumer fallback: `config.prompts?.classify ?? CLASSIFY_SYSTEM_PROMPT` |
| `src/replier.ts` | Consumer fallback: `config.prompts?.reply ?? REPLY_SYSTEM_PROMPT` |
| `src/duplicate.ts` | Consumer fallback: `config.prompts?.duplicate ?? DUPLICATE_SYSTEM_PROMPT` |
| `src/comment-handler.ts` | Consumer fallback: `config.prompts?.commentReply ?? COMMENT_REPLY_SYSTEM_PROMPT` |

**Shared-helper churn attributable to this PRD:**

- `loadConfig` gained a required `logger` parameter (needed for resolver warnings).
- `loadConfig` now performs network I/O via `resolvePrompts` (file-based prompt fetching).
- `RepoConfig` shape changed: new `prompts` field.

**Re-review outcome:** Reviewed and accepted under the PRD-005 gate. All findings from the
original PRD-002 review (documented in `docs/plan/resolve-review-1.md`) were resolved before
merge. The shared-helper changes (required `logger` on `loadConfig`, network I/O in config
loading) are necessary for the feature and do not introduce regressions for batch mode.

## PRD-003 — Configurable Priority Labels

**Spec:** `docs/prd/003-configurable-priority-labels.md`

**Files introduced or modified by this PRD:**

| File | Change |
| --- | --- |
| `src/types.ts` | Added `priorityLabelMapping: Record<string, string[]>` to `RepoConfig` |
| `src/config/schema.ts` | Added `priorityLabelMapping` default to `DEFAULT_CONFIG` |
| `src/config/loader.ts` | Added `priority_label_mapping` → `priorityLabelMapping` mapping; unknown-key validation for both `label_mapping` and `priority_label_mapping` |
| `src/forgejo/labels.ts` | `resolveLabels()` uses `config.priorityLabelMapping` lookup instead of hardcoded `priority: ${classification.priority}` |

**Shared-helper churn attributable to this PRD:**

- `resolveLabels()` priority-label semantics changed: now configurable via `priorityLabelMapping`.
- `RepoConfig` shape changed: new `priorityLabelMapping` field.
- `loadConfig` now validates unknown keys in both label mappings.

**Re-review outcome:** Reviewed and accepted under the PRD-005 gate. The `resolveLabels`
rewrite is a clean lookup replacement that preserves backward compatibility via the default
mapping. The unknown-key validation in the loader is additive and non-breaking. No regressions
for batch mode.

## PRD-004 — Create Missing Labels

**Spec:** `docs/prd/004-create-missing-labels.md`

**Files introduced or modified by this PRD:**

| File | Change |
| --- | --- |
| `src/forgejo/labels.ts` | New: `ensureLabelsExist()` — paginated label list + best-effort create |
| `src/types.ts` | Added `createLabels: boolean` to `RepoConfig`; added `"createLabels"` to `PipelineError["step"]` |
| `src/config/schema.ts` | Added `createLabels: false` to `DEFAULT_CONFIG` |
| `src/config/loader.ts` | Added `create_labels` → `createLabels` mapping |
| `src/pipeline.ts` | Guarded `ensureLabelsExist` call before classification |

**Shared-helper churn attributable to this PRD:**

- `RepoConfig` shape changed: new `createLabels` field.
- `PipelineError["step"]` union extended with `"createLabels"`.

**Re-review outcome:** Reviewed and accepted under the PRD-005 gate. All findings from the
original PRD-004 review (documented in `docs/plan/resolve-review-004.md`) were resolved before
merge. The `ensureLabelsExist` function is opt-in (`createLabels: false` by default),
best-effort, and idempotent. It does not affect batch mode as it runs only in the
event-driven `runPipeline` path. No regressions.

## Shared Helper Summary

The following shared helpers were modified across PRDs 002-004 and are also depended on by
PRD-005 (batch mode):

| Helper | Modified by | Impact on batch mode |
| --- | --- | --- |
| `loadConfig` (required `logger`, network I/O via `resolvePrompts`) | PRD-002 | Batch mode calls `loadConfig` with a logger; prompt resolution is best-effort per key |
| `RepoConfig` shape (`prompts`, `priorityLabelMapping`, `createLabels`, `batch`) | PRDs 002, 003, 004, 005 | All fields are optional with defaults; batch mode reads only `batch.*` |
| `resolveLabels` (priority-label semantics) | PRD-003 | Batch mode reuses `resolveLabels`; configurable mapping applies uniformly |
| `shouldExclude` (extracted to `src/exclude.ts`) | PRD-005 | Extracted for batch reuse; no semantic change from event-driven path |

Each shared-helper change was reviewed for batch-mode compatibility and found acceptable.

## Preventive Measure

A release-process note has been added to `CONTRIBUTING.md` (#PRD-branch-isolation) stating
that a single branch must not accumulate multiple unmerged PRDs that share helpers. This
prevents the same drift for future PRDs.
