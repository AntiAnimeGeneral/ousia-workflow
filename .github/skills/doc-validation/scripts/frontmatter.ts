export interface FrontmatterDiagnostic {
  code: string;
  path: string;
  message: string;
  remediation: string;
}

export interface FrontmatterDocument {
  attributes: Record<string, string | string[]>;
  body: string;
}

export type FrontmatterResult =
  | { ok: true; document: FrontmatterDocument }
  | { ok: false; diagnostics: FrontmatterDiagnostic[] };

export function parseFrontmatter(
  text: string,
  path: string,
): FrontmatterResult {
  const fail = (
    code: string,
    message: string,
    remediation: string,
  ): FrontmatterResult => ({
    ok: false,
    diagnostics: [{ code, path, message, remediation }],
  });

  if (text.startsWith("\uFEFF")) {
    return fail(
      "frontmatter-bom",
      "frontmatter 文件不允许 BOM。",
      "移除文件开头的 BOM。",
    );
  }
  const lines = text.split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") {
    return fail(
      "frontmatter-missing",
      "文件必须以 frontmatter delimiter 开头。",
      "在文件首行添加 `---` frontmatter。",
    );
  }

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].replace(/\r$/, "") === "---") {
      end = index;
      break;
    }
  }
  if (end < 0) {
    return fail(
      "frontmatter-unclosed",
      "frontmatter 缺少结束 delimiter。",
      "添加单独一行 `---` 结束 frontmatter。",
    );
  }

  const attributes: Record<string, string | string[]> = {};
  for (let index = 1; index < end; index += 1) {
    const raw = lines[index].replace(/\r$/, "");
    if (raw.trim() === "") continue;
    if (/^[ \t]/.test(raw)) {
      return fail(
        "frontmatter-nested",
        `第 ${index + 1} 行包含嵌套或缩进值。`,
        "只使用顶层 string 或 string[] 字段。",
      );
    }
    if (/^[^:]+:\s*[&*!]|<<:/.test(raw)) {
      return fail(
        "frontmatter-yaml-feature",
        `第 ${index + 1} 行使用了不支持的 YAML 特性。`,
        "移除 anchor、alias、tag 或 merge key。",
      );
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw);
    if (!match) {
      return fail(
        "frontmatter-syntax",
        `第 ${index + 1} 行不是合法的 key/value。`,
        "使用 `key: value` 语法。",
      );
    }
    const [, key, encoded] = match;
    if (Object.hasOwn(attributes, key)) {
      return fail(
        "frontmatter-duplicate-key",
        `frontmatter key 重复：${key}。`,
        "每个 key 只声明一次。",
      );
    }
    const value = parseValue(encoded);
    if (!value.ok) {
      return fail(
        value.code,
        `字段 ${key}：${value.message}`,
        value.remediation,
      );
    }
    attributes[key] = value.value;
  }

  const bodyLines = lines.slice(end + 1);
  for (let index = 0; index < bodyLines.length; index += 1) {
    if (!/^---(?:\s+#.*|\s*)$/.test(bodyLines[index].replace(/\r$/, ""))) {
      continue;
    }
    const next = bodyLines.slice(index + 1).find((line) => {
      const value = line.replace(/\r$/, "").trim();
      return value !== "" && !value.startsWith("#");
    }) ?? "";
    if (
      /^(?:[A-Za-z][A-Za-z0-9_-]*:\s*.*|-\s+\S+)/.test(next.replace(/\r$/, ""))
    ) {
      return fail(
        "frontmatter-multiple-documents",
        "正文中不允许第二个 YAML/frontmatter 文档。",
        "只保留文件开头的单个 frontmatter。",
      );
    }
  }
  return { ok: true, document: { attributes, body: bodyLines.join("\n") } };
}

type ParsedValue =
  | { ok: true; value: string | string[] }
  | { ok: false; code: string; message: string; remediation: string };

function parseValue(encoded: string): ParsedValue {
  const value = encoded.trim();
  if (value === "") {
    return invalid(
      "frontmatter-empty-value",
      "值不能为空。",
      "填写非空字符串或非空字符串数组。",
    );
  }
  if (value.startsWith("[") || value.endsWith("]")) {
    if (!(value.startsWith("[") && value.endsWith("]"))) {
      return invalid(
        "frontmatter-array-syntax",
        "数组 delimiter 不完整。",
        '使用 `["value"]` 形式。',
      );
    }
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      return invalid(
        "frontmatter-empty-array",
        "数组不能为空。",
        "至少填写一个非空字符串。",
      );
    }
    const parts = splitArray(inner);
    if (!parts) {
      return invalid(
        "frontmatter-array-syntax",
        "数组字符串语法无效。",
        "使用逗号分隔的 plain 或 quoted 字符串。",
      );
    }
    const values: string[] = [];
    for (const part of parts) {
      const scalar = parseScalar(part.trim());
      if (!scalar) {
        return invalid(
          "frontmatter-array-item",
          "数组项必须是非空字符串。",
          "移除空项、对象、数字、布尔值或 null。",
        );
      }
      values.push(scalar);
    }
    return { ok: true, value: values };
  }
  const scalar = parseScalar(value);
  if (!scalar) {
    return invalid(
      "frontmatter-string",
      "值必须是非空字符串。",
      "使用 non-empty plain 或 quoted string。",
    );
  }
  return { ok: true, value: scalar };
}

function parseScalar(value: string): string | null {
  if (!value) return null;
  if (/^[&*!|>]/.test(value) || /^<<:/.test(value)) return null;
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
  if (quoted) return quoted[2] || null;
  if (
    /^["']|["']$/.test(value) ||
    /^(true|false|null|~|[-+]?\d+(\.\d+)?)$/i.test(value)
  ) {
    return null;
  }
  if (/^[\[{]/.test(value) || /[\]}]$/.test(value) || /:\s/.test(value)) {
    return null;
  }
  return value;
}

function splitArray(value: string): string[] | null {
  const parts: string[] = [];
  let quote = "";
  let current = "";
  for (const char of value) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
    }
    if (char === "," && !quote) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (quote) return null;
  parts.push(current);
  return parts;
}

function invalid(
  code: string,
  message: string,
  remediation: string,
): ParsedValue {
  return { ok: false, code, message, remediation };
}
