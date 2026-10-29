# Changelog

## [0.9.0](https://github.com/EvilPrime98/claude-spm/compare/v0.8.0...v0.9.0) (2026-10-29)


### Features

* **doctor:** add spm doctor to report skill context cost ([3675305](https://github.com/EvilPrime98/claude-spm/commit/3675305d6fe8ac12020820a795528963768a670b))
* **doctor:** add spm doctor to report skill context cost ([330bd60](https://github.com/EvilPrime98/claude-spm/commit/330bd602577dd12d94a8d0994411bd6e9b845755))

## [0.8.0](https://github.com/EvilPrime98/claude-spm/compare/v0.7.1...v0.8.0) (2026-10-28)


### Features

* add -g/--global flag to spm install ([3bff315](https://github.com/EvilPrime98/claude-spm/commit/3bff3152e03d556f87a12407534dc486d8f50704))
* **install:** add -g/--global flag to install skills globally ([66974a6](https://github.com/EvilPrime98/claude-spm/commit/66974a6bb6d87d1874fd69815682ae40611170a5))

## [0.7.1](https://github.com/EvilPrime98/claude-spm/compare/v0.7.0...v0.7.1) (2026-10-25)


### Bug Fixes

* **markets:** retry skillsmp search once on 403 ([055f01d](https://github.com/EvilPrime98/claude-spm/commit/055f01dcd87bffc9b3d7aa4addfad0cb56a2e82a))
* **markets:** retry skillsmp search once on 403 ([b6cd454](https://github.com/EvilPrime98/claude-spm/commit/b6cd4542dcb1824fc722cf04f326b25c903ff897))

## [0.7.0](https://github.com/EvilPrime98/claude-spm/compare/v0.6.0...v0.7.0) (2026-10-19)


### Features

* **markets:** search and install skills from skillsmp ([951badf](https://github.com/EvilPrime98/claude-spm/commit/951badfb5e1e63286143a894aa7c2b971d820325))
* **markets:** search and install skills from skillsmp with commit pinning and review ([ae0ed97](https://github.com/EvilPrime98/claude-spm/commit/ae0ed97cc814b495addd59b186449df877883f8d))


### Bug Fixes

* **store:** hash symlinks by target instead of following them ([b5f4357](https://github.com/EvilPrime98/claude-spm/commit/b5f435746c59320695e93911ebe2d520d55ccf34))

## [0.6.0](https://github.com/EvilPrime98/claude-spm/compare/v0.5.0...v0.6.0) (2026-10-18)


### Features

* **repo:** install single-skill repos with a root SKILL.md ([f09c1f9](https://github.com/EvilPrime98/claude-spm/commit/f09c1f956349a65453e38bf21f77fca01244614e))
* **repo:** install single-skill repos with a root SKILL.md ([ab1adfc](https://github.com/EvilPrime98/claude-spm/commit/ab1adfc39770e50c6a9846c283aa4e79be40b3ba))

## [0.5.0](https://github.com/EvilPrime98/claude-spm/compare/v0.4.0...v0.5.0) (2026-10-16)


### Features

* **cli:** support a pool of skill repos with spm repo add/rm/list and --from ([028f54e](https://github.com/EvilPrime98/claude-spm/commit/028f54e3cfa58c3f3b797f58a8993a8912fbbbe4))
* **cli:** support a pool of skill repos with spm repo add/rm/list and --from ([2e7a458](https://github.com/EvilPrime98/claude-spm/commit/2e7a458d371efcc718594dde44f54ab810e38b39))

## [0.4.0](https://github.com/EvilPrime98/claude-spm/compare/v0.3.0...v0.4.0) (2026-10-16)


### Features

* **cli:** discover nested skills, support repo subpaths and add --version ([77ee3e0](https://github.com/EvilPrime98/claude-spm/commit/77ee3e04900a65d100253c52132a5dff0176a39a))
* **cli:** discover nested skills, support repo subpaths and add --version ([04b2768](https://github.com/EvilPrime98/claude-spm/commit/04b2768b137a4292105a046b5e00b9bc7fdf8696))

## 0.3.0 - 2026-10-15

- **Breaking:** the manifest moved from `.claude/skills.json` to `spm.json` at the project root, like `package.json`. `.claude/` is now install output (like `node_modules`): delete it and run `spm install` to recreate it. `skills` is now a list of names; hashes moved to `.claude/.spm-state.json`.
- `spm install <skill>` now records the skill in `spm.json`.

## 0.2.0 - 2026-10-14

- **Breaking:** skills are now installed from a GitHub repo instead of the global `~/.claude/skills` folder. Configure it with `spm init <owner/repo[#ref]>` (stored in `.claude/skills.json`) or `SPM_REPO`.
- Add `SPM_CACHE_DIR` (default `~/.cache/spm`) for cloned repos; `SPM_GLOBAL_DIR` now only controls which global skills isolation hides.
- `spm update` exits early when no skills are installed.

## 0.1.0

- Initial release: `init`, `install`, `uninstall`, `update`, `list`, `available`.
