import { dirname, fromFileUrl, resolve } from "@std/path";
import { writeRustCheckerIdentity } from "./rust-checker-identity.ts";

const root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const identity = await writeRustCheckerIdentity(root);
console.log(`Updated Rust checker identity ${identity.sourceSha256}`);
