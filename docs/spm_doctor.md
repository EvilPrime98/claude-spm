# `spm doctor`: skill context cost report

Designs a new `spm doctor` command that reports what the skills Claude can see cost in context and which ones to prune. It is the proposed reason to use spm beyond isolation. Implemented in `src/doctor.js` and wired into `src/cli.js`.

## Decisions

- **Core bet: context cost / performance.** Chosen over trust and safety, team workflow, and authoring tools.
- **Mechanism: measure and advise.** Chosen over dynamic enable/disable, auto-selection by project, and skill slimming. It changes no behavior until the user confirms.
- **Signals: static plus transcript usage.** Token estimates and description overlap from the `SKILL.md` files, plus invocation counts mined locally from Claude Code transcripts (`~/.claude/projects/*.jsonl`). Read-only, local, nothing uploaded. Chosen over static-only and an opt-in hook log.
- **Action: report plus guided prune.** A ranked table of cost, uses and overlap, then an interactive step asking whether to remove flagged skills. Nothing changes without confirmation. Chosen over report-only and budget enforcement.
- **Prune effect: uninstall.** Accepting a removal behaves like `spm uninstall`. No new `disabled` state in `spm.json`. For a global skill, the override is set to `"off"` in the project's `settings.json`.
- **Overlap: lexical heuristic.** TF-IDF or keyword similarity on descriptions and trigger phrases. No dependencies or network. It catches obvious clashes and misses semantic ones. Chosen over LLM-judged and skipping overlap.
- **Token counting: approximate `chars/4`.** Output is marked with `~`. Keeps the package at zero runtime dependencies. Chosen over a bundled tokenizer and the Anthropic `count_tokens` API.
- **Scope: everything Claude would see.** Skills declared in `spm.json`, hand-written ones in `.claude/skills`, and global skills not turned off. When global noise is large, the report recommends `spm init` isolation.
- **Extras deferred.** Lockfile with update diffs, profiles, and a skill linter are not part of this phase.

## Findings from the code

- CLI commands are dispatched by a `switch` in `src/cli.js` (`uninstall` at the `case "uninstall"` branch, `available` at `case "available"`), with the help text at the top of the same file. `doctor` would be added there.
- `uninstall(names)` in `src/cli.js` is the removal logic the prune step reuses.
- `describe(skillDir)` in `src/store.js` extracts a skill's `description` from `SKILL.md` with a regex. It is the starting point for the description cost.
- `listSkills(dir)` and `skillNames(dir, folder)` in `src/store.js` enumerate skill folders and the names they are known by.
- `syncOverrides` in `src/store.js` marks global skills `"off"` in `settings.skillOverrides` and removes the entry when a local skill has the same name. It is the mechanism for pruning global skills.
- `globalSkillsDir()` and `projectPaths()` in `src/paths.js` give the global skills directory (overridable with `SPM_GLOBAL_DIR`) and the project paths (`skillsDir`, `manifest`, `state`, `settings`).
- The package has no runtime dependencies (`package.json`), and tests use vitest in `test/`.

## Implementation

The surface agreed, now built:

- A new `spm doctor` command in `src/cli.js`.
- Scanning of project, hand-written and non-hidden global skills, using the helpers in `src/store.js`.
- Per-skill cost split into always-loaded description and the body loaded when the skill triggers.
- Transcript reader for invocation counts.
- Lexical overlap scorer.
- Interactive prune step reusing `uninstall` and the override logic.

## Out of scope

- Dynamic enable/disable and profiles.
- Auto-selecting skills by project contents.
- Rewriting or slimming skill content.
- Budget enforcement in `spm.json`.
- LLM-judged overlap.
- Lockfile, diff-on-update, linter.

## Open questions

- Shared understanding was not confirmed before this doc was requested.
- Assumed defaults the user did not answer: a `--json` flag for CI, a 60-day usage window adjustable with `--days`, and usage counted per project without cross-project aggregation.
- How skill invocations are identified in the transcript format, and whether the transcript path can be mapped to a project reliably, were not investigated.
- Whether the interactive prune needs a non-interactive form (`--yes`) was not discussed.
- Command name: `doctor` was proposed and not disputed, but not explicitly chosen over `cost`.
