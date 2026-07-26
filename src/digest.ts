export async function sha256(content: Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(content);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export interface TreeEntry {
  path: string;
  sha256: string;
}

export async function treeSha256(entries: TreeEntry[]): Promise<string> {
  const canonical = entries
    .map((entry) => `${entry.path}\0${entry.sha256}`)
    .sort()
    .join("\0");
  return await sha256(new TextEncoder().encode(canonical));
}
