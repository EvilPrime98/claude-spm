# Changelog

## [0.4.0](https://github.com/EvilPrime98/claude-spm/compare/v0.3.0...v0.4.0) (2026-10-15)


### ⚠ BREAKING CHANGES

* **cli:** move manifest to spm.json at project root

### Features

* **cli:** add spm skill package manager ([a5b4af1](https://github.com/EvilPrime98/claude-spm/commit/a5b4af1e11e3cb81a0bce9014e9f4fc5399d4cb1))
* **cli:** install skills from a GitHub repo ([2776550](https://github.com/EvilPrime98/claude-spm/commit/27765507142bcf842947176095baf4e2461ebc54))
* **cli:** move manifest to spm.json at project root ([9195af1](https://github.com/EvilPrime98/claude-spm/commit/9195af142e42221607ef30d6571c6d472d61a206))

## 0.3.0 - 2026-10-15

- **Breaking:** the manifest moved from `.claude/skills.json` to `spm.json` at the project root, like `package.json`. `.claude/` is now install output (like `node_modules`): delete it and run `spm install` to recreate it. `skills` is now a list of names; hashes moved to `.claude/.spm-state.json`.
- `spm install <skill>` now records the skill in `spm.json`.

## 0.2.0 - 2026-10-14

- **Breaking:** skills are now installed from a GitHub repo instead of the global `~/.claude/skills` folder. Configure it with `spm init <owner/repo[#ref]>` (stored in `.claude/skills.json`) or `SPM_REPO`.
- Add `SPM_CACHE_DIR` (default `~/.cache/spm`) for cloned repos; `SPM_GLOBAL_DIR` now only controls which global skills isolation hides.
- `spm update` exits early when no skills are installed.

## 0.1.0

- Initial release: `init`, `install`, `uninstall`, `update`, `list`, `available`.
