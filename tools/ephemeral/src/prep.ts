import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Preparing a throwaway directory: the package as an adopter gets it (the
 * packed tarball, never the workspace), a scaffold held to strict settings,
 * the brief and its inputs, installed. Nothing here is timed or charged to
 * the agent — it is the desk the agent sits down at.
 */

export const WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = resolve(WORKSPACE, "..", "..");
export const BRIEFS = join(WORKSPACE, "briefs");

/**
 * The compiler options every throwaway app is held to, and the references
 * with them: `briefs/tsconfig.json` must carry exactly these, which
 * `test/scaffold.test.ts` checks. Strict and NodeNext with `skipLibCheck`
 * off, so the package's shipped declarations are checked the way a careful
 * adopter's build would check them.
 */
export const SCAFFOLD_COMPILER_OPTIONS = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  skipLibCheck: false,
  noEmit: true,
  allowImportingTsExtensions: true,
  // ADOPTING keeps definitions as JSON and imports them; an adopter's build allows it.
  resolveJsonModule: true,
  types: ["node"],
} as const;

export interface Tarball {
  path: string;
  file: string;
  sha256: string;
}

export function tarballAt(path: string): Tarball {
  return { path, file: basename(path), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

/** `npm pack` the package into `destination`: what an adopter installs, built fresh. */
export function packTarball(destination: string): Tarball {
  const out = execFileSync("npm", ["pack", "--workspace", "@popjoker/knew", "--pack-destination", destination, "--silent"], {
    cwd: REPO,
    encoding: "utf8",
  });
  const file = out.trim().split("\n").filter(Boolean).pop();
  if (!file) throw new Error("npm pack named no tarball");
  return tarballAt(join(destination, file));
}

/** The dev tools' exact versions, read from the root lockfile rather than typed, so a throwaway app builds with what the repo builds with. */
export function lockfileVersions(): { tsx: string; typescript: string; typesNode: string } {
  const lock = JSON.parse(readFileSync(join(REPO, "package-lock.json"), "utf8")) as { packages?: Record<string, { version?: string }> };
  const version = (name: string) => {
    const found = lock.packages?.[`node_modules/${name}`]?.version;
    if (!found) throw new Error(`the root lockfile has no ${name}`);
    return found;
  };
  return { tsx: version("tsx"), typescript: version("typescript"), typesNode: version("@types/node") };
}

/** Node and tsc resolve upward: a `package.json` or `node_modules` above the run directory would quietly lend it the wrong copy of something. */
export function assertClearAncestry(dir: string): void {
  for (let at = dirname(dir); ; at = dirname(at)) {
    for (const name of ["package.json", "node_modules"]) {
      if (existsSync(join(at, name))) throw new Error(`${join(at, name)} sits above ${dir} and would leak into its module resolution`);
    }
    if (dirname(at) === at) return;
  }
}

export interface Scaffold {
  packageJson: string;
  tsconfig: string;
}

export function scaffoldFiles(tarballFile: string, name: string, versions = lockfileVersions()): Scaffold {
  const packageJson = {
    name,
    private: true,
    type: "module",
    scripts: { test: "node --import tsx --test test/*.test.ts", typecheck: "tsc --noEmit -p ." },
    dependencies: { "@popjoker/knew": `file:vendor/${tarballFile}` },
    devDependencies: { "@types/node": versions.typesNode, tsx: versions.tsx, typescript: versions.typescript },
  };
  const tsconfig = { compilerOptions: SCAFFOLD_COMPILER_OPTIONS, include: ["src", "test"] };
  return { packageJson: `${JSON.stringify(packageJson, null, 2)}\n`, tsconfig: `${JSON.stringify(tsconfig, null, 2)}\n` };
}

/** Install with no user npm config, so no credential of yours is in reach. */
export function npmInstall(dir: string): void {
  const result = spawnSync("npm", ["install", "--prefer-offline", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NPM_CONFIG_USERCONFIG: "/dev/null" },
  });
  if (result.status !== 0) throw new Error(`npm install failed in ${dir}:\n${result.stderr}`);
}

export interface PreparedDir {
  dir: string;
  scaffold: Scaffold;
}

/** A fresh, installed directory under the system temp dir, never inside the repo, holding the scaffold and the tarball. */
export function prepareDir(label: string, tarball: Tarball): PreparedDir {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `knew-ephemeral-${label}-`)));
  assertClearAncestry(dir);
  mkdirSync(join(dir, "vendor"));
  copyFileSync(tarball.path, join(dir, "vendor", tarball.file));
  const scaffold = scaffoldFiles(tarball.file, `ephemeral-${label}`);
  writeFileSync(join(dir, "package.json"), scaffold.packageJson);
  writeFileSync(join(dir, "tsconfig.json"), scaffold.tsconfig);
  npmInstall(dir);
  return { dir, scaffold };
}

/** Lay a brief's `BRIEF.md` and inputs into a prepared directory. */
export function layBrief(dir: string, brief: string, inputs: readonly string[]): void {
  copyFileSync(join(BRIEFS, brief, "BRIEF.md"), join(dir, "BRIEF.md"));
  for (const input of inputs) cpSync(join(BRIEFS, brief, input), join(dir, input), { recursive: true });
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
