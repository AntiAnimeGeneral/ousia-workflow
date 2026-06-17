import {
  type CheckResult,
  DiagnosticBag,
  formatDiagnostics,
} from "./diagnostics.ts";
import { readDocumentTree } from "./document-tree.ts";
import { runProtocolRules } from "./rules.ts";

export type { CheckResult, Diagnostic, Severity } from "./diagnostics.ts";
export { formatDiagnostics };

export async function checkDocs(projectRoot: string): Promise<CheckResult> {
  const diagnostics = new DiagnosticBag();
  const tree = await readDocumentTree(projectRoot, diagnostics);

  if (!tree) return diagnostics.toResult();

  runProtocolRules(tree, diagnostics);
  return diagnostics.toResult();
}
