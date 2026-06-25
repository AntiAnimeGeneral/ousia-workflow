import { DiagnosticBag } from "./diagnostics.ts";
import type { DocumentTree } from "./document-tree.ts";
import { basename, dirname, resolveAgainst } from "./document-tree.ts";
import {
  BARE_NUMBERED_REFERENCE_PATTERN,
  EXTERNAL_LINK_PREFIXES,
  NUMBERED_FILENAME_PATTERN,
  NUMBERED_HEADING_PATTERN,
} from "./protocol.ts";

interface LinkRef {
  text: string;
  target: string;
}

interface DirectorySequenceEntry {
  number: number;
  numberText: string;
}

type Rule = (context: RuleContext) => void;

interface RuleContext {
  tree: DocumentTree;
  diagnostics: DiagnosticBag;
}

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

export function runProtocolRules(
  tree: DocumentTree,
  diagnostics: DiagnosticBag,
): void {
  const rules: Rule[] = [
    checkLinks,
    checkNumberedHeadings,
    checkBareNumberedReferences,
    checkDirectorySequences,
    checkOusiaIndexOnly,
  ];

  const context: RuleContext = { tree, diagnostics };
  for (const rule of rules) {
    rule(context);
  }
}

function checkLinks({ tree, diagnostics }: RuleContext): void {
  for (const file of tree.files) {
    for (const link of markdownLinks(file.text)) {
      const target = link.target.trim().split(/\s+/, 1)[0];
      if (!target || isExternalTarget(target)) continue;

      const targetPath = target.split("#", 1)[0];
      if (!targetPath || !isDocumentLink(targetPath, tree.extensions)) continue;

      const resolvedPath = resolveAgainst(dirname(file.path), targetPath);
      if (!tree.filePaths.has(resolvedPath)) {
        diagnostics.error(
          `broken markdown link: ${file.relativePath} -> ${target}`,
        );
        continue;
      }

      const displayedBasename = stripBackticks(link.text.trim());
      const targetBasename = basename(targetPath);
      if (displayedBasename !== targetBasename) {
        diagnostics.error(
          `markdown link text does not match target filename: ${file.relativePath} has [${link.text}] -> ${targetBasename}`,
        );
      }
    }
  }
}

function checkNumberedHeadings({ tree, diagnostics }: RuleContext): void {
  for (const file of tree.files) {
    const filenameNumber = extractGroup(
      file.basename.match(NUMBERED_FILENAME_PATTERN),
      "number",
    );
    if (!filenameNumber) continue;

    const firstHeading = firstH1(file.text);
    if (!firstHeading) {
      diagnostics.error(`missing H1 heading: ${file.relativePath}`);
      continue;
    }

    const headingNumber = extractGroup(
      firstHeading.match(NUMBERED_HEADING_PATTERN),
      "number",
    );
    if (!headingNumber) {
      diagnostics.error(
        `H1 heading does not match numbered-heading protocol: ${file.relativePath}`,
      );
    } else if (headingNumber !== filenameNumber) {
      diagnostics.error(
        `filename/H1 number mismatch: ${file.relativePath} has H1 ${headingNumber}`,
      );
    }
  }
}

function checkBareNumberedReferences({ tree, diagnostics }: RuleContext): void {
  for (const file of tree.files) {
    for (
      const match of stripMarkdownCode(file.text).matchAll(
        BARE_NUMBERED_REFERENCE_PATTERN,
      )
    ) {
      const filename = extractGroup(match, "filename");
      if (!filename || tree.fileBasenames.has(filename)) continue;
      diagnostics.error(
        `unknown numbered markdown filename reference in ${file.relativePath}: ${filename}`,
      );
    }
  }
}

function checkDirectorySequences({ tree, diagnostics }: RuleContext): void {
  const directories = new Map<string, DirectorySequenceEntry[]>();

  for (const file of tree.files) {
    const numberText = extractGroup(
      file.basename.match(NUMBERED_FILENAME_PATTERN),
      "number",
    );
    if (!numberText) continue;

    const entries = directories.get(file.directory) ?? [];
    entries.push({ number: Number.parseInt(numberText, 10), numberText });
    directories.set(file.directory, entries);
  }

  for (const [directory, entries] of directories) {
    entries.sort((left, right) => left.number - right.number);
    const actualNumbers = entries.map((entry) => entry.number);
    const expectedNumbers = entries.map((_, index) => index);
    if (sameNumberList(actualNumbers, expectedNumbers)) continue;

    const width = Math.max(
      2,
      ...entries.map((entry) => entry.numberText.length),
    );
    diagnostics.error(
      `numbered markdown files are not continuous in ${directory}: expected ${
        formatNumberList(
          expectedNumbers,
          width,
        )
      }, got ${formatNumberList(actualNumbers, width)}`,
    );
  }
}

function checkOusiaIndexOnly({ tree, diagnostics }: RuleContext): void {
  for (const file of tree.files) {
    if (
      !file.relativePath.startsWith(".ousia/") ||
      file.basename !== "index.md"
    ) {
      continue;
    }

    for (const [index, line] of file.text.split("\n").entries()) {
      if (isAllowedIndexLine(line)) continue;

      diagnostics.error(
        `non-index content in .ousia index file: ${file.relativePath}:${
          index + 1
        }`,
      );
    }
  }
}

function markdownLinks(text: string): LinkRef[] {
  return [...stripMarkdownCode(text).matchAll(MARKDOWN_LINK_RE)].map(
    (match) => ({
      text: match[1],
      target: match[2],
    }),
  );
}

function stripMarkdownCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`+[^`\n]*`+/g, "");
}

function firstH1(text: string): string | undefined {
  return text.split("\n").find((line) => line.startsWith("# "));
}

function isAllowedIndexLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("# ") ||
    trimmed.startsWith("## ") ||
    trimmed.startsWith("| ") ||
    isManagedRegionMarker(trimmed)
  );
}

function isManagedRegionMarker(line: string): boolean {
  return /^<!--\s*ousia:managed:(start|end)\s+id="[A-Za-z0-9._:-]+"\s*-->$/
    .test(
      line,
    );
}

function isDocumentLink(targetPath: string, extensions: string[]): boolean {
  return extensions.some((extension) => targetPath.endsWith(extension));
}

function extractGroup(
  match: RegExpMatchArray | null,
  groupName: string,
): string | undefined {
  if (!match) return undefined;
  return match.groups?.[groupName] ?? match[1];
}

function isExternalTarget(target: string): boolean {
  return EXTERNAL_LINK_PREFIXES.some((prefix) => target.startsWith(prefix));
}

function stripBackticks(text: string): string {
  return text.startsWith("`") && text.endsWith("`") ? text.slice(1, -1) : text;
}

function sameNumberList(left: number[], right: number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function formatNumberList(numbers: number[], width: number): string {
  return numbers
    .map((number) => number.toString().padStart(width, "0"))
    .join(", ");
}
