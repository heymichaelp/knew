import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The entry the harness runs inside a throwaway app, with that app's own tsx:
 *
 *     node --import tsx .check/kit/run-check.ts .check/briefs/<brief>/check.ts <dir> <typecheck 0|1> [knew|baseline]
 *
 * It imports the brief's checker beside the kit, so both resolve
 * `@popjoker/knew` from the app's node_modules — the tarball under test — and
 * prints the result as one JSON line.
 */

const [checkPath, dir, typecheck, arm = "knew"] = process.argv.slice(2);
if (!checkPath || !dir) {
  process.stderr.write("usage: run-check.ts <check.ts> <dir> <typecheck 0|1>\n");
  process.exit(2);
}
try {
  const module = (await import(pathToFileURL(resolve(checkPath)).href)) as {
    check: (dir: string, options: { typecheck: boolean; arm: string }) => Promise<unknown>;
  };
  const result = await module.check(resolve(dir), { typecheck: typecheck === "1", arm });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  process.stdout.write(`${JSON.stringify({ passed: false, checks: [{ name: "the checker ran", passed: false, detail: message.slice(0, 2000) }] })}\n`);
}
