# TODO

## Distribution

- [ ] **GitHub Action for publishing.** On a `v*` tag: run every skill's `npm test`,
      `claude plugin validate .`, check that `version` in `.claude-plugin/plugin.json` matches
      `metadata.version` in every `SKILL.md` and the tag, then create a GitHub release with a
      `acc-assess-skills-<version>.zip` of `skills/` (README Option 4). Until then, cut releases by hand.
- [ ] Publish the first release (`v0.1.0`), so README Option 4 has something to download.
- [ ] Test the plugin `SessionStart` hook in a real Claude Code session. So far only the hook's
      command was run by hand against the plugin cache copy.
- [ ] Plugin icon: `.claude-plugin/icon.png`, square, 512-2048 px (warning from `claude plugin validate`).
- [ ] `ensure-setup.mjs` retries the Chromium download every session when it can't be installed
      (`--channel msedge|chrome` users). Remember the failure, or add an opt-out.

## Skill fixes (from the agy end-to-end run on a demo page, 2026-11-20)

- [ ] **Fix files marked `ready` can replace the wrong lines.** The agent guessed line numbers in
      `agent-findings.json` / `annotations.json` `changes`, and `fixes.mjs` rendered the real
      "Current" text from those lines and still marked the file `ready`. Example: the keyboard fix
      replaced `<button type="submit">Subscribe</button>` instead of the "Open details" div.
      `fixes.mjs` should keep a fix `draft` with a warning when the replaced lines don't contain the
      node's tag, id, class or text. SKILL.md should tell the agent to take line numbers from
      `grep -n`, never from memory.
- [ ] **Overlapping `changes` across ready fix files are not detected.** Two fixes rewrote the same
      line. `fixes.mjs` should warn when two ready files touch overlapping ranges of one file, and
      SKILL.md should say to merge those edits into one annotation.
- [ ] **Invalid JSON in `agent-findings.json`** (unescaped quotes) cost the agent a retry. SKILL.md
      should say to write it with `JSON.stringify` or check it with `JSON.parse` before running `report.mjs`.
- [ ] SKILL.md: state that suggestion fix files can legitimately stay `draft`, and document
      promoting a review to a failure through `annotations.kind` (it is allowed, but mentioned only
      in passing).
- [ ] SKILL.md: Escape-to-close stays an APG suggestion with no WCAG criterion, even when the same
      overlay already has `dialog-role-missing` or `initial-focus-outside-overlay`. Say so, so agents
      stop second-guessing it.

## Report polish (report.html check, same run: rendering is clean, axe finds 0 violations)

- [ ] The "Issues 7" heading counts rules, while the bar shows "8 occurrences". Label it
      "7 issues · 8 occurrences" (`groupSection`, `scripts/report.mjs`).
- [ ] Affected-element thumbnails show the whole 1280x800 page, so small highlights (for example a
      `.hint` line) are hard to see. Crop to the node box plus padding.

## Tests

- [ ] `screen-reader-validation/tests/preflight.test.mjs:40-42` writes a file named with a
      `path.win32` path on Linux, leaving a file named
      `\mnt\...\nvda.exe` in the skill folder. Write to a POSIX temp path, or clean the file up.

## Research phase (from README)

- [ ] Evals (`claude plugin eval` can run plugin eval suites).
- [ ] Validation with various models. One agy + Claude Sonnet 4.6 run so far: install, setup, assess and report pass.
