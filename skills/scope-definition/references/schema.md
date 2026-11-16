# Schema reference: `intent.json`, `scope.json`, `journeys.json`

All three are plain JSON, written atomically (temp file + rename). `scope.json` and
`journeys.json` are committable; `intent.json` lives under `work/` (gitignored) and is a
scratch/review artifact between `intent` and `ground`.

## `intent.json` (`scope.mjs intent`, `work/intent.json`)

**The agent interprets the prompt and writes this file; no script parses prose.** Get a skeleton
with `scope.mjs intent --session <s> --template`, fill it in, then run
`scope.mjs intent --session <s> --from <intent.json>`. `--from` is required (exit 3 without it).
The script only validates the schema (`validateIntent`).

```jsonc
{
  "prompt": "…",                                  // must equal the session prompt verbatim
  "include": [                                    // what to find
    { "phrase": "invite dialog", "kind": "screen|state|feature|flow|any", "quoted": false,
      "evidence": "the invite dialog" }           // verbatim prompt substring, or {"assumption": "…"}
  ],
  "states": ["validation-error", "dark"],        // free strings (inventory state ids / labels)
  "viewports": ["mobile"],                       // free strings (inventory viewport names)
  "modalities": ["keyboard"],                    // subset of keyboard|mouse|sr-keyboard|sr-navigation
  "excludedModalities": [{ "modality": "sr-keyboard", "evidence": "no screen readers" }],
  "unsupportedModalities": ["touch"],            // asked for but not automatable
  "exclude": [{ "phrase": "billing page", "reason": "user excluded it", "evidence": "not the billing page" }],
  "actionPolicy": { "requestedDestructive": [{ "verb": "delete", "evidence": "delete a project" }],
                    "allowEvaluate": false, "allowStorage": false },
  "changedFiles": [],                            // filled from --base/--changed/--diff
  "limits": { "maxTargets": 40, "maxJourneySteps": 25, "maxExploreActions": 60 }
}
```

- `evidence` is required on `include`, `exclude`, `excludedModalities`, `requestedDestructive`, and
  on `allowEvaluate`/`allowStorage` when true (`allowEvaluateEvidence` / `allowStorageEvidence`).
  It is matched case- and whitespace-insensitively against the prompt. Anything inferred rather than
  said must use `{"assumption": "…"}`; assumptions are listed in `proposal.md` under
  "Interpretation assumptions" so the human approver can correct them.
- `quotedStrings` is derived by the validator from `include[].quoted`.
- `include[].kind` is a hint only; grounding uses it to prefer matching candidate kinds.
- A modality cannot be both `modalities` and `excludedModalities`.
- `actionPolicy.forbid` is computed: every destructive verb (`submit, delete, remove, purchase, buy,
  pay, send, sign out/log out, unsubscribe, deactivate, destroy, erase, wipe, archive, publish,
  checkout, cancel`) **except** those in `requestedDestructive` (the proposal warns about them).
- `limits` bound a single session's size; exceeding one is a blocker, not a silent truncation.

## `scope.json` (`scope.mjs propose` / `confirm` / `verify`)

```jsonc
{
  "schemaVersion": 1,
  "id": "invite-dialog-errors-3f2a",
  "status": "proposed | confirmed | verified | partial",
  "intent": "Invite dialog and its validation error, dark theme, mobile; no submits",
  "producers": ["text"],                       // union of journeys[].producer
  "inventory": ".a11y/inventory.json",         // relative to the app root
  "inventorySha256": "<hash at propose time>",
  "journeys": "journeys.json",                 // relative to this file's directory
  "journeysSha256": "<hash>",
  "targets": [                                  // EXACT keys, consumable as assess.mjs --target
    "team-members__default__mobile",
    "invite-dialog__default__mobile",
    "invite-dialog__validation-error__mobile",
    "invite-dialog__dark__mobile"
  ],
  "selection": { "features": null, "screens": ["team-members", "invite-dialog"],
                 "states": ["default", "validation-error", "dark"], "viewports": ["mobile"] },
  "excluded":   [{ "ref": "delete-member-dialog", "reason": "destructive; not requested" }],
  "unresolved": [{ "phrase": "billing banner", "status": "ambiguous",
                   "candidates": ["billing-page", "plan-banner"] }],
  "storageState": null,                        // path only, never content
  "approval": { "by": "user", "at": "2026-11-12T08:00:00Z", "proposalSha256": "…" },
  "verification": { "at": "…", "results": {
      "invite-dialog__validation-error__mobile": { "status": "verified", "planHash": "…" } } }
}
```

- `targets` is **authoritative** for `assess.mjs --scope`; `selection` is informational (shown in
  the report header). Every key must resolve against `inventory ⊕ journeys` overlay, enforced by
  `validateScope` at `propose` time and again at `verify` time.
- `unresolved` holds two kinds of entries: phrase-level (`{ phrase, status: "ambiguous" |
  "unmatched", candidates }`, from grounding - a request phrase that never became a target) and,
  after `verify`, target-level (`{ target, status, reason }` for any key that didn't verify). A
  later fully-successful `verify` clears all target-level entries; phrase-level entries persist
  until the next `propose`.
- `verification.results[key].status` ∈ `verified | ambiguous | unreachable | unsupported |
  needs-setup`, with `reason` and `failingStep` (a human-readable `describeStep` string) set for
  anything but `verified`.
- `approval.proposalSha256` is the hash of `proposal.md` at confirm time; editing `scope.json` or
  `journeys.json` afterwards (which changes the next `propose`'s `proposal.md`) is expected to
  drop status back to `proposed` on the next `propose`.

## `journeys.json` (`scope.mjs step` → `propose`)

A journey is an ordered list of **segments**; each segment is exactly one inventory screen or
state plus the steps that reach it from the previous segment.

```jsonc
{
  "schemaVersion": 1,
  "journeys": [{
    "id": "invite-flow",
    "title": "Open invite dialog, trigger validation error",
    "producer": "text",                         // text | recorder | codegen | devtools | manual
    "producerVersion": 1,
    "feature": { "id": "team", "name": "Team" },          // existing id, or a new feature (full object)
    "start": { "screen": "team-members" },                // existing screen, OR { "url": "/team" } for a new root
    "segments": [
      { "kind": "screen",
        "screen": { "id": "invite-dialog", "name": "Invite teammate", "type": "dialog",
                    "modal": true, "parent": "team-members",
                    "ready": { "role": "dialog", "name": "Invite teammate", "exact": true },
                    "scope": "[role=dialog][aria-label=\"Invite teammate\"]",
                    "trigger": { "role": "button", "name": "Invite", "exact": true },
                    "patterns": ["dialog-modal"],
                    "source": ["src/team/InviteDialog.tsx"] },
        "steps": [
          { "action": "click", "target": { "role": "button", "name": "Invite", "exact": true },
            "rec": { "producer": "text", "confidence": "snapshot",
                     "evidence": [{ "snapshot": "work/snapshots/3.yml", "ref": "e41" },
                                  { "source": { "file": "src/team/Members.tsx", "line": 88, "via": "grep" } }] } }
        ] },
      { "kind": "state", "screen": "invite-dialog",
        "state": { "id": "validation-error", "name": "Invalid e-mail" },
        "steps": [
          { "action": "fill", "target": { "label": "E-mail" }, "value": "not-an-email",
            "rec": { "producer": "text", "confidence": "snapshot", "evidence": [{ "snapshot": "work/snapshots/4.yml", "ref": "e7" }] } },
          { "action": "click", "target": { "role": "button", "name": "Send invite", "exact": true,
                                           "within": { "role": "dialog", "name": "Invite teammate" } },
            "rec": { "producer": "text", "confidence": "snapshot", "evidence": [] } },
          { "action": "waitFor", "target": { "text": "Enter a valid e-mail", "within": { "role": "dialog" } } }
        ] },
      { "kind": "state", "screen": "invite-dialog",
        "state": { "id": "dark", "name": "Dark theme", "requires": ["appearance.dark"] }, "steps": [] }
    ],
    "viewports": ["mobile"]
  }]
}
```

Rules:
- `segments[].screen` / `.state` use **exactly** the inventory schema (sibling skill's
  `references/inventory.md`). A segment may reference an existing screen **by id string only**
  (`"screen": "team-members"`, `kind: "screen"`, no object) - this introduces no new entity and
  carries no steps of its own; it exists purely to add `state` segments to that screen
  afterwards. To interact with an existing screen directly, attach the interaction to a new
  `state` segment on it instead.
- A `state` segment's `screen` is either an id string (an existing screen, or one just introduced
  earlier in the same journey) or an inline screen object only on the very segment that
  introduces the screen.
- Steps are inventory steps (`action`, `target`, optional `value`/`key`) plus `rec`
  (producer-only provenance: `producer`, `confidence`, `evidence[]`, optional `reason`/`seq`/
  `ts`/`shot`/`url`). `rec` is **ignored by the runner** and **stripped** by `compileJourneys`
  before `planHash` is computed, so a hand-edited copy with `rec` removed hashes identically.
- `rec.confidence` ∈ `verified > snapshot > source > inventory > css > hint > inferred` (most to
  least trustworthy). `verify` upgrades a replayed step's effective confidence to `verified` for
  display; `hint`/`inferred` block `scope.json.status` from reaching `verified`.
- `evidence[]` entries are one of `{ "snapshot": "work/snapshots/<n>.yml", "ref": "<id>" }`,
  `{ "source": { "file", "line", "via" } }`, `{ "inventory": "<ref>" }`, or `{ "raw": "<text>" }`
  (an unparsed `--evidence` fragment).
- A `state` segment is the "state suffix": only the steps **after** the screen's `ready`, i.e.
  what additionally needs to happen once the screen itself is already reachable.

## Interaction modalities (optional, backwards compatible)

Every field below is optional. A journey with none of them behaves exactly as before
(modality `unspecified`).

- `intent.json.modalities` / `scope.json.modalities`: chosen by the agent from the
  request (ids: `keyboard`, `mouse`, `sr-keyboard`, `sr-navigation`), each backed by evidence.
  Modalities the user ruled out go to `excludedModalities`. `intent.json.unsupportedModalities`
  lists what was asked but cannot be automated (e.g. touch); the proposal discloses it and it is
  never mapped to `mouse`.
  `propose` copies the intent's modalities onto every journey that declares none.
- `journey.modalities`: array of `keyboard | mouse | sr-keyboard | sr-navigation`; set with
  `step --modalities`. The compiler copies it onto steps that declare none.
- Step fields: `intent` (`reach|activate|enter-text|choose|toggle|dismiss|open|read|reveal|setup`),
  `keys` (explicit script such as `["Tab","Enter"]`, still guarded by the key policy at run time),
  `modalities` (array: the step only runs under those modalities), `modalitySkip`
  (`{ "<modality>": "<reason>" }`: the step is not attempted and is reported as a review item).
- A `focus` or `evaluate` step in a keyboard/screen-reader journey is refused without `--reason`;
  at run time it is reported as a programmatic intervention.
- These fields are listed in `proposal.md`, so the human approval covers them. They do not enter
  `planHash`; they enter `policyHash` (see the assessment skill), which fix-verify checks.

## Compiling `journeys.json` into an overlay

`compileJourneys(journeysDoc)` (owned by the sibling skill, `scripts/lib/scope.mjs`) walks every
journey's segments and produces `{ features: [{ id, name, screens: [...] }] }` - new screens and
new states, inventory-shaped, `rec` stripped. `applyScope(inv, scope)` merges that overlay onto an
inventory **in memory only**: an absent id is appended, an identical existing id is a no-op, a
different existing id is a conflict (reported, nothing mutated for that entity, every other
entity in the overlay still applies). This is the same function `assess.mjs --scope`,
`inventory.mjs --scope` and `verify.mjs`'s forwarding all share - scope-definition never
re-implements it.
