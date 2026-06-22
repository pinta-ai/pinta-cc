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
2. Add repo secret **`NPM_TOKEN`** — an npmjs automation token with publish
   rights for the `@pinta-ai` scope.
3. `GITHUB_TOKEN` (auto in Actions) authenticates the GitHub Packages fetch of
   `@pinta-ai/core`; `NPM_TOKEN` authenticates the npmjs publish. Both are wired
   via the committed `.npmrc` + the `publish` workflow.

## Activate the @pinta-ai/core dependency (after core's first publish)
`package.json` declares `@pinta-ai/core: ^0.2.0` (devDependency). Record its
GitHub Packages resolution into `package-lock.json` once — point this single
install at GitHub Packages (the committed `.npmrc` has no scope redirect):

```sh
export NODE_AUTH_TOKEN=<github PAT with read:packages>
npm install @pinta-ai/core@^0.2.0 --save-dev --registry=https://npm.pkg.github.com
git add package.json package-lock.json
git commit -m "chore: lock @pinta-ai/core from GitHub Packages"
```

`package-lock.json` now pins `@pinta-ai/core` to its GitHub Packages URL, and
`npm ci` (CI) fetches it from there using `NODE_AUTH_TOKEN`.

## Local development
`npm install` needs the GitHub Packages auth for `@pinta-ai/core`: set
`NODE_AUTH_TOKEN` (a PAT with `read:packages`) and install once with
`--registry=https://npm.pkg.github.com` for that package, or `npm link
@pinta-ai/core` against a local `../pinta-core` checkout.

## Release
1. Bump the version (`npm run bump` if available, or edit `package.json`); commit.
2. Push a `v<version>` tag (or publish a GitHub Release).
3. The `publish` workflow runs: `npm ci` (installs core from GitHub Packages) →
   `npm run build` (esbuild bundles + minifies core into `dist/`) → `npm publish`
   to npmjs (verifies tag == version, skips if already published, posts Slack).
