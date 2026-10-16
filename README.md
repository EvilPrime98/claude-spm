# claude-spm

[![CI](https://github.com/EvilPrime98/claude-spm/actions/workflows/ci.yml/badge.svg)](https://github.com/EvilPrime98/claude-spm/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claude-spm.svg)](https://www.npmjs.com/package/claude-spm)

Skill package manager: install skills from a GitHub repo into a project's `.claude/skills`, and optionally hide your global `~/.claude/skills` in that project.

It works like npm: `spm.json` (project root, committed) is your `package.json`, and `.claude/` is your `node_modules` (generated, git-ignorable). Delete `.claude/` and run `spm install` to recreate it.

Skills are discovered broadly: any `skills/<name>/SKILL.md` at any depth (and skill folders at the repo root) is available. If two share a name, the shallowest wins. The repo can also point at a subfolder: `owner/repo/subdir` or a GitHub `.../tree/<ref>/<subdir>` URL (useful for monorepos like `cursor/plugins/pstack`). `git` must be installed; private repos work through your normal git credentials.

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

| Command                  | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `spm init [owner/repo]`  | Create `spm.json` and `.claude/skills`, hide global skills      |
| `spm install <skill...>` | Add skills to `spm.json` and copy them in (aliases: `i`, `add`) |
| `spm install`            | Recreate `.claude/skills` from `spm.json`                       |
| `spm uninstall <skill>`  | Remove skills from the project (aliases: `rm`, `remove`)        |
| `spm update [skill...]`  | Re-copy installed skills from the repo                          |
| `spm list`               | Skills installed in this project (alias: `ls`)                  |
| `spm available [filter]` | Skills available in the repo (alias: `search`)                  |

Options: `-f, --force` overwrite an existing local skill; `--no-isolate` with `init` keeps global skills visible; `-v, --version` print the spm version; `-h, --help`.

`spm.json` looks like this:

```json
{
  "repo": "owner/repo",
  "isolate": true,
  "skills": ["graphify", "testing-doctor"]
}
```

Commit it and add `.claude/` to `.gitignore`; anyone who clones the project runs `spm install`. File hashes used to detect local edits live in `.claude/.spm-state.json`. With isolation on, `spm install` also rewrites `skillOverrides` in `.claude/settings.json`, so that file is regenerated too.

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
