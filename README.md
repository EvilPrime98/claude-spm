# claude-spm

[![CI](https://github.com/EvilPrime98/claude-spm/actions/workflows/ci.yml/badge.svg)](https://github.com/EvilPrime98/claude-spm/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claude-spm.svg)](https://www.npmjs.com/package/claude-spm)

Skill package manager: install skills from a GitHub repo into a project's `.claude/skills`, and optionally hide your global `~/.claude/skills` in that project.

The repo can keep skills under a `skills/` folder (`skills/<name>/SKILL.md`) or at its root (`<name>/SKILL.md`). `git` must be installed; private repos work through your normal git credentials.

## Install

```bash
npm install -g claude-spm
```

This provides the `spm` command.

## Quick start

```bash
cd my-project
spm init owner/repo      # record the skills repo (optionally owner/repo#ref)
spm available            # list skills in the repo
spm install graphify     # copy a skill into ./.claude/skills
spm list                 # show skills installed in this project
```

## Commands

| Command                  | Description                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `spm init [owner/repo]`  | Create `.claude/skills`, record the repo, hide global skills |
| `spm install <skill...>` | Copy skills into the project (aliases: `i`, `add`)           |
| `spm install`            | Install every skill listed in `.claude/skills.json`          |
| `spm uninstall <skill>`  | Remove skills from the project (aliases: `rm`, `remove`)     |
| `spm update [skill...]`  | Re-copy installed skills from the repo                       |
| `spm list`               | Skills installed in this project (alias: `ls`)               |
| `spm available [filter]` | Skills available in the repo (alias: `search`)               |

Options: `-f, --force` overwrite an existing local skill; `--no-isolate` with `init` keeps global skills visible; `-h, --help`.

The repo is stored in `.claude/skills.json` so `spm install` works for anyone who clones the project.

Environment:

- `SPM_REPO` overrides the repo (`owner/repo[#ref]`, a git URL, or a local path).
- `SPM_CACHE_DIR` sets where repos are cloned (default `~/.cache/spm`).
- `SPM_GLOBAL_DIR` sets the global skills folder that isolation hides (default `~/.claude/skills`).

## Development

```bash
pnpm install
pnpm test
pnpm format:check
```

## License

MIT
