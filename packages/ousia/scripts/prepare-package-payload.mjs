import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSourceSnapshot } from "../dist/src/source.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(packageRoot, "../..");
const payloadRoot = path.join(packageRoot, "dist/payload");

await fs.rm(payloadRoot, { recursive: true, force: true });
const source = await readSourceSnapshot(repoRoot);

for (const file of source.files) {
  const relativePath = file.relativePath;
  const targetPath = path.join(payloadRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, file.content);
}