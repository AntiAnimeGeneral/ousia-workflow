import { deno } from "./deno-runtime.ts";
import * as frontmatter from "./frontmatter.ts";

deno.test("frontmatter accepts only string projections", () => {
  const result = frontmatter.parseFrontmatter(
    '---\nname: "example"\ntags: [one, "two"]\n---\n# Body\n',
    "fixture.md",
  );
  assertEquals(result.ok, true);
});

deno.test("frontmatter returns diagnostics for duplicate key", () => {
  const result = frontmatter.parseFrontmatter(
    "---\nname: one\nname: two\n---\n",
    "fixture.md",
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.diagnostics[0].code, "frontmatter-duplicate-key");
  }
});

deno.test("frontmatter rejects implicit YAML types", () => {
  const result = frontmatter.parseFrontmatter(
    "---\nname: true\n---\n",
    "fixture.md",
  );
  assertEquals(result.ok, false);
});

deno.test("frontmatter permits Markdown thematic breaks in body", () => {
  const result = frontmatter.parseFrontmatter(
    '---\nname: "example"\n---\n# Body\n\n---\n\nMore\n',
    "fixture.md",
  );
  assertEquals(result.ok, true);
});

deno.test("frontmatter rejects YAML features inside arrays", () => {
  const result = frontmatter.parseFrontmatter(
    "---\ntags: [&anchor value]\n---\n# Body\n",
    "fixture.md",
  );
  assertEquals(result.ok, false);
});

deno.test("frontmatter rejects a second YAML document", () => {
  const result = frontmatter.parseFrontmatter(
    '---\nname: "example"\n---\n# Body\n\n---\nother: value\n---\n',
    "fixture.md",
  );
  assertEquals(result.ok, false);
});

deno.test("frontmatter rejects block scalars", () => {
  const result = frontmatter.parseFrontmatter(
    "---\ndescription: |\n---\n# Body\n",
    "fixture.md",
  );
  assertEquals(result.ok, false);
});

deno.test("frontmatter detects a second YAML document after comments", () => {
  const result = frontmatter.parseFrontmatter(
    '---\nname: "example"\n---\n# Body\n\n---\n\n# yaml comment\nother: value\n---\n',
    "fixture.md",
  );
  assertEquals(result.ok, false);
});

deno.test("frontmatter rejects second document marker variants", () => {
  for (const marker of ["--- # second", "---   "]) {
    const result = frontmatter.parseFrontmatter(
      `---\nname: "example"\n---\n# Body\n\n${marker}\nother:\n---\n`,
      "fixture.md",
    );
    assertEquals(result.ok, false);
  }
});

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
