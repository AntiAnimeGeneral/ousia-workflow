export type ManagedRegionErrorCode =
  | "managed-region-duplicate-id"
  | "managed-region-mismatched-end"
  | "managed-region-missing-end"
  | "managed-region-nested-start"
  | "managed-region-orphan-end"
  | "managed-region-set-mismatch";

export class ManagedRegionError extends Error {
  readonly code: ManagedRegionErrorCode;

  constructor(code: ManagedRegionErrorCode, message: string) {
    super(message);
    this.name = "ManagedRegionError";
    this.code = code;
  }
}

interface ManagedRegion {
  id: string;
  start: number;
  end: number;
  text: string;
}

const startMarker =
  /^<!--\s*ousia:managed:start\s+id="([A-Za-z0-9._:-]+)"\s*-->\n?$/;
const endMarker =
  /^<!--\s*ousia:managed:end\s+id="([A-Za-z0-9._:-]+)"\s*-->\n?$/;

export function replaceManagedRegions(
  targetContent: string,
  sourceContent: string,
): string {
  const sourceRegions = parseManagedRegions(sourceContent);
  if (sourceRegions.length === 0) {
    throw new ManagedRegionError(
      "managed-region-set-mismatch",
      "source baseline 缺少 Ousia managed region marker",
    );
  }
  const targetRegions = parseManagedRegions(targetContent);
  assertSameRegionIds(sourceRegions, targetRegions);

  let output = "";
  let cursor = 0;
  for (const targetRegion of targetRegions) {
    const sourceRegion = sourceRegions.find((region) =>
      region.id === targetRegion.id
    );
    if (sourceRegion === undefined) {
      throw new ManagedRegionError(
        "managed-region-set-mismatch",
        `目标文件缺少 Ousia managed region: ${targetRegion.id}`,
      );
    }
    output += targetContent.slice(cursor, targetRegion.start);
    output += sourceRegion.text;
    cursor = targetRegion.end;
  }

  output += targetContent.slice(cursor);
  return output;
}

function parseManagedRegions(content: string): ManagedRegion[] {
  const regions: ManagedRegion[] = [];
  const seen = new Set<string>();
  let active: { id: string; start: number } | null = null;

  for (const line of content.matchAll(/^.*(?:\n|$)/gm)) {
    const text = line[0];
    if (text === "") continue;
    const lineStart = line.index ?? 0;

    const startMatch = startMarker.exec(text);
    if (startMatch) {
      if (active !== null) {
        throw new ManagedRegionError(
          "managed-region-nested-start",
          `Ousia managed region 不允许嵌套: ${startMatch[1]}`,
        );
      }
      const id = startMatch[1];
      if (seen.has(id)) {
        throw new ManagedRegionError(
          "managed-region-duplicate-id",
          `Ousia managed region id 重复: ${id}`,
        );
      }
      active = { id, start: lineStart };
      seen.add(id);
      continue;
    }

    const endMatch = endMarker.exec(text);
    if (endMatch) {
      const id = endMatch[1];
      if (active === null) {
        throw new ManagedRegionError(
          "managed-region-orphan-end",
          `Ousia managed region end 没有匹配的 start: ${id}`,
        );
      }
      if (active.id !== id) {
        throw new ManagedRegionError(
          "managed-region-mismatched-end",
          `Ousia managed region start/end id 不一致: ${active.id} / ${id}`,
        );
      }
      const end = lineStart + text.length;
      regions.push({
        id,
        start: active.start,
        end,
        text: content.slice(active.start, end),
      });
      active = null;
    }
  }

  if (active !== null) {
    throw new ManagedRegionError(
      "managed-region-missing-end",
      `Ousia managed region 缺少 end marker: ${active.id}`,
    );
  }

  return regions;
}

function assertSameRegionIds(
  sourceRegions: ManagedRegion[],
  targetRegions: ManagedRegion[],
): void {
  const sourceIds = sourceRegions.map((region) => region.id).sort();
  const targetIds = targetRegions.map((region) => region.id).sort();
  if (sourceIds.length !== targetIds.length) {
    throw regionSetMismatch(sourceIds, targetIds);
  }

  for (let index = 0; index < sourceIds.length; index += 1) {
    if (sourceIds[index] !== targetIds[index]) {
      throw regionSetMismatch(sourceIds, targetIds);
    }
  }
}

function regionSetMismatch(
  sourceIds: string[],
  targetIds: string[],
): ManagedRegionError {
  return new ManagedRegionError(
    "managed-region-set-mismatch",
    `Ousia managed region id 集合不一致: source=${
      sourceIds.join(",")
    }; target=${targetIds.join(",")}`,
  );
}
