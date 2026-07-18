import { basename, dirname } from "@std/path";
import * as diagnostics from "./diagnostics.ts";
import * as documentTree from "./document-tree.ts";
import * as frontmatter from "./frontmatter.ts";
import * as rules from "./rules.ts";

export async function checkDocs(
  projectRoot: string,
): Promise<diagnostics.CheckResult> {
  const diagnosticBag = new diagnostics.DiagnosticBag();
  const tree = await documentTree.readDocumentTree(projectRoot, diagnosticBag);

  if (!tree) return diagnosticBag.toResult();

  for (const file of tree.files) {
    const isInstruction = file.relativePath.endsWith(".instructions.md");
    const isSkill = file.relativePath.endsWith("/SKILL.md");
    if (!isInstruction && !isSkill) continue;
    const parsed = frontmatter.parseFrontmatter(file.text, file.relativePath);
    if (!parsed.ok) {
      parsed.diagnostics.forEach((item) =>
        diagnosticBag.error(`${item.code}: ${item.path}: ${item.message}`)
      );
      continue;
    }
    const required = isInstruction
      ? ["applyTo", "description"]
      : ["name", "description"];
    required.forEach((key) => {
      if (typeof parsed.document.attributes[key] !== "string") {
        diagnosticBag.error(
          `frontmatter-required: ${file.relativePath}: missing ${key}`,
        );
      }
    });
    if (isSkill) {
      const expectedName = basename(dirname(file.relativePath));
      const actualName = parsed.document.attributes.name;
      if (typeof actualName === "string" && actualName !== expectedName) {
        diagnosticBag.error(
          `frontmatter-skill-name: ${file.relativePath}: expected ${expectedName}, got ${actualName}`,
        );
      }
    }
  }
  rules.runProtocolRules(tree, diagnosticBag);
  return diagnosticBag.toResult();
}
