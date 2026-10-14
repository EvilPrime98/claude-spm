# claude-spm

[![CI](https://github.com/EvilPrime98/claude-spm/actions/workflows/ci.yml/badge.svg)](https://github.com/EvilPrime98/claude-spm/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claude-spm.svg)](https://www.npmjs.com/package/claude-spm)

Skill package manager: install skills from your global `~/.claude/skills` into a project's `.claude/skills`, and optionally hide every other global skill in that project.

## Install

```bash
npm install -g claude-spm
```

This provides the `spm` command.

## Quick start

```bash
cd my-project
spm available            # list global skills
spm install graphify     # copy a skill into ./.claude/skills
spm list                 # show skills installed in this project
```

## Commands

| Command                  | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `spm init`               | Create `.claude/skills` and hide global skills in this project |
| `spm install <skill...>` | Copy skills into the project (aliases: `i`, `add`)             |
| `spm install`            | Install every skill listed in `.claude/skills.json`            |
| `spm uninstall <skill>`  | Remove skills from the project (aliases: `rm`, `remove`)       |
| `spm update [skill...]`  | Re-copy installed skills from the global folder                |
| `spm list`               | Skills installed in this project (alias: `ls`)                 |
| `spm available [filter]` | Skills available globally (alias: `search`)                    |

Options: `-f, --force` overwrite an existing local skill; `--no-isolate` with `init` keeps global skills visible; `-h, --help`.

Set `SPM_GLOBAL_DIR` to use a different global skills folder (default `~/.claude/skills`).

## Development

```bash
pnpm install
pnpm test
pnpm format:check
```

## License

MIT
