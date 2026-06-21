# PRD 0004 — Create missing labels

## Problem Statement

When the workflow applies a label whose name does not exist in the target Forgejo repository, the application silently no-ops. Forgejo's add-labels API (`POST /repos/{owner}/{repo}/issues/{index}/labels`, called via `octokit.rest.issues.addLabels` in `src/forgejo/labels.ts:32`) returns success for label names that do not exist in the repository: nothing is applied, `applyLabels()` throws no error, its warning paths never fire, and the issue goes unlabelled with nothing in the logs.

This is the exact gap that PRD 0003 ("Configurable priority labels") called out as out of scope: _"Validation that the configured label names actually exist in the Forgejo instance — Forgejo's `addLabels` API no-ops for unknown label names."_ PRD 0003 made the label names configurable; it did not make them exist. A maintainer who configures `label_mapping`/`priority_label_mapping` (or relies on the defaults) but has not manually pre-created those labels in their Forgejo repo gets silent, invisible failure on every issue.

## Solution

Add an opt-in `create_labels` config key (default `false`) to the repo config (`.forgejo/issue-ai.yml`). When set to `true`, the workflow ensures every label name referenced by the effective configuration exists in the repository before it does any issue actions. It collects the union of all label names across `label_mapping` and `priority_label_mapping` (which already fall back to the built-in defaults when absent), lists the labels that already exist in the repo, and creates only the ones that are missing.

The feature is opt-in, best-effort, and idempotent. After the first run for a given repo, steady state is a single (paginated) list call and zero creates. Existing labels are never modified — only missing labels are created.

## User Stories

1. As a repository maintainer, I want the action to create the labels it needs before it tries to apply them, so that classification labels actually land on issues instead of silently no-op'ing.
2. As a repository maintainer, I want this behaviour to be opt-in (`create_labels: false` by default), so that existing deployments are completely unaffected and the action never creates labels I didn't ask for.
3. As a repository maintainer who has customised `label_mapping` and `priority_label_mapping`, I want the action to create exactly the label names I configured, so that my custom labelling scheme works without me hand-creating every label.
4. As a repository maintainer who uses the default mappings, I want the action to create the default label names (`bug`, `enhancement`, `priority: critical`, …), so that a fresh repo works out of the box once I enable the flag.
5. As a repository maintainer, I want label creation to run once before classification and to be idempotent, so that enabling it does not spam my repo with duplicate labels on every issue.
6. As a repository maintainer, I want label creation to be best-effort, so that if the token lacks permission or a single create fails, the rest of the pipeline (classification, reply) still runs.
7. As a repository maintainer, I want the action to leave labels I have already created untouched (including their colour), so that enabling the flag never recolours or rewrites my existing labels.
8. As a repository maintainer, I want `create_labels` documented in the README, so that I can discover the feature and understand its behaviour.

## Implementation Decisions

### Config shape

A top-level boolean `create_labels` is added to the repo config, parallel to the existing top-level `enabled` key. It is **not** an `action.yml` input — like all other behaviour config it lives only in `.forgejo/issue-ai.yml`.

```yaml
create_labels: true   # default: false
```

Mapped to `createLabels: boolean` on `RepoConfig`. The loader reads `repoConfig.create_labels ?? DEFAULT_CONFIG.createLabels`, default `false`. Placed top-level (next to `enabled`) rather than under `features`, because `features.*` gates issue-facing output stages whereas this is repo setup that runs before any of them.

### The desired label set

The set of labels to ensure is the **deduplicated union of all values** across the effective `config.labelMapping` and `config.priorityLabelMapping`. Because the loader already substitutes the full default map when a key is absent (`repoConfig.label_mapping ?? DEFAULT_CONFIG.labelMapping`, and likewise for priority), `config.labelMapping`/`config.priorityLabelMapping` are the single source of truth — no separate "config vs defaults" branching is needed in the creation logic.

Label names the LLM might emit in `suggestedLabels` are **not** included. `resolveLabels()` only ever applies names drawn from the two maps; it never applies raw `suggestedLabels`. Creating labels that can never be applied would be noise.

For the default configuration the desired set is:

```
bug, enhancement, question, documentation, duplicate, invalid, security,
priority: critical, priority: high, priority: medium, priority: low
```

### Idempotency and name matching

On each run (when `createLabels` is `true`):

1. Flatten both maps into a deduplicated set of desired names.
2. List the repository's existing labels via `GET /repos/{owner}/{repo}/labels`, **fully paginated** (loop on `limit`/`page` until an empty page is returned). Full pagination avoids treating page-2 labels as missing and issuing pointless re-create POSTs on label-heavy repos.

   **Pagination must use Forgejo's `limit`/`page` query params, not GitHub's `per_page`.** This instance's API spec (`context/swagger.v1.json`) documents `GET /repos/{owner}/{repo}/labels` as accepting `page` and `limit` ("page size of results") only — there is no `per_page`. The octokit client is `github.getOctokit` pointed at Forgejo's `/api/v1` (`src/main.ts:66`), and the existing code uses GitHub-shaped named methods (e.g. `octokit.rest.issues.addLabels`). The named method `octokit.rest.issues.listLabelsForRepo` serializes its page-size argument as `per_page`, which **Forgejo ignores** in favour of its own default page size — silently breaking pagination termination. Therefore the implementation must pass `limit` explicitly, either by forwarding it as an extra param on the named method — `octokit.rest.issues.listLabelsForRepo({ owner, repo, limit, page })` (extra keys are appended to the query string) — or via a raw `octokit.request("GET /repos/{owner}/{repo}/labels", { owner, repo, limit, page })`. The spec does not pin the server's default/max page size, so do not assume one: pass an explicit `limit` and terminate only when a page returns **zero** items. Terminating on a short page (fewer than `limit` items) is **incorrect** — Forgejo may cap the page size below the requested `limit`, so a short page is not a reliable end-of-list signal and would drop later pages, reintroducing the missing-page bug. A test must assert the list request carries `limit` (not `per_page`), and a test must assert pagination continues across short (server-capped) non-empty pages until an empty page is returned. This is the first read/create against Forgejo's label-collection endpoint in this codebase, so there is no existing pagination analog to copy.
3. Diff: a desired name is "missing" if no existing label has that **exact, case-sensitive** name (no trimming/normalisation).
4. Create each missing name via `POST /repos/{owner}/{repo}/labels`.

Exact, case-sensitive matching is deliberate. `applyLabels()` later sends the exact map string to Forgejo, so the label that must exist is the exact string in the map. A case-insensitive "already exists" judgement could decide `bug` exists because `Bug` does, skip creation, and let `applyLabels` silently no-op on `bug` — reintroducing the bug this PRD fixes. Forgejo permits names differing only by case, so an exact diff is safe.

### Label metadata on creation

Only `name` is derived from the maps. The remaining `CreateLabelOption` fields use fixed defaults:

- **`color`**: a single neutral default — `#ededed` (light grey) — for every created label. Forgejo's create endpoint treats colour as effectively required (returns `422` on a missing/invalid colour), so a value must be supplied. Per-label colours would be a whole new config surface and are out of scope.
- **`description`**: empty.
- **`exclusive`**: `false` (omitted). Forgejo exclusivity applies to scoped `scope/value` labels; the workflow's names (e.g. `priority: critical`) are plain names, so exclusivity does not apply.
- **`is_archived`**: `false` (omitted).

Metadata is set **only at creation time**. Labels that already exist are never patched — a maintainer who hand-coloured `bug` keeps their colour.

### Where it runs

A new exported function `ensureLabelsExist(owner, repo, config, octokit, logger)` is added to `src/forgejo/labels.ts`, co-located with `resolveLabels`/`applyLabels`.

It is invoked from `runPipeline` (`src/pipeline.ts`), guarded by `if (config.createLabels)`, positioned **after** the `enabled` check and the `shouldExclude` check, and **before** the `config.features.classify` block. Rationale for the gating order: a disabled or excluded issue should not trigger label creation; but creation must precede any labelling.

Scope is limited to the `issues` path (`runPipeline`). The `issue_comment` path (`handleComment`) applies no mapped labels, so it is left untouched — adding creation there would be redundant API calls.

Creation is gated **solely** on `config.createLabels` — independent of `features.classify` and of LLM availability:

- No LLM key (dev mode): labels are still applied via the mock-classification path, so creation is still useful.
- `features.classify: false`: creation still runs. The toggle's meaning stays predictable ("`create_labels: true` means the labels exist"), supporting maintainers who want the labels present for manual triage. The cost when classify is off is one paginated list call — negligible.

### Failure handling

Label creation is **best-effort and non-fatal**, wrapped like the other pipeline steps:

- A new `PipelineError` step `"createLabels"` is added to the `PipelineError["step"]` union in `src/types.ts`.
- If the **list call** fails (network/permission), log a warning, record a `createLabels` error, skip creation, and continue the pipeline.
- A **per-label create failure** (e.g. token lacks label-write scope → `403`) logs a warning naming the label and continues with the remaining labels — mirroring the one-by-one warn pattern already in `applyLabels()`. One failed label does not abort the step.
- An **"already exists" create response** (lost race: a label created between the list and the create) is treated as success and swallowed — not recorded as an error. Per this instance's API spec (`context/swagger.v1.json`), `POST /repos/{owner}/{repo}/labels` returns only `201`, `404`, or `422` — there is **no `409`**, so a duplicate name surfaces as a `422` (validationError). Because `422` also covers other validation failures (notably a missing/invalid `color`, since `CreateLabelOption` marks `color` required), the swallow must match on status `422` **and** an "already exists"-class message substring — never status alone — so a benign race is swallowed while a genuine validation `422` (e.g. bad colour) is still recorded as a `createLabels` error.

Because today's behaviour is already "labels silently no-op," any creation failure leaves the run no worse off than before, so it must never abort classification/reply.

### Type and default additions

- `src/types.ts` — add `createLabels: boolean` to the `RepoConfig` interface (top-level, next to `enabled`); add `"createLabels"` to the `PipelineError["step"]` union.
- `src/config/schema.ts` — add `createLabels: false` to `DEFAULT_CONFIG`.
- `src/config/loader.ts` — read `createLabels: repoConfig.create_labels ?? DEFAULT_CONFIG.createLabels`.

## Testing Decisions

### Label provisioning (`test/labels.test.ts` — augmented)

- `ensureLabelsExist()` flattens both maps and deduplicates: a name present in both `labelMapping` and `priorityLabelMapping` is created at most once.
- Creates only the names not already present; names that already exist trigger no create call.
- Exact, case-sensitive matching: an existing `Bug` does **not** suppress creation of a desired `bug`.
- Fully paginates the existing-labels list (a label on page 2 is recognised as existing and not re-created).
- Continues paginating across short (server-capped) non-empty pages, terminating only on an empty page.
- The list request is issued with Forgejo's `limit`/`page` query params (asserts `limit` is sent, not `per_page`).
- Swallows an "already exists" create response (matched by status + message, not a hard-coded `422`): no error recorded, run continues.
- A per-label create failure (e.g. `403`) logs a warning and the remaining labels are still attempted.
- Created labels are sent with the default grey colour and no description.
- Existing labels are never patched/updated.

### Pipeline integration (`test/pipeline.test.ts` — augmented)

- With `createLabels: false`, `ensureLabelsExist` is not invoked.
- With `createLabels: true`, creation runs before classification and a creation failure is recorded as a `createLabels` `PipelineError` without aborting classify/reply.
- Excluded or disabled issues do not trigger creation.

### Config loader (`test/config.test.ts` — augmented)

- Config with `create_labels: true` returns `createLabels: true`.
- Config without `create_labels` returns the default `false`.

## Out of Scope

- **Per-label colours, descriptions, or exclusivity.** All created labels get a fixed grey colour and no description. Configurable label metadata is a separate concern.
- **Updating/patching existing labels.** The feature only creates missing labels; it never recolours, renames, archives, or deletes existing ones.
- **Pre-flight token permission checks.** If the token lacks label-write scope, creates fail with `403`, are logged as warnings, and the pipeline continues (see assumptions below). The action does not probe for permission ahead of time.
- **Org-level labels.** Only repository labels (`/repos/{owner}/{repo}/labels`) are managed; Forgejo organisation labels (`/orgs/{org}/labels`) are not.
- **The `issue_comment` path.** Label creation runs only on the `issues` path, since the comment path applies no mapped labels.
- **Reconciling the AI's internal vocabulary.** The fixed category/priority tiers are unchanged (carried over from PRD 0003).

## Assumptions & Risks

- **Token scope.** Creating labels requires the Forgejo token to have label-write permission (`write:issue`). If it does not, creates return `403`; per the failure-handling design these are logged as warnings and the pipeline continues. This is recorded as a known assumption rather than guarded by a pre-flight check.
- **Extra API call per issue.** Enabling `create_labels` adds one paginated list call per `issues` event (plus creates only when something is missing). This is accepted as negligible.

## Further Notes

This PRD closes the silent-failure gap that PRD 0003 explicitly deferred. The change is intentionally narrow and additive: one new opt-in top-level config key (`create_labels`, default `false`), one new field on `RepoConfig` with its default in `DEFAULT_CONFIG`, one new `PipelineError` step, one new `ensureLabelsExist()` function in the existing `src/forgejo/labels.ts`, and a single guarded call in `runPipeline` before classification. No prompt changes, no new modules, and zero behaviour change for any deployment that does not opt in.
