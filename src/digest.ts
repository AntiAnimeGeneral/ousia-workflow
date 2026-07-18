export async function sha256(content: Uint8Array): Promise<string> {
  const bytes = Uint8Array.from(content);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
