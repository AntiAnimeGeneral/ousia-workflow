export const DOCUMENT_ROOTS = [".github", ".ousia"];
export const DOCUMENT_EXTENSIONS = [".md"];
export const EXTERNAL_LINK_PREFIXES = ["http://", "https://", "mailto:", "#"];
export const NUMBERED_FILENAME_PATTERN = /^(?<number>\d{2})-.+\.md$/;
export const NUMBERED_HEADING_PATTERN = /^#\s+(?<number>\d{2})\b/;
export const BARE_NUMBERED_REFERENCE_PATTERN =
  /(?<![A-Za-z0-9_/.-])(?<filename>\d{2}-[A-Za-z0-9_.-]+\.md)(?![A-Za-z0-9_.-])/g;
