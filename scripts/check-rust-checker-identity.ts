import { dirname, fromFileUrl, resolve } from "@std/path";
import { checkRustCheckerIdentity } from "./rust-checker-identity.ts";

const root = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const identity = await checkRustCheckerIdentity(root);
console.log(`OK: Rust checker identity ${identity.sourceSha256}`);
