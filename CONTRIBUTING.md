# Contributing

## PRD Branch Isolation

A single branch **must not** accumulate multiple unmerged PRDs that share helpers.

### Rule

Each PRD must ship behind its own review gate. Do not bundle the implementation of one PRD
into another PRD's branch when they touch shared helpers such as:

- **Config loader** (`src/config/loader.ts`, `RepoConfig` shape, `DEFAULT_CONFIG`)
- **Label resolution** (`src/forgejo/labels.ts`, `resolveLabels`, `applyLabels`)
- **Exclude logic** (`src/exclude.ts`, `shouldExclude`)
- **Pipeline** (`src/pipeline.ts`, `runPipeline`, `PipelineError`)

### Rationale

When multiple PRDs share a branch and helpers:

1. **Review gates are bypassed.** Each PRD's defect surface is reviewed under the wrong lens
   (e.g., configurable-prompts defects reviewed as batch-triage defects), making under-scrutiny
   likely.
2. **Bisecting and reverting become fragile.** A regression in one PRD's shared helper (e.g.,
   `loadConfig` now performing network I/O) can break another PRD's feature and vice-versa,
   but the blame is ambiguous because the changes are interleaved.
3. **PRD-specific diffs are obscured.** Reviewers cannot focus on the feature they are
   evaluating because unrelated PRD changes dominate the diff.

### Process

1. **One PRD per branch.** Create a dedicated branch for each PRD (e.g., `prd-006-new-feature`).
2. **Merge prerequisites first.** If PRD-B depends on shared-helper changes from PRD-A, merge
   PRD-A's branch before starting PRD-B's branch. PRD-B's branch should be based on the
   merged state, not on a sibling branch.
3. **Rebase, don't merge.** If a prerequisite PRD lands after you've started work, rebase your
   branch onto the new `main` rather than merging the prerequisite branch into yours. This
   keeps the PRD diffs clean and attributable.

### Exception

If two PRDs are tightly coupled (e.g., one is a thin wrapper around the other) and share no
helpers outside their own modules, they may share a branch. Document the coupling in the PRD
specs and note the shared review gate in the PR description. When in doubt, use separate
branches.

### History

This rule was established after PRD-005 (batch triage) bundled the full implementations of
PRDs 002 (configurable prompts), 003 (configurable priority labels), and 004 (create missing
labels), which all modified shared helpers (`loadConfig`, `RepoConfig`, `resolveLabels`). See
[`docs/prd/005-bundled-review-outcomes.md`](docs/prd/005-bundled-review-outcomes.md) for the
per-PRD re-review outcomes.
