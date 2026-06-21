# Plan — Resolve Code Review (PRD 0004 Create Missing Labels)

This plan fixes four findings from the code review of the `prd-004` branch, which
implements the opt-in `create_labels` feature. Each item is self-contained: it states the
file, the exact lines, the current code, the target code, and how to verify. Follow them in
order and run the verification commands at the end of each item before moving on.

## Context you need first

The feature adds an opt-in `create_labels` config key. When `true`, `ensureLabelsExist()`
runs once per `issues` event, before classification, and creates any label referenced by
`labelMapping`/`priorityLabelMapping` that does not already exist in the Forgejo repo. The
feature is best-effort and idempotent. Spec: `docs/prd/004-create-missing-labels.md`.

Relevant files:

- `src/forgejo/labels.ts` — `ensureLabelsExist()` (the function under review). Items 1, 2, 4.
- `src/pipeline.ts` — the guarded call site (`if (config.createLabels)`, lines 91–105).
- `test/labels.test.ts` — unit tests for `ensureLabelsExist`. Items 1, 4.
- `test/pipeline.test.ts` — pipeline integration tests. Item 3.

Current `ensureLabelsExist` shape (`src/forgejo/labels.ts:62-130`): builds a desired-name
set from both maps, paginates the existing-labels list via
`octokit.request("GET /repos/{owner}/{repo}/labels", { owner, repo, limit, page })`, diffs,
and `POST`s each missing name. The list call is allowed to throw (caught at the pipeline
call site); per-label create failures are swallowed with a warning; a `422` whose message
contains `"already exists"` is swallowed as a benign race.

Run the full affected suite after each item:

```
npx vitest run test/labels.test.ts test/pipeline.test.ts test/config.test.ts
```

---

## Item 1 — Send `#ededed` (with hash), not `ededed`

**Finding:** Spec deviation / potential `422`. The PRD ("Label metadata on creation")
prescribes `#ededed`; `context/swagger.v1.json:24095` documents the color example as
`#00aabb` (with hash). Forgejo returns `422` on an invalid color, and a `422` whose message
does not contain `"already exists"` is logged as a warning and the label is **never
created** — silently reintroducing the unlabelled-issue outcome this PRD exists to fix.

**File:** `src/forgejo/labels.ts:115`

Current:

```ts
await octokit.request("POST /repos/{owner}/{repo}/labels", {
  owner,
  repo,
  name,
  color: "ededed",
  description: "",
});
```

Target:

```ts
await octokit.request("POST /repos/{owner}/{repo}/labels", {
  owner,
  repo,
  name,
  color: "#ededed",
  description: "",
});
```

Consider hoisting the literal to a named constant next to `LABEL_PAGE_LIMIT` so the value
and the tests share one source of truth:

```ts
const DEFAULT_LABEL_COLOR = "#ededed";
```

**Test updates:** the assertions in `test/labels.test.ts` currently lock in the wrong value
and must be updated:

- `test/labels.test.ts:238` → `color: "#ededed"`
- `test/labels.test.ts:242` → `color: "#ededed"`
- `test/labels.test.ts:246` → `color: "#ededed"`
- `test/labels.test.ts:250` → `color: "#ededed"`
- `test/labels.test.ts:458` (in "created labels carry color #ededed...") → `color: "#ededed"`

**Verify:** `grep -n 'color: "ededed"' src test` returns nothing; the suite passes.

---

## Item 2 — Document the function's two failure contracts

**Finding:** Maintainability. `ensureLabelsExist` has an asymmetric failure contract — the
list call throws on failure (caught at `src/pipeline.ts:97`), while per-label create
failures are swallowed and the function returns normally. This split is correct but
non-obvious; the next reader has to reverse-engineer it from the pipeline.

**File:** `src/forgejo/labels.ts`, immediately above the `export async function
ensureLabelsExist(` declaration (line 62).

Add a doc comment:

```ts
/**
 * Ensures every label referenced by config.labelMapping / config.priorityLabelMapping
 * exists in the repo, creating only the missing ones. Idempotent and best-effort.
 *
 * Failure contract is intentionally asymmetric:
 *  - The existing-labels list call THROWS on failure; the caller (runPipeline) records
 *    a `createLabels` PipelineError and continues the rest of the pipeline.
 *  - Individual create failures are swallowed with a warning (one bad label never aborts
 *    the rest). A `422` whose message contains "already exists" is treated as a benign
 *    list/create race and swallowed silently.
 */
```

**Verify:** `npx tsc --noEmit` (or the project's typecheck script) passes; comment renders.
No behavior change, so existing tests stay green.

---

## Item 3 — Assert `ensureLabelsExist` runs *before* classification

**Finding:** Test gap. `test/pipeline.test.ts:260` ("...before classify") asserts only
`toHaveBeenCalledTimes(1)` and the call arguments — it never verifies ordering, so the test
would still pass if creation were moved after the `features.classify` block. The PRD treats
"creation must precede any labelling" as a core requirement.

**File:** `test/pipeline.test.ts`, inside the existing
`"calls ensureLabelsExist when createLabels is true, before classify"` test (lines 260–278).

Add an ordering assertion using Vitest's `invocationCallOrder`. The classifier path is the
thing creation must precede; spy on it (or on the labels `applyLabels`/`addLabels` path) and
compare call order. Using the already-mocked classifier:

```ts
const { classifyIssue } = await import("../src/classifier.js");

// ...after the existing expectations...
expect(ensureLabelsExist).toHaveBeenCalledTimes(1);
const ensureOrder = vi.mocked(ensureLabelsExist).mock.invocationCallOrder[0];
const classifyOrder = vi.mocked(classifyIssue).mock.invocationCallOrder[0];
expect(ensureOrder).toBeLessThan(classifyOrder);
```

If `classifyIssue` is not already mocked in this file, mock it at the top alongside the
existing module mocks (mirror how `ensureLabelsExist` is mocked at `test/pipeline.test.ts:48-53`),
or fall back to asserting order against the `octokit.rest.issues.addLabels` spy, whichever
is already wired. The mock must be a `vi.fn()` for `invocationCallOrder` to be populated.

**Verify:** Temporarily move the `if (config.createLabels)` block in `src/pipeline.ts` to
*after* the `features.classify` block and confirm this test now FAILS; then revert. Suite
passes with the block in its correct position.

---

## Item 4 — Make pagination termination robust to server page-size caps

**Finding:** Residual risk. `src/forgejo/labels.ts:97` terminates the list loop when
`labels.length < LABEL_PAGE_LIMIT` (100). If a Forgejo instance caps its page size below
100, a full first page returns fewer than 100 items and the loop stops early, missing later
pages — labels on page 2 are treated as missing and pointlessly re-created (or fail). The
PRD itself prescribes this termination, but it assumes the server honors the requested
`limit`, which the spec explicitly says is not pinned.

**File:** `src/forgejo/labels.ts:84-101`

Current:

```ts
const existingNames = new Set<string>();
let page = 1;
while (true) {
  const response = await octokit.request("GET /repos/{owner}/{repo}/labels", {
    owner,
    repo,
    limit: LABEL_PAGE_LIMIT,
    page,
  });
  const labels = response.data;
  for (const label of labels) {
    existingNames.add(label.name);
  }
  if (labels.length < LABEL_PAGE_LIMIT) {
    break;
  }
  page++;
}
```

Target — terminate only on an empty page, so it does not depend on the server honoring
`limit`. Cost is one extra (empty) request per run, which the PRD already deems negligible.
Guard the page counter to avoid an unbounded loop if the server ever ignores `page`:

```ts
const existingNames = new Set<string>();
const MAX_LABEL_PAGES = 100; // safety bound: 100 pages * 100/page = 10k labels
let page = 1;
while (page <= MAX_LABEL_PAGES) {
  const response = await octokit.request("GET /repos/{owner}/{repo}/labels", {
    owner,
    repo,
    limit: LABEL_PAGE_LIMIT,
    page,
  });
  const labels = response.data;
  if (labels.length === 0) {
    break;
  }
  for (const label of labels) {
    existingNames.add(label.name);
  }
  page++;
}
```

Add `MAX_LABEL_PAGES` as a top-level constant next to `LABEL_PAGE_LIMIT` rather than inline.

**Test updates / additions in `test/labels.test.ts`:**

- The existing two-page pagination test (around `test/labels.test.ts:301-340`) mocks two
  responses. With empty-page termination the code now issues a third (empty) list request,
  so add a trailing `.mockResolvedValueOnce({ data: [] })` to that test's `mockRequest`
  chain, and update any `toHaveBeenCalledTimes` count on the list call accordingly. The
  `limit: 100, page: 1` / `page: 2` assertions stay valid.
- Add a regression test for the capped-server case: server returns a page **shorter than
  `limit`** that is still non-empty, then a second non-empty page, then an empty page —
  assert the page-2 label is recognised as existing and **not** re-created. This is the
  scenario the old `< LABEL_PAGE_LIMIT` termination got wrong.

```ts
it("keeps paginating when the server returns short (capped) non-empty pages", async () => {
  const config: RepoConfig = {
    ...DEFAULT_CONFIG,
    labelMapping: { bug: ["bug"], feature: ["enhancement"] },
    priorityLabelMapping: {},
  };
  // Server caps page size below LABEL_PAGE_LIMIT: each page has 1 item (< 100) but more exist.
  mockRequest
    .mockResolvedValueOnce({ data: [{ name: "bug" }] })        // page 1, short but non-empty
    .mockResolvedValueOnce({ data: [{ name: "enhancement" }] }) // page 2
    .mockResolvedValueOnce({ data: [] });                       // page 3 terminates

  await ensureLabelsExist("owner", "repo", config, mockOctokit, mockLogger);

  // Both desired labels already exist across pages → no creates.
  const createCalls = mockRequest.mock.calls.filter(
    (call: unknown[]) => call[0] === "POST /repos/{owner}/{repo}/labels",
  );
  expect(createCalls).toHaveLength(0);
});
```

**Verify:** the new test fails against the old `< LABEL_PAGE_LIMIT` termination and passes
with the empty-page termination; full suite passes.

---

## Final verification

```
npx vitest run                 # full suite
npx tsc --noEmit               # or the project's typecheck script
npm run lint                   # if configured
```

Confirm:

1. No remaining `color: "ededed"` (without hash) in `src/` or `test/`.
2. The pipeline ordering test fails when the `createLabels` block is moved after classify.
3. The capped-server pagination test fails under the old termination condition.
4. `ensureLabelsExist` carries the failure-contract doc comment.
