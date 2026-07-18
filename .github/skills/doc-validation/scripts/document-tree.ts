import { walk } from "@std/fs/walk";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  normalize,
  relative,
  resolve,
} from "@std/path";
import * as diagnostics from "./diagnostics.ts";
import { deno } from "./deno-runtime.ts";
import { DOCUMENT_EXTENSIONS, DOCUMENT_ROOTS } from "./protocol.ts";

export interface MarkdownFile {
  path: string;
  relativePath: string;
  directory: string;
  basename: string;
  extension: string;
  text: string;
}

export interface DocumentTree {
  projectRoot: string;
  documentRoots: string[];
  documentLabel: string;
  extensions: string[];
  files: MarkdownFile[];
  filePaths: Set<string>;
  fileBasenames: Set<string>;
}

export async function readDocumentTree(
  projectRoot: string,
  diagnosticBag: diagnostics.DiagnosticBag,
): Promise<DocumentTree | undefined> {
  const root = normalizePath(await deno.realPath(projectRoot));
  const documentRoots = DOCUMENT_ROOTS.map((protocolRoot) =>
    resolveAgainst(root, protocolRoot)
  );
  const documentLabel = DOCUMENT_ROOTS.map(toSlash).join(", ");

  for (const [index, documentRoot] of documentRoots.entries()) {
    if (await isDirectory(documentRoot)) continue;
    diagnosticBag.error(
      `document root not found: ${toSlash(DOCUMENT_ROOTS[index])}`,
    );
  }
  if (diagnosticBag.toResult().errors.length > 0) {
    return undefined;
  }

  const files = (
    await Promise.all(
      documentRoots.map((documentRoot) =>
        readMarkdownFiles(documentRoot, root)
      ),
    )
  ).flat();
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  return {
    projectRoot: root,
    documentRoots,
    documentLabel,
    extensions: DOCUMENT_EXTENSIONS,
    files,
    filePaths: new Set(files.map((file) => file.path)),
    fileBasenames: new Set(files.map((file) => file.basename)),
  };
}

export function resolveAgainst(base: string, target: string): string {
  return normalizePath(isAbsolute(target) ? target : resolve(base, target));
}

function relativePath(root: string, path: string): string {
  return toSlash(relative(root, path)) || ".";
}

function normalizePath(path: string): string {
  return toSlash(normalize(path));
}

function toSlash(path: string): string {
  return path.replaceAll("\\", "/");
}

async function readMarkdownFiles(
  dir: string,
  root: string,
): Promise<MarkdownFile[]> {
  const files: MarkdownFile[] = [];
  for await (
    const entry of walk(dir, {
      exts: DOCUMENT_EXTENSIONS,
      includeDirs: false,
      includeFiles: true,
    })
  ) {
    const relativeFilePath = relativePath(root, entry.path);
    files.push({
      path: normalizePath(entry.path),
      relativePath: relativeFilePath,
      directory: toSlash(dirname(relativeFilePath)),
      basename: basename(entry.path),
      extension: extname(entry.path),
      text: await deno.readTextFile(entry.path),
    });
  }
  return files;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await deno.stat(path)).isDirectory;
  } catch (error) {
    if (error instanceof deno.errors.NotFound) return false;
    throw error;
  }
}
