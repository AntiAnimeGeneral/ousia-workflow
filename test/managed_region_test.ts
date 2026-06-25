import { assertEquals, assertThrows } from "@std/assert";
import {
  ManagedRegionError,
  replaceManagedRegions,
} from "../src/managed_region.ts";

Deno.test("managed region replacement preserves unmarked target content", () => {
  // Goal: prove Ousia updates only explicit baseline regions.
  // Scope: unit, managed region parser/replacer.
  // Semantics: project content outside markers remains untouched.
  const target =
    '# Proposal\n\nProject note.\n\n<!-- ousia:managed:start id="current" -->\n## Old\n<!-- ousia:managed:end id="current" -->\n\nProject footer.\n';
  const source =
    '# Proposal\n\n<!-- ousia:managed:start id="current" -->\n## New\n<!-- ousia:managed:end id="current" -->\n';

  assertEquals(
    replaceManagedRegions(target, source),
    '# Proposal\n\nProject note.\n\n<!-- ousia:managed:start id="current" -->\n## New\n<!-- ousia:managed:end id="current" -->\n\nProject footer.\n',
  );
});

Deno.test("managed region replacement rejects mismatched region sets", () => {
  // Goal: avoid guessing where missing baseline regions should go.
  // Scope: unit, managed region parser/replacer.
  // Semantics: source/target region ids must match exactly.
  const target =
    '<!-- ousia:managed:start id="target" -->\nA\n<!-- ousia:managed:end id="target" -->\n';
  const source =
    '<!-- ousia:managed:start id="source" -->\nB\n<!-- ousia:managed:end id="source" -->\n';

  const error = assertThrows(
    () => replaceManagedRegions(target, source),
    ManagedRegionError,
    "id 集合不一致",
  );
  assertEquals(error.code, "managed-region-set-mismatch");
});

Deno.test("managed region replacement rejects malformed target markers", () => {
  // Goal: fail before planner produces a writable item.
  // Scope: unit, managed region parser/replacer.
  // Semantics: start/end id mismatch is a stable conflict.
  const target =
    '<!-- ousia:managed:start id="a" -->\nA\n<!-- ousia:managed:end id="b" -->\n';
  const source =
    '<!-- ousia:managed:start id="a" -->\nB\n<!-- ousia:managed:end id="a" -->\n';

  const error = assertThrows(
    () => replaceManagedRegions(target, source),
    ManagedRegionError,
    "start/end id 不一致",
  );
  assertEquals(error.code, "managed-region-mismatched-end");
});

Deno.test("managed region replacement rejects non-isolated marker lines", () => {
  // Goal: keep marker syntax visible and mechanically reviewable.
  // Scope: unit, managed region parser/replacer.
  // Semantics: marker comments must occupy the full line.
  const target =
    '<!-- ousia:managed:start id="a" --> trailing\nA\n<!-- ousia:managed:end id="a" -->\n';
  const source =
    '<!-- ousia:managed:start id="a" -->\nB\n<!-- ousia:managed:end id="a" -->\n';

  const error = assertThrows(
    () => replaceManagedRegions(target, source),
    ManagedRegionError,
    "end 没有匹配的 start",
  );
  assertEquals(error.code, "managed-region-orphan-end");
});
