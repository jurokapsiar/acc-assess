# results.json

Written by `sr.mjs run`, rewritten (findings + summary only) by `sr.mjs analyse`. Values typed
into sensitive fields are never stored (a sensitive fill is refused and the journey is
`blocked`); every value a journey types (≥ 3 characters) and its URL-encoded forms are replaced
by `[redacted]` in every string before writing, and sensitive fields are masked in screenshots.

```jsonc
{
  "schemaVersion": 2,
  "tool": "screen-reader-validation",
  "reader": { "name": "nvda", "label": "NVDA (Windows)", "kind": "real" },   // kind: real | mock
  "simulated": false,                     // true for the mock driver: not evidence
  "startedAt": "…", "finishedAt": "…",
  "env": {                                // what the narration depends on
    "os": "win32", "osRelease": "10.0.…", "node": "v24.…", "browser": "…", "channel": null,
    "guidepup": "0.40.0",                 // null for the mock
    "locale": "en-US", "settle": 1200, "timeout": 10000
  },
  "app": { "name": "…", "baseUrl": "…" },
  "scope": { "id": "…", "file": "relative/path/scope.json", "intent": "…" },
  "journeys": [{
    "id": "…", "key": "checkout@mobile",  // key = id, or id@viewport when several viewports run
    "title": "…", "feature": { "id": "…", "name": "…" },
    "viewport": { "name": "desktop", "width": 1280, "height": 800 },
    "status": "complete",                 // complete | partial (a step failed) | blocked (refused/unresolvable/alignment failed)
    "error": null, "notes": [], "probe": "p1",
    "prep": [{ "step": 0, "phrases": ["…"] }],   // reader alignment speech; step 0 = before step 1
    "steps": [{
      "n": 1,                             // 1-based, includes the start plan (goto, waitFor) and `requires` states
      "action": "click",                  // goto | waitFor | click | dblclick | press | focus | fill | …
      "key": null, "times": null,         // press key and repeat count
      "button": "left",                   // click/dblclick mouse button
      "via": "playwright",                // playwright | screen-reader (OS key through the reader)
      "description": "Click button “Save”",
      "origin": "Screen › State",
      "trace": { "device": "mouse", "input": "mouse (left button) click", "actionable": true },
      "target": { "selector": "#save", "html": "<button …>", "name": "Save", "role": "button" },
      "before": "last phrase heard before the action",   // string
      "narration": ["phrases spoken inside the action's capture window"],
      "late": ["phrases heard after the window, before the next action"],
      "capture": { "mode": "reader", "health": "captured" },   // mode reader | simulated; health captured | unavailable | unaligned | simulated
      "facts": { "before": { … }, "after": { … } },   // focus, dialogs, live, errors, controls, url, title
      "screenshot": "shots/j1-s3.png",
      "ok": true, "error": null
    }]
  }],
  "probes": [{
    "id": "p1", "journey": "…", "url": "…", "title": "…", "viewport": { … },
    "startPlan": [ … ], "screenshot": "shots/p1.png", "prep": ["…"],
    "headings":  { "spoken": [{ "text": "…" }], "termination": "end", "commands": ["…"], "dom": [ … ] },
    "landmarks": { "spoken": [ … ], "termination": "unsupported", "commands": [], "dom": [ … ] },
    "reading":   { "spoken": [{ "text": "…", "selector": "…", "box": { "x": 0, "y": 0, "width": 0, "height": 0 } }],
                   "termination": "cap", "commands": ["…"], "error": "…" }   // error only when termination = error
    // a probe that could not start has { id, journey, viewport, startPlan, error, prep } only
  }],
  "cleanupErrors": [],                    // errors stopping the reader / closing the browser
  "findings": [ /* see below */ ],
  "summary": {
    "journeys": 3, "journeysComplete": 2, "journeysBlocked": 1, "journeysPartial": 0,
    "steps": 17, "narrated": 15, "silent": 2, "failedSteps": 0,
    "capture": { "captured": 17 },        // steps per capture health
    "probesIncomplete": 0,                // sweeps whose termination is not "end"
    "findings": 11, "byKind": { "failure": 7, "review": 3, "suggestion": 1 },
    "byImpact": { "critical": 0, "serious": 5, "moderate": 2, "minor": 0 }   // failures only
  }
}
```

Probe `termination`: `end` | `cap` | `repeat` | `silent` | `unsupported` | `error` |
`invalid-focus-mode` (see `drivers.md`; the last has `discarded: true`, and `unsupported` may carry
`reason: "mode-unverified"`).

Modality fields (schema v2; v1 files are read as `unspecified`): journey `modality`
(`sr-keyboard` \| `sr-navigation` \| `unspecified`, key suffix `~<modality>`); step `modality`,
`outcome` (`ok` \| `skipped` \| `escalated` \| `inconclusive` \| `blocked`), `presses`, `keysSent`,
`escalation` (`click` \| `focus` \| null), `modalityFindings[{rule, note, meta}]`, `readerMode`,
`modeConfidence`.

Exit code of `run`: `0` all journeys complete, `2` some journey partial/blocked (results and
report are still written), `1` error, `3` usage/prerequisite error (e.g. a missing
`storageState`).

## Finding

Compatible with the `accessibility-assessment` finding shape so the two can be merged later
(`source` distinguishes them; `target` is `<journeyKey>#<step>` or a probe id instead of an
inventory target key).

```jsonc
{
  "id": "sr-1",
  "source": "screen-reader",
  "rule": "sr-control-without-name",
  "kind": "failure",                      // failure | review | suggestion
  "title": "Control announced without a name",
  "description": "…", "fix": "…",
  "impact": "serious",                    // critical | serious | moderate | minor
  "wcag": ["4.1.2"],
  "target": "checkout#5",
  "repro": ["Open …", "Press Tab", "…"],
  "nodes": [{ "selector": "#icon-btn", "html": "<button …>", "summary": "Announced: \"button\".", "screenshot": "shots/j1-s5.png" }],
  "evidence": {
    "narration": ["button"], "expected": "A name for the button …", "simulated": false,
    "confidence": "capture unaligned",    // only on downgraded (review) findings
    "capture": "unaligned"                // only when the step's capture was not reliable
  }
}
```
