#!/usr/bin/env node
// Single source of truth for bumping every embedded version in this package.
//
//   npm run bump <version>      e.g. npm run bump 1.2.3
//
// Updates, in lock-step, every place this package hard-codes its own version:
//   - package.json + package-lock.json   (via `npm version`)
//   - src/core/guard.ts  GUARD_UA         (the User-Agent the guard call sends)
//   - src/core/otlp.ts   PLUGIN_VERSION   (telemetry scope/sdk version)
//   - .claude-plugin/plugin.json          (marketplace manifest version)
//
// Fails loudly if any target is missing so a drifting file can't slip a release.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`usage: npm run bump <version>   (got: ${version ?? '<none>'})`);
  process.exit(1);
}

// package.json + package-lock.json — let npm keep the two in sync.
execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { stdio: 'inherit' });

const targets = [
  // GUARD_UA = 'pinta-cc/<version>' (quote style + adaptor name preserved)
  { file: 'src/core/guard.ts', re: /(const GUARD_UA = (['"]))(pinta-[a-z-]+)\/[^'"]+(\2)/, to: `$1$3/${version}$4` },
  // const [export] (PLUGIN_VERSION|SDK_VERSION) = "<version>"
  { file: 'src/core/otlp.ts', re: /((?:export )?const (?:PLUGIN_VERSION|SDK_VERSION) = ")[^"]+(")/, to: `$1${version}$2` },
  // plugin manifest "version": "<version>"
  { file: '.claude-plugin/plugin.json', re: /("version":\s*")[^"]+(")/, to: `$1${version}$2` },
];

for (const { file, re, to } of targets) {
  const src = readFileSync(file, 'utf8');
  if (!re.test(src)) {
    console.error(`bump: no version match in ${file} (pattern ${re}) — aborting before a partial bump`);
    process.exit(1);
  }
  writeFileSync(file, src.replace(re, to));
  console.log(`  bumped ${file}`);
}

console.log(`\nAll version locations set to ${version}.`);
