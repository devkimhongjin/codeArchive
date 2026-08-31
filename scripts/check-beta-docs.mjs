import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Deliberately scoped to the maintained beta kit, not a general Markdown parser.
const root = resolve(process.argv[2] ?? ".");
const docs = ["README.md", "docs/beta-install.md", "docs/dashboard-beta-tester-guide.md",
  "docs/beta-troubleshooting.md", "docs/beta-distribution-checklist.md",
  "docs/beta-invite-template.md", "docs/beta-access-design.md", "docs/dashboard-ai-beta-acceptance.md"];
const failures = [];
let checked = 0;
for (const file of docs) {
  const absolute = resolve(root, file);
  const content = readFileSync(absolute, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const link = match[1];
    if (/^(?:https?:|mailto:|#)/.test(link)) continue;
    const target = decodeURIComponent(link.split("#")[0]);
    if (!existsSync(resolve(dirname(absolute), target))) failures.push(`${file}: ${link}`);
    checked++;
  }
}
if (failures.length) throw new Error(`Missing beta documentation links:\n${failures.join("\n")}`);
console.log(`Beta docs: ${docs.length} documents, ${checked} local links verified.`);
