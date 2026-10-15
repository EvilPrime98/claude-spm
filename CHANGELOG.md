# Changelog

## 0.3.0 - 2026-10-15

- **Breaking:** the manifest moved from `.claude/skills.json` to `spm.json` at the project root, like `package.json`. `.claude/` is now install output (like `node_modules`): delete it and run `spm install` to recreate it. `skills` is now a list of names; hashes moved to `.claude/.spm-state.json`.
- `spm install <skill>` now records the skill in `spm.json`.

## 0.2.0 - 2026-10-14

- **Breaking:** skills are now installed from a GitHub repo instead of the global `~/.claude/skills` folder. Configure it with `spm init <owner/repo[#ref]>` (stored in `.claude/skills.json`) or `SPM_REPO`.
- Add `SPM_CACHE_DIR` (default `~/.cache/spm`) for cloned repos; `SPM_GLOBAL_DIR` now only controls which global skills isolation hides.
- `spm update` exits early when no skills are installed.

## 0.1.0

- Initial release: `init`, `install`, `uninstall`, `update`, `list`, `available`.
