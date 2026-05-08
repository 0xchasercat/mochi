#!/usr/bin/env bun
//
// Rewrite workspace:* references in packages/<name>/package.json to the
// actual current version of the sibling package, so that npm publish (via
// changeset publish) emits tarballs with concrete dep ranges.
//
// This is a publish-time pre-hook. Run it BEFORE changeset publish.
//
// Background:
//   Bun's workspace protocol uses 'workspace:*' to mean "use the local
//   sibling at link-time". Great for monorepo dev. On publish the protocol
//   must be replaced with a real semver range. pnpm/yarn handle this
//   transparently. npm and changeset publish (which wraps npm publish) DO
//   NOT — npm publish uploads the tarball verbatim, so consumers get
//   '@mochi.js/inject: workspace:*' in their dep tree, which Bun/npm
//   rightly refuse to resolve.
//
//   We hit this on v0.1.0: every published package with internal deps
//   leaked workspace:* and 'bun add @mochi.js/core@0.1.0' fails with
//   'Workspace dependency not found'. Hot-fixing in v0.1.1 via this
//   script.
//
// Behavior:
//   - Read every package.json under packages/<name>/ (each workspace
//     package).
//   - Build a name -> version map from those package.jsons.
//   - For every dependency / devDependency / peerDependency /
//     optionalDependencies entry whose value starts with 'workspace:',
//     rewrite to a concrete range derived from the sibling version map.
//   - 'workspace:*'    -> '^<sibling-version>'
//   - 'workspace:^'    -> '^<sibling-version>'
//   - 'workspace:~'    -> '~<sibling-version>'
//   - 'workspace:X.Y.Z' -> 'X.Y.Z' (prefix stripped)
//   - Writes the modified package.json in-place. We do NOT restore after
//     publish; changeset version always re-emits package.json on the next
//     release cycle, and Bun's workspace links use the 'name' field, not
//     the dep string. Concrete versions on disk between cycles are fine.
//
// Idempotency: running this twice is a no-op once all 'workspace:*'
// strings are gone.
//
// Used by package.json:
//   "release": "bun run build && bun scripts/rewrite-workspace-deps.ts && \
//               bunx --bun @changesets/cli publish"

import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES_DIR = join(ROOT, "packages");

const DEP_KEYS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

interface PackageJson {
  name?: string;
  version?: string;
  [key: string]: unknown;
}

async function loadAllPackageJsons(): Promise<Map<string, { path: string; data: PackageJson }>> {
  const out = new Map<string, { path: string; data: PackageJson }>();
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(PACKAGES_DIR, entry.name, "package.json");
    const file = Bun.file(pkgPath);
    if (!(await file.exists())) continue;
    const data = (await file.json()) as PackageJson;
    if (typeof data.name !== "string" || typeof data.version !== "string") {
      console.warn(`[rewrite] skipping ${pkgPath} — missing name/version`);
      continue;
    }
    out.set(data.name, { path: pkgPath, data });
  }
  return out;
}

// Translate one workspace-protocol value to a concrete semver range.
//   workspace:*       -> ^<sibling-version>
//   workspace:^       -> ^<sibling-version>
//   workspace:~       -> ~<sibling-version>
//   workspace:1.2.3   -> 1.2.3
//   workspace:^1.2.3  -> ^1.2.3
//   anything else     -> returned unchanged
function rewriteWorkspaceValue(value: string, siblingVersion: string): string {
  if (!value.startsWith("workspace:")) return value;
  const rest = value.slice("workspace:".length);
  if (rest === "*") return `^${siblingVersion}`;
  if (rest === "^") return `^${siblingVersion}`;
  if (rest === "~") return `~${siblingVersion}`;
  return rest;
}

async function main(): Promise<number> {
  const pkgs = await loadAllPackageJsons();
  if (pkgs.size === 0) {
    console.error(`[rewrite] no packages found under ${PACKAGES_DIR}`);
    return 1;
  }

  const versionFor = (name: string): string | undefined => pkgs.get(name)?.data.version;

  let totalRewrites = 0;
  for (const [pkgName, { path, data }] of pkgs) {
    let dirty = false;
    for (const depKey of DEP_KEYS) {
      const block = data[depKey];
      if (block === undefined || block === null || typeof block !== "object") continue;
      const deps = block as Record<string, string>;
      for (const [dep, value] of Object.entries(deps)) {
        if (typeof value !== "string" || !value.startsWith("workspace:")) continue;
        const sibVer = versionFor(dep);
        if (sibVer === undefined) {
          console.error(
            `[rewrite] ${pkgName}: dep ${dep} uses workspace: protocol but no sibling package was found.`,
          );
          return 1;
        }
        const next = rewriteWorkspaceValue(value, sibVer);
        if (next !== value) {
          deps[dep] = next;
          dirty = true;
          totalRewrites += 1;
          console.log(`[rewrite] ${pkgName} (${depKey}): ${dep} ${value} -> ${next}`);
        }
      }
    }
    if (dirty) {
      const serialized = `${JSON.stringify(data, null, 2)}\n`;
      await Bun.write(path, serialized);
    }
  }

  console.log(
    `[rewrite] done — ${totalRewrites} workspace: refs rewritten across ${pkgs.size} packages.`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
