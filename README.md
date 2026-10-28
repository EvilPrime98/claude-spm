# claude-spm

[![CI](https://github.com/EvilPrime98/claude-spm/actions/workflows/ci.yml/badge.svg)](https://github.com/EvilPrime98/claude-spm/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claude-spm.svg)](https://www.npmjs.com/package/claude-spm)

Claude sees every skill in `~/.claude/skills` in every repo, so the more you collect, the more noise it carries into projects that don't need it. With spm it sees only the skills this project declares, and everyone who clones the repo gets the same set.

|                      | Without spm                                 | With spm                                         |
| -------------------- | ------------------------------------------- | ------------------------------------------------ |
| Skills Claude sees   | All of `~/.claude/skills`, in every project | Only the ones listed in the project's `spm.json` |
| A teammate clones    | Has to guess which skills to install        | Runs `spm install` and gets the declared set     |
| Where they come from | Copied by hand                              | One or more GitHub repos, recorded in `spm.json` |

```bash
npm install -g claude-spm
cd my-project
spm init owner/repo      # hides your global skills in this project
spm install graphify     # Claude now sees graphify, and nothing else
```

Isolation works by marking your global skills `"off"` in `.claude/settings.json` (`skillOverrides`). Entries you wrote yourself are left alone, and only the ones spm turned off are removed again. Turn it off with `spm init --no-isolate`.

Skills are prompts that Claude acts on, so install them from repos you trust. `spm update` re-copies whatever the repo's HEAD is today; it does not pin a commit yet.

## How it works

It works like npm: `spm.json` (project root, committed) is your `package.json`, and `.claude/` is your `node_modules` (generated, git-ignorable). Delete `.claude/` and run `spm install` to recreate it.

Skills are discovered broadly: any `skills/<name>/SKILL.md` at any depth (and skill folders at the repo root) is available. If two share a name, the shallowest wins. A repo (or subfolder) that has a `SKILL.md` at its root is a single-skill repo: it is installed as one skill, named by the `name` in its front matter, or else by the repo name. The repo can also point at a subfolder: `owner/repo/subdir` or a GitHub `.../tree/<ref>/<subdir>` URL (useful for monorepos like `cursor/plugins/pstack`). `git` must be installed; private repos work through your normal git credentials.

## Install

```bash
npm install -g claude-spm
```

This provides the `spm` command.

## Quick start

```bash
cd my-project
spm init owner/repo      # add the skills repo to the pool (optionally owner/repo#ref)
spm repo add other/repo  # optional: add more repos to the pool
spm available            # list skills in the pool
spm install graphify     # copy a skill into ./.claude/skills
spm list                 # show skills installed in this project
```

## Commands

| Command                        | Description                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `spm init [owner/repo]`        | Create `spm.json` and `.claude/skills`, hide global skills                   |
| `spm repo add <repo>`          | Add a repo to the pool                                                       |
| `spm repo rm <repo>`           | Remove a repo from the pool (`--force` if skills use it)                     |
| `spm repo list`                | Show the pool (alias: `ls`)                                                  |
| `spm install <skill...>`       | Add skills to `spm.json` and copy them in (aliases: `i`, `add`)              |
| `spm install -g <skill...>`    | Copy skills into the global folder (`~/.claude/skills`); nothing is recorded |
| `spm install`                  | Recreate `.claude/skills` from `spm.json`                                    |
| `spm uninstall <skill>`        | Remove skills from the project (aliases: `rm`, `remove`)                     |
| `spm install <market>:<skill>` | Review and install a skill from a market, pinned to a commit                 |
| `spm update [skill...]`        | Re-copy installed skills from the repo (`--latest` moves market skills)      |
| `spm list`                     | Skills installed in this project (alias: `ls`)                               |
| `spm available [filter]`       | Skills available in the pool                                                 |
| `spm search <term>`            | Search the skill markets (`--market <id>` to pick one)                       |

Options: `-f, --force` overwrite an existing local skill; `--from <repo>` with `install` takes the skills from that repo of the pool (or from a market id); `-y, --yes` skips the review prompt of market installs; `--latest` with `update` moves market skills to the newest commit; `-g, --global` with `install` copies skills into the global folder; `--no-isolate` with `init` keeps global skills visible; `-v, --version` print the spm version; `-h, --help`.

`spm.json` looks like this:

```json
{
  "repos": ["owner/repo", "other/repo"],
  "isolate": true,
  "skills": {
    "graphify": "owner/repo",
    "testing-doctor": "other/repo"
  }
}
```

`repos` is the pool, searched in order. `spm install <skill>` takes the skill from the first repo that has it (with a warning if several do; use `--from <repo>` to choose) and records that repo in `skills`, so `spm install` and `spm update` always pull each skill from the repo it came from. Older `spm.json` files (`"repo": "..."`, `"skills": [...]`) are migrated automatically on the next write.

## Markets

`spm search <term>` queries public skill markets, and `spm install <market>:<skill>` installs a hit. Markets are only an index: every hit points at a GitHub repo, and the skill is cloned from there like any other.

```bash
spm search pdf                        # skillsmp:author/name  ★stars  description
spm install skillsmp:author/name      # review, confirm, install
spm update --latest author-skill      # move to the newest commit, after a new review
```

Supported market: [SkillsMP](https://skillsmp.com) (`skillsmp`). Anonymous search is limited to 50 requests a day; set `SKILLSMP_API_KEY` for a higher quota. [skills.sh](https://skills.sh) is not supported yet: its documented API needs a Vercel OIDC token.

A market listing is not a vetting. Before anything is copied, spm prints the source repo, the exact commit, the content hash and every file, and flags scripts, binaries, symlinks and `allowed-tools`. You confirm (`--yes` skips it for CI). Skills with symlinks are refused. The reviewed commit is recorded in `spm.json`, and `spm install` / `spm update` stay on it until you ask for `--latest`:

```json
"skills": {
  "nano-pdf": { "repo": "https://github.com/o/r/tree/main/skills/nano-pdf", "ref": "<sha>", "market": "skillsmp" }
}
```

A bare name in `spm install` still comes from the pool only, and a market hit never shadows a pool skill. A market install does not add anything to `repos`.

Commit it and add `.claude/` to `.gitignore`; anyone who clones the project runs `spm install`. File hashes used to detect local edits live in `.claude/.spm-state.json`. With isolation on, `spm install` also rewrites `skillOverrides` in `.claude/settings.json`, so that file is regenerated too.

Environment:

- `SPM_REPO` replaces the pool with a single repo (`owner/repo[#ref]`, a git URL, or a local path).
- `SPM_CACHE_DIR` sets where repos are cloned (default `~/.cache/spm`).
- `SPM_GLOBAL_DIR` sets the global skills folder that isolation hides (default `~/.claude/skills`).
- `SKILLSMP_API_KEY` is an optional SkillsMP API key.

## Development

```bash
pnpm install
pnpm test
pnpm format:check
```

## License

MIT
