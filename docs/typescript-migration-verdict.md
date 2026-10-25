# Should claude-spm migrate to TypeScript?

Council verdict (5 advisors, anonymized peer review, chairman synthesis), 2026-10-20.

## Context

- ~1,350 lines of ESM JS in `src/`, `bin/spm.js` 7 lines, ~1,150 lines of vitest tests.
- Zero runtime dependencies. Devdeps: prettier, vitest.
- Ships source directly (`files: ["bin", "src"]`), no build step. Node `>=18`.
- Solo maintainer, v0.7.0, release-please publishing with `id-token: write`.
- Roadmap (`docs/improvements.md`): lockfile with SHA/hashes, supply-chain safety, versioning, marketplace interop.

## Verdict

**Do not migrate to TypeScript now. Add type checking without a build step.**

### Where the council agreed

- Four of five advisors said no to a full migration.
- The roadmap is data integrity and security work. Types add no features to it.
- A build step adds `tsc`, `dist/`, `bin`/`files` changes, a release-please publish rewire, vitest config and Windows shebang risk, all on the release path.
- Shipping readable source with zero dependencies ("what you read is what runs") is a trust asset for a tool that installs third-party code.
- The cheap middle path is `checkJs` + `noEmit` + JSDoc, about an hour of work.

### Where it clashed

- **Expansionist (the only "yes"):** types become a public surface; ship `.d.ts` and a programmatic API (install, resolve, verify, lock), and do it before the lockfile work. Peer reviewers rejected this as speculative: no evidence anyone wants to consume spm as a library, and "one weekend" ignores the release plumbing. The surviving point: `.d.ts` can be generated from JSDoc (`tsc --declaration --emitDeclarationOnly`), so the upside doesn't require migrating.
- **Strictness:** start with `strict: false` and tighten later (chosen), versus `strict` from day one.

### Blind spots found in peer review

- Nobody checked the evidence: a `tsc --checkJs` dry run, or git history for type-shaped bugs. Costs and benefits were guessed.
- Types vanish at runtime. Untrusted JSON (GitHub, skillsmp, `spm.json`, lockfile) needs runtime validation at the boundary; hand-rolled validators keep zero dependencies.
- The lockfile format is a public contract and should be versioned and specified whatever the language.
- npm provenance and `files` allowlist hygiene protect a supply-chain tool more than the language does.
- Node native type stripping could later allow shipping `.ts` with no build, but it needs a Node floor above 18.

### Revisit triggers

Reconsider a real migration if any of these happens:

- Outside contributors show up.
- You decide to export a programmatic API.
- `src/` passes roughly 5k lines.
- The Node floor rises to a version with stable native type stripping.

## Implementation plan

Steps are ordered; each is independently shippable. Nothing here has been applied yet.

### 1. Measure first

```sh
pnpm add -D typescript
npx tsc --allowJs --checkJs --noEmit --target es2022 --module nodenext --moduleResolution nodenext src/*.js src/markets/*.js bin/spm.js
```

Record the error count and which errors are real bugs. This is the data the decision should rest on.

### 2. Add `tsconfig.json` (type-check only)

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": false,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "skipLibCheck": true
  },
  "include": ["bin", "src"]
}
```

`test/` is left out at first; add it once `src/` is clean. Use `// @ts-nocheck` on the worst files and burn those down over time.

### 3. Add the script and CI step

`package.json`:

```json
"scripts": {
  "typecheck": "tsc"
}
```

`.github/workflows/ci.yml`, after `pnpm format:check`:

```yaml
- run: pnpm typecheck
```

Consider adding `pnpm typecheck` to `prepublishOnly` too. `typescript` stays a devDependency; `files` is unchanged, so the published package is identical.

### 4. Type the contracts with JSDoc

Use the `jsdoc-author` skill. Start with `@typedef`s for the shapes that cross trust boundaries:

- `spm.json` manifest
- lockfile (when added)
- skillsmp and GitHub tree responses
- the `Market` interface in `src/markets/index.js`

Priority files: `src/store.js` and `src/repo.js` (hashing and fetching live there).

### 5. Validate at the boundaries (more valuable than types)

Hand-write small validators (no dependency) for `spm.json`, the lockfile and API responses. Reject unexpected shapes. Add tests for path traversal and symlink cases next to the existing symlink-hash tests.

### 6. Spec the lockfile format

Give the future lockfile a `lockfileVersion` field and a short written schema before releasing it. It is hard to change once users have it.

### 7. Harden publishing

Confirm npm provenance is enabled in `release.yml` (`id-token: write` is already set; check `npm publish --provenance`) and that `files` stays a strict allowlist.

### 8. Tighten later

Turn on `strict` per file once the error count is low. Optionally generate `.d.ts` from JSDoc if a programmatic API is ever exported.

## One thing to do first

Run step 1 and look at the output before changing anything else.
