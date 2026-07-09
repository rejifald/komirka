// Single-source the constitution (issue #25). The repo-root `principles.md` is the ONE source
// of truth; this script generates `content/docs/principles.mdx` from it. It runs automatically
// on `predev` / `prebuild` and at the front of `types:check`, and on demand via
// `pnpm --filter site sync:principles`. The output carries a DO-NOT-EDIT banner: any hand edit
// is overwritten on the next build, so the site can no longer drift from the repo file.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../../principles.md");
const OUT = resolve(here, "../content/docs/principles.mdx");
const BLOB = "https://github.com/rejifald/tessellum/blob/main";
const TREE = "https://github.com/rejifald/tessellum/tree/main";

let body = readFileSync(SRC, "utf8");

// The frontmatter `title` renders the H1, so drop the leading "# Principles".
body = body.replace(/^#\s+Principles\s*\n+/, "");

// Rewrite repo-relative links so they resolve on the site:
//   site/content/docs/<path>.mdx[#anchor]  ->  /docs/<path>[#anchor]      (a real site route)
//   docs/<path>/                            ->  GitHub tree URL            (a repo dir, e.g. docs/adr/)
//   docs/<path>                             ->  GitHub blob URL            (a repo file, not on the site)
// http(s) links and existing /docs routes are left untouched.
body = body.replace(
  /\]\(site\/content\/docs\/([^)#]+?)\.mdx(#[^)]+)?\)/g,
  (_m, p, anchor = "") => `](/docs/${p}${anchor})`,
);
body = body.replace(/\]\(docs\/([^)]+?)\/\)/g, (_m, p) => `](${TREE}/docs/${p})`);
body = body.replace(/\]\(docs\/([^)]+?)\)/g, (_m, p) => `](${BLOB}/docs/${p})`);

const frontmatter = `---
title: Principles
description: The project constitution — every hard constraint, every pitfall found in adversarial review, and the full security model.
---
`;

const banner = `
{/* GENERATED FILE — do not edit. Single source of truth: principles.md at the repo root.
    Regenerate with \`pnpm --filter site sync:principles\` (runs automatically on dev/build, #25). */}

> **Canonical copy.** This page is generated from [\`principles.md\`](${BLOB}/principles.md) at the repo root — the single source of truth. Edits made directly here are overwritten on the next build.
`;

writeFileSync(OUT, frontmatter + banner + "\n" + body);
console.log(`[gen-principles] wrote ${OUT.replace(resolve(here, "../.."), ".")} from principles.md`);
