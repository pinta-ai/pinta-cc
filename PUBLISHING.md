# Publishing @pinta-ai/pinta-cc

This package is published to **npmjs** (public). It depends on the **private**
`@pinta-ai/core` package (GitHub Packages), which is **bundled + minified into
`dist/` at build time via esbuild** — so npmjs consumers never need access to
the private registry.

- Build target: node18 (runs on node `>=18`, including 20.18.0).
- `dist/` is a self-contained bundle with **no runtime `@pinta-ai/core`
  dependency** (it is a `devDependency`, inlined at build).
- The committed `.npmrc` has **no `@pinta-ai` scope redirect**, so this
  adapter's own `@pinta-ai/*` name still resolves to npmjs for publish/view.
  `@pinta-ai/core` is fetched from GitHub Packages via its URL pinned in
  `package-lock.json`.

## One-time setup
1. Publish `@pinta-ai/core` to GitHub Packages first (see the `pinta-core` repo's
   `publish` workflow). Ensure this repo / the org has `read:packages` access.
2. **No publish secret is needed.** The npmjs publish uses **OIDC trusted
   publishing**: `permissions.id-token: write` plus `setup-node`'s
   `registry-url` let npm mint a short-lived token from the Actions identity.
   This is how every release since 1.4.0 has shipped.
3. The GitHub Packages fetch of `@pinta-ai/core` is authenticated by
   `NODE_AUTH_TOKEN` (set to the auto-provided `GITHUB_TOKEN`), which the
   `publish` workflow scopes to the **`npm ci` step only** — see the warning
   below.

> **Do not add an `NPM_TOKEN` secret or an `//registry.npmjs.org/:_authToken`
> line to `.npmrc`.** There is no such secret at repo, org, or environment
> scope, so `${NPM_TOKEN}` expands to an **empty string** — and an empty token
> makes `npm publish` fail `ENEEDAUTH` instead of falling through to OIDC. That
> is exactly what broke the v1.5.0 release; a8076df reverted it. For the same
> reason `NODE_AUTH_TOKEN` must not be set job-wide: npm would send the GitHub
> Packages token to npmjs during `npm publish`.

## Activate the @pinta-ai/core dependency (after core's first publish)
`package.json` declares `@pinta-ai/core: ^0.3.0` (devDependency). Record its
GitHub Packages resolution into `package-lock.json` once — point this single
install at GitHub Packages (the committed `.npmrc` has no scope redirect):

```sh
export NODE_AUTH_TOKEN=<github PAT with read:packages>
npm install @pinta-ai/core@^0.3.0 --save-dev --@pinta-ai:registry=https://npm.pkg.github.com
git add package.json package-lock.json
git commit -m "chore: lock @pinta-ai/core from GitHub Packages"
```

Use the **scope-limited** `--@pinta-ai:registry=` flag, not a bare
`--registry=`: the latter points *every* package at GitHub Packages for that
install, and transitive deps that only exist on npmjs will 404. Passing it on
the CLI keeps the redirect out of the committed `.npmrc`, so the adapter's own
`@pinta-ai/*` name still resolves to npmjs for publish/view.

Two things to check afterwards, because npm can silently do the wrong thing here:

- `package.json` says `^0.3.0`, not a pinned `0.3.0`. A global `save-exact=true`
  in `~/.npmrc` will write the exact version — fix it by hand if so.
- `package-lock.json` resolves `@pinta-ai/core` to an
  `https://npm.pkg.github.com/download/...` URL with an `integrity` hash, and no
  `file:../pinta-core` / `"link": true` entry survives. A lockfile left pointing
  at the local sibling checkout does **not** fail `npm ci` — it creates a
  dangling symlink to a path that exists only on a dev machine, and the build
  then dies with `TS2307: Cannot find module '@pinta-ai/core'` (see ee6979c).

## Local development
`npm install` needs GitHub Packages auth for `@pinta-ai/core`: set
`NODE_AUTH_TOKEN` (a PAT with `read:packages`) and install that one package with
`--@pinta-ai:registry=https://npm.pkg.github.com`, or `npm link @pinta-ai/core`
against a local `../pinta-core` checkout. If you link, do not commit the
resulting lockfile — see the `TS2307` trap above.

## Release
1. Bump the version (`npm run bump` if available, or edit `package.json`); commit.
2. Push a `v<version>` tag (or publish a GitHub Release).
3. The `publish` workflow runs: `npm ci` (installs core from GitHub Packages) →
   `npm run build` (esbuild bundles + minifies core into `dist/`) → `npm publish`
   to npmjs (verifies tag == version, skips if already published, posts Slack).

The job runs on **node 20** and pins **npm 11.18.0**. Do not move it to
`npm@latest`: npm 12.x requires node >= 22.22 and aborts with `EBADENGINE`.
11.18.0 supports node `^20.17.0` and is above the 11.5.1 floor for OIDC trusted
publishing.
