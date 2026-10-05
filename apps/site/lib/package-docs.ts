/**
 * The site's long-form pages are the package's own files. Nothing is copied:
 * we resolve @popjoker/knew through its own "./package.json" export and read
 * the markdown that ships in the tarball, so a page cannot describe a version
 * of the engine that was never published.
 *
 * This runs at build time, in server components only.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { marked } from "marked";

const PACKAGE_NAME = "@popjoker/knew";

/**
 * Where the installed package actually lives — the workspace symlink today, a
 * tarball tomorrow.
 *
 * Found by walking node_modules rather than with require.resolve, because the
 * bundler rewrites a static require.resolve into a module id and we want the
 * real path on disk. The name is checked, so the wrong directory cannot be
 * read by accident.
 */
function findPackageDir(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(/*turbopackIgnore: true*/ dir, "node_modules", ...PACKAGE_NAME.split("/"));
    const manifest = join(/*turbopackIgnore: true*/ candidate, "package.json");
    if (existsSync(/*turbopackIgnore: true*/ manifest)) {
      const { name } = JSON.parse(readFileSync(/*turbopackIgnore: true*/ manifest, "utf8")) as { name?: string };
      if (name === PACKAGE_NAME) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${PACKAGE_NAME} is not installed; the site renders its files`);
    dir = parent;
  }
}

export const packageDir = findPackageDir();

export const packageManifest = JSON.parse(
  readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ packageDir, "package.json"), "utf8"),
) as { name: string; version: string; license: string; description: string };

export type ShippedDoc = "README.md" | "ADOPTING.md" | "CHANGELOG.md";

export function readShipped(file: ShippedDoc): string {
  return readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ packageDir, file), "utf8");
}

export function readPrompt(name: "extract.v1" | "reconcile.v1"): string {
  return readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ packageDir, "prompts", `${name}.md`), "utf8");
}

export interface Heading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** The `##` headings of a shipped doc, for the page's own contents list. */
export function headingsOf(markdown: string): Heading[] {
  const out: Heading[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^(#{2,3})\s+(.*)$/.exec(line);
    if (match) out.push({ level: match[1]!.length, text: match[2]!.trim(), id: slugify(match[2]!.trim()) });
  }
  return out;
}

/**
 * Render a shipped doc to HTML. The first `# ` heading is dropped — the page
 * supplies its own title — and `##`/`###` get the same slugs headingsOf gives,
 * so the contents list links land.
 */
export function renderMarkdown(markdown: string, options: { dropTitle?: boolean } = {}): string {
  const body = options.dropTitle ? markdown.replace(/^#\s+.*\n/, "") : markdown;
  const renderer = new marked.Renderer();
  renderer.heading = ({ text, depth }) => {
    const id = slugify(text);
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${depth}>\n`;
  };
  return marked.parse(body, { renderer, async: false });
}

/** The fenced code blocks of a shipped doc, so a quickstart need not be retyped. */
export function codeBlocks(markdown: string): { lang: string; code: string }[] {
  const out: { lang: string; code: string }[] = [];
  const re = /```([a-z]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    out.push({ lang: match[1] || "txt", code: match[2]!.trimEnd() });
  }
  return out;
}
