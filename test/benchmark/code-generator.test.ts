import { describe, it, expect } from "vitest";
import { parseCodeBlocks } from "../../src/benchmark/code-generator.js";

describe("parseCodeBlocks", () => {
  it("parses standard filepath code blocks", () => {
    const response = [
      "Here's the implementation:",
      "",
      "```src/detectors/import-style.ts",
      "export function importStyleDetector() {",
      "  return [];",
      "}",
      "```",
      "",
      "And the test:",
      "",
      "```src/detectors/import-style.test.ts",
      "import { importStyleDetector } from './import-style';",
      "test('works', () => expect(importStyleDetector()).toEqual([]));",
      "```",
    ].join("\n");

    const files = parseCodeBlocks(response);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/detectors/import-style.ts");
    expect(files[0].content).toContain("importStyleDetector");
    expect(files[1].path).toBe("src/detectors/import-style.test.ts");
  });

  it("parses language tag + filepath format", () => {
    const response = [
      "```typescript src/utils/helper.ts",
      "export const helper = () => {};",
      "```",
    ].join("\n");

    const files = parseCodeBlocks(response);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/utils/helper.ts");
  });

  it("parses filepath in comment on first line", () => {
    const response = [
      "```ts",
      "// filepath: src/detectors/new-detector.ts",
      "export function newDetector() {}",
      "```",
    ].join("\n");

    const files = parseCodeBlocks(response);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/detectors/new-detector.ts");
  });

  it("normalizes paths (strips ./ prefix, converts backslash)", () => {
    const response = [
      "```./src\\utils\\helper.ts",
      "export const x = 1;",
      "```",
    ].join("\n");

    const files = parseCodeBlocks(response);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/utils/helper.ts");
  });

  it("skips blocks without recognizable filepath", () => {
    const response = [
      "```typescript",
      "const x = 1;",
      "```",
      "",
      "```",
      "plain text",
      "```",
    ].join("\n");

    const files = parseCodeBlocks(response);
    expect(files).toHaveLength(0);
  });

  it("returns empty for no code blocks", () => {
    const files = parseCodeBlocks("Just some text with no code blocks.");
    expect(files).toHaveLength(0);
  });

  it("handles multiple files in single response", () => {
    const response = [
      "```src/a.ts",
      "export const a = 1;",
      "```",
      "```src/b.ts",
      "export const b = 2;",
      "```",
      "```src/c.ts",
      "export const c = 3;",
      "```",
    ].join("\n");

    const files = parseCodeBlocks(response);
    expect(files).toHaveLength(3);
    expect(files.map(f => f.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });
});
