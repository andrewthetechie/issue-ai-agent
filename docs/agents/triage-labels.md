# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## `triage` vs `needs-triage`

The batch triage feature uses a configurable label (default `triage`, set via `batch.triage_label`) to identify issues that should be processed in batch mode. This is **distinct** from the `needs-triage` label used in the classification pipeline.

> **Warning: re-enqueue loop footgun.** The classifier applies `needs-triage` as a fallback `suggestedLabel` when it cannot confidently classify an issue ([`src/classifier.ts`](https://github.com/andrewthetechie/issue-ai-agent/blob/main/src/classifier.ts)). If you set `batch.triage_label: needs-triage`, the agent's own fallback classification will re-add the queue label after processing, creating a **re-enqueue loop** where the same issue is retried indefinitely. This is why the default batch triage label is the inert `triage` label rather than `needs-triage`.
