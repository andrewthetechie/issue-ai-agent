# PRD 0003 — Configurable priority labels

## Problem Statement

The workflow hardcodes the Forgejo label names it applies for issue priority. In `src/forgejo/labels.ts` the label is always generated as `priority: ${classification.priority}` (e.g. `priority: critical`, `priority: high`). If a Forgejo repository does not have labels with those exact names, the label application silently no-ops: Forgejo's `addLabels` API returns success for label names that do not exist in the repository, so `applyLabels()` throws no error, the warning paths in `applyLabels()` never fire, and the issue goes unlabelled for priority with nothing in the logs. Repository maintainers who use a different labelling convention (e.g. `P0`/`P1`/`P2`/`P3`, or `blocker`/`major`/`minor`) have no way to remap priority labels without forking the action.

## Solution

Add a `priority_label_mapping` key to the repo config (`.forgejo/issue-ai.yml`) that maps each internal priority tier (`critical`, `high`, `medium`, `low`) to one or more Forgejo label names. This mirrors the existing `label_mapping` for issue categories. The AI's internal priority vocabulary remains fixed; only the label names applied to the issue are configurable.

## User Stories

1. As a repository maintainer, I want to map the `critical` priority to my project's label (e.g. `P0`), so that the action applies a label that actually exists in my Forgejo instance.
2. As a repository maintainer, I want to map the `high`, `medium`, and `low` priorities to my project's labels, so that all four priority tiers are covered by my labelling scheme.
3. As a repository maintainer, I want to apply multiple Forgejo labels for a single priority (e.g. `P0` and `urgent`), so that I can satisfy projects that use overlapping label schemes.
4. As a repository maintainer, I want the action to continue using sensible defaults when I have not configured `priority_label_mapping`, so that existing deployments keep working without any config changes.
5. As a repository maintainer, I want to omit a priority key from my `priority_label_mapping` to suppress labelling for that priority, so that I can opt out of labelling low-importance issues without additional config.
6. As a repository maintainer, I want to set a priority's mapping to an empty array (e.g. `low: []`) to explicitly suppress labelling for that priority, so that my intent is clear even when the key is present.
7. As a repository maintainer, I want to disable all priority labelling by setting `priority_label_mapping: {}`, so that I can opt out of priority labels entirely without forking the action.
8. As a repository maintainer, I want a warning in the logs when my `priority_label_mapping` contains an unrecognised priority key (e.g. `urgent`), or when my `label_mapping` contains an unrecognised category key (e.g. `chore`), so that typos in either mapping are surfaced without aborting the workflow run.
9. As a repository maintainer, I want the README to document `priority_label_mapping` with a worked example, so that I can discover the feature and understand the expected format.

## Implementation Decisions

### Config shape

A top-level `priority_label_mapping` key is added to the repo config, parallel to the existing `label_mapping`. Each key is one of the four internal priority tiers; each value is an array of Forgejo label names:

```yaml
priority_label_mapping:
  critical: ["P0"]
  high: ["P1"]
  medium: ["P2"]
  low: ["P3"]
```

To apply multiple labels for a single priority:

```yaml
priority_label_mapping:
  critical: ["P0", "urgent"]
  high: ["P1"]
  medium: ["P2"]
  low: ["P3"]
```

To suppress labelling for a specific priority, either omit the key or set it to an empty array — both are treated identically:

```yaml
priority_label_mapping:
  critical: ["P0"]
  high: ["P1"]
  medium: ["P2"]
  low: []          # no label applied for low-priority issues
```

To disable all priority labelling:

```yaml
priority_label_mapping: {}
```

### Default behaviour

When `priority_label_mapping` is absent from the config, the workflow applies the existing hardcoded label names as defaults. This is equivalent to:

```yaml
priority_label_mapping:
  critical: ["priority: critical"]
  high: ["priority: high"]
  medium: ["priority: medium"]
  low: ["priority: low"]
```

No change in behaviour for existing deployments.

### Partial mappings

If `priority_label_mapping` is present but only specifies some priority tiers, the missing tiers produce no label. Omission is treated as intentional — not as a fallback to the default string. This applies equally to keys explicitly set to `[]`.

### Unknown key validation

This is **new loader behaviour**. The existing `label_mapping` loader (`src/config/loader.ts:70`) performs no key validation — it assigns `repoConfig.label_mapping ?? DEFAULT_CONFIG.labelMapping` with a bare `??` and never inspects the keys. This PRD introduces a small validation step and applies it to both mappings so the two stay consistent.

If `priority_label_mapping` contains a key that is not one of `critical`, `high`, `medium`, `low`, the loader logs a warning naming the unrecognised key and continues. The known keys are still applied normally.

For consistency, the same validation is added to `label_mapping`: if it contains a key that is not one of the known issue categories (`bug`, `feature`, `question`, `docs`, `duplicate`, `invalid`, `security` — the keys of `DEFAULT_CONFIG.labelMapping`), the loader logs a warning naming the unrecognised key and continues. The known keys are still applied normally. Neither mapping aborts the run on an unknown key.

The `logger` needed for these warnings is already available — `loadConfig()` receives it as its fourth parameter (`src/config/loader.ts:11`).

### Type additions

The `RepoConfig` interface lives in `src/types.ts` (not `schema.ts`), and `DEFAULT_CONFIG` lives in `src/config/schema.ts`. The change touches both:

`src/types.ts` — add `priorityLabelMapping: Record<string, string[]>` as a field on the `RepoConfig` interface (alongside the existing `labelMapping: Record<string, string[]>` at `src/types.ts:56`).

`src/config/schema.ts` — add the default value to `DEFAULT_CONFIG` (alongside the existing `labelMapping` default):

```typescript
priorityLabelMapping: {
  critical: ["priority: critical"],
  high: ["priority: high"],
  medium: ["priority: medium"],
  low: ["priority: low"],
},
```

`src/config/loader.ts` reads `priority_label_mapping` from the YAML (snake_case) and maps it to `priorityLabelMapping` (camelCase), mirroring the existing `label_mapping` → `labelMapping` line at `src/config/loader.ts:70`:

```typescript
priorityLabelMapping: repoConfig.priority_label_mapping ?? DEFAULT_CONFIG.priorityLabelMapping,
```

Unknown keys in the user-supplied mapping are logged as warnings during config loading (see [Unknown key validation](#unknown-key-validation); this validation is new and is applied to `label_mapping` as well).

### Label resolution changes

`src/forgejo/labels.ts` — `resolveLabels()` currently does:

```typescript
mappedLabels.push(`priority: ${classification.priority}`);
```

This is replaced with a lookup into `config.priorityLabelMapping`:

```typescript
const priorityLabels = config.priorityLabelMapping[classification.priority] ?? [];
mappedLabels.push(...priorityLabels);
```

No other changes to `resolveLabels()` or `applyLabels()`.

## Testing Decisions

### Config loader (`test/config.test.ts` — augmented)

- Config with `priority_label_mapping` set returns the mapped values in `config.priorityLabelMapping`.
- Config without `priority_label_mapping` returns the default mapping.
- Config with a partial `priority_label_mapping` (e.g. only `critical` and `high`) returns only those keys; missing keys are absent (not defaulted).
- Config with an empty `priority_label_mapping: {}` returns an empty record.
- Config with an unknown `priority_label_mapping` key (e.g. `urgent`) logs a warning and still returns the known keys.
- Config with an unknown `label_mapping` key (e.g. `chore`) logs a warning and still returns the known keys (new validation for the existing key).
- Snake_case key `priority_label_mapping` is loaded correctly (consistent with `label_mapping`).

### Label resolution (`test/labels.test.ts` — augmented)

- `resolveLabels()` with a full `priorityLabelMapping` applies the mapped labels.
- `resolveLabels()` with the default mapping applies `priority: critical` etc. (backward compatibility).
- `resolveLabels()` with a missing priority key applies no label for that priority.
- `resolveLabels()` with `priority: []` applies no label for that priority.
- `resolveLabels()` with `priorityLabelMapping: {}` applies no priority labels.
- `resolveLabels()` with multiple labels per priority (e.g. `["P0", "urgent"]`) pushes both labels.

## Out of Scope

- Changing the AI's internal priority vocabulary (`critical`, `high`, `medium`, `low`) — those tiers remain fixed. Making them configurable requires re-prompting the LLM and updating the validator, and is a separate concern.
- Per-issue or conditional priority label logic — the mapping is static per-repo.
- Validation that the configured label names actually exist in the Forgejo instance — Forgejo's `addLabels` API no-ops for unknown label names (returns success, applies nothing), so a misconfigured label name fails silently just as the hardcoded name does today. Surfacing that to the maintainer is a separate concern.

## Further Notes

The silent-failure problem this PRD addresses (the action requests a label name that does not exist in Forgejo, `addLabels` no-ops, and the issue goes unlabelled with nothing in the logs) is the primary driver. The fix is intentionally narrow: a single new config key, one field added to the `RepoConfig` interface (`src/types.ts`) with its default in `DEFAULT_CONFIG` (`src/config/schema.ts`), a one-line change in `resolveLabels()`, and a default that preserves existing behaviour. The only behaviour added beyond the mapping itself is unknown-key warning validation in the loader, applied to both `priority_label_mapping` and the existing `label_mapping` for consistency. No prompt changes, no new modules.
