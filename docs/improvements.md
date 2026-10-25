# claude-spm: what would make it useful

Source: https://github.com/EvilPrime98/claude-spm

This is an opinion based on the README only. I haven't read the code or checked what Claude Code's plugin system does today, so verify the overlap claims before building on them.

## Priorities (most important first)

### 1. Lockfile with commit SHAs and content hashes

`#ref` pinning isn't enough, because tags and branches move. `spm.lock` should record the resolved SHA and a hash of each skill's files. `spm install --frozen` should fail if anything differs, like `npm ci`. This is what makes a skill manager reproducible and safe.

### 2. Supply-chain safety before install

Skills are instructions Claude follows, and they can include scripts. That makes them an attractive attack target.

- Diff view on update ("what changed since the version you approved?").
- Flag skills that bundle executables, shell commands, or network calls.
- Require explicit approval for new or changed skills, and support an allowlist of trusted repos.
- Scan `SKILL.md` for prompt-injection patterns.

### 3. Dependencies and versions

Skills that depend on other skills, or on an MCP server or tool, need a declared dependency. Add semver ranges and an `spm outdated` / `spm update` flow.

### 4. Interoperability instead of a parallel ecosystem

Claude Code already has plugins and marketplaces. The tool survives only if it complements them.

- Install from marketplaces too.
- Export to and import from plugin format.
- Support user, project and org scopes.
- Target other agents that read `SKILL.md`-style folders, to widen the audience.

### 5. Discovery and trust signals

`spm available` only lists what's in repos already added.

- Search over public repos (e.g. via GitHub topics).
- Show stars, last update and author.
- Offer a curated "verified" list.

### 6. Team and CI features

- `spm check` in CI to catch drift or locally edited skills.
- Pre-commit hook.
- Shared org registry or private-repo defaults.
- A clear monorepo story.

### 7. Observability

Show which skills actually get triggered and which are never used, so people can prune. This is the hardest item and probably out of scope, but it would set the tool apart.

## What to do first

Items 1 and 2. A reproducible, reviewable install is the one thing copying folders can't give you. Without them, the tool stays a convenience wrapper around `git clone`.
