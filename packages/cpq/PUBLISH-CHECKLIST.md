# `@dainamite/cpq` — publish checklist

**Status (2026-05-11):** PAUSED before the first publish.

The CPQ extraction work (XD-270) is complete and merged to `main`.
All the release plumbing (`changesets/cli`, GitHub Actions workflow,
`.npmrc`, `RELEASE_TOKEN`, switch from GitHub Packages → public
npm.js) is wired up. **What's missing is the npm.js side of the
auth chain.** Once the steps below are done, merging the next
"Version Packages" PR publishes `@dainamite/cpq` for real.

See [MIGRATION.md](./MIGRATION.md) for the full history. This file
is just the resume-from-here checklist.

## Why the work was paused

`@dainamite` scope on GitHub Packages turned out to be owned by an
unrelated company (DAInamite, Berlin, dainamite.de). Two publish
attempts under GH Packages failed with
`403 — installation does not exist`. We pivoted to public npm.js
where the `@dainamite` scope is free — same target Open Mercato itself
uses (`@open-mercato/core` etc.). That switch landed on `main`; the
final mile (npm account + token + license) requires GUI steps a
human has to do.

## Resume-from-here steps

### 1. npm.js account
Sign up at https://www.npmjs.com/signup if you don't already have an
account. Use any username — it doesn't need to match the GitHub one.

### 2. Create the `dainamite` org on npm.js
- Go to https://www.npmjs.com/org/create
- **Org name:** `dainamite`
- **Plan:** Free (public packages only — fine since the package is
  `access: public`)

If npm tells you the name is taken, double-check at
https://www.npmjs.com/org/dainamite — last verified free on 2026-05-09.

### 3. Generate an Automation token
- https://www.npmjs.com/settings/[your-username]/tokens
- **"Generate New Token"**
- Type: **Automation** (Classic Tokens, NOT Granular — Granular has
  known issues with org-scoped publishes via `changesets/action`)
- Copy the token (starts with `npm_...`) — you only see it once

### 4. Add as a repo secret in GitHub
- https://github.com/dainamite-technologies/dainamite-core/settings/secrets/actions
- **"New repository secret"**
- **Name:** `NPM_TOKEN` (exact spelling, all caps)
- **Value:** the token from step 3

The release workflow reads it as `${{ secrets.NPM_TOKEN }}` and feeds
it to `yarn changeset publish`.

### 5. Pick a real OSI license
[packages/cpq/package.json](./package.json) still has
`"license": "UNLICENSED"` from when the package was private. Public
packages on npm.js want a real license, otherwise the package page
shows an awkward "UNLICENSED" badge and tools like Snyk flag it.

Common picks:
- **`MIT`** — recommended; matches `@open-mercato/*` ecosystem
  conventions, maximally permissive, least friction for adopters
- **`Apache-2.0`** — like MIT plus explicit patent grant
- **`BUSL-1.1`** — restricts commercial competitors; legally trickier,
  pick only if there's a specific reason

Update `packages/cpq/package.json`:
```json
"license": "MIT",
```
…and optionally add a `packages/cpq/LICENSE` file with the full text.

### 6. Trigger publish

After the 5 steps above are done, the publish workflow needs to be
re-triggered. Two options:

**A. Add a new changeset** (clean, recommended)
```powershell
yarn changeset      # interactive — pick "patch", describe "first public release"
git checkout -b release/first-public-publish
git add .changeset/<generated-name>.md
git commit -m "chore(release): trigger first public publish"
git push -u origin release/first-public-publish
gh pr create --fill
# CI green → squash merge → release workflow opens Version Packages PR
# → merge that PR → publish kicks off
```

**B. Re-trigger the existing release workflow** (faster, sneakier)

There may already be a "Version Packages" PR open against `main`
with stale bumps from earlier attempts. Run:
```powershell
gh pr list --head changeset-release/main
```
If yes — refresh it by pushing an empty commit to its branch (this
also triggers CI on it, which the `RELEASE_TOKEN` PAT setup makes
automatic now):
```powershell
git fetch origin changeset-release/main
git checkout changeset-release/main
git commit --allow-empty -m "chore: re-trigger publish"
git push
```
Then merge that PR.

Either way, the first successful publish lands at:

**https://www.npmjs.com/package/@dainamite/cpq**

### 7. Verify

```powershell
# Should return JSON metadata, NOT 404
curl -s https://registry.npmjs.org/@dainamite/cpq | head -c 300

# In a separate test repo, install the published package
yarn add @dainamite/cpq
```

If install works without any `.npmrc` auth setup, you're done —
public package is consumable by anyone.

## Other rough edges noted along the way

- `@open-mercato/cli@0.5.0` is still patched locally in
  `.yarn/patches/` to allow the `@dainamite/` prefix in
  `GENERATED_MODULE_SPECIFIER_PREFIXES`. Should be fixed upstream in
  the next framework release — remove the patch + bump
  `@open-mercato/cli` when it lands.
- `changeset-bot` GitHub App is already installed on the repo. It
  comments on every PR ("Changeset detected" / "No changesets found").
  Optionally enforce it as a Required check in Branch Protection
  once the publish flow is proven (currently it's advisory only).
- Claude PR Review action hits `max_turns` (30) on large PRs and fails
  the check. Not required for merge today; can be bumped in
  `.github/workflows/claude-review.yml` if it starts being annoying.
