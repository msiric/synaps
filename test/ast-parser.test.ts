import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFile } from "../src/ast-parser.js";
import { FileNotFoundError } from "../src/types.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

describe("parseFile", () => {
  describe("export extraction", () => {
    it("extracts named export function", () => {
      const pf = parseFile(resolve(FIXTURES, "minimal-pkg/src/greet.ts"), resolve(FIXTURES, "minimal-pkg"));
      expect(pf.exports).toHaveLength(1);
      expect(pf.exports[0].name).toBe("greet");
      expect(pf.exports[0].kind).toBe("function");
      expect(pf.exports[0].isReExport).toBe(false);
      expect(pf.exports[0].signature).toContain("name: string");
    });

    it("extracts re-exports from barrel", () => {
      const pf = parseFile(resolve(FIXTURES, "minimal-pkg/index.ts"), resolve(FIXTURES, "minimal-pkg"));
      expect(pf.exports).toHaveLength(1);
      expect(pf.exports[0].name).toBe("greet");
      expect(pf.exports[0].isReExport).toBe(true);
      expect(pf.exports[0].reExportSource).toBe("./src/greet.js");
    });

    it("extracts named and type re-exports", () => {
      const pf = parseFile(resolve(FIXTURES, "hooks-pkg/index.ts"), resolve(FIXTURES, "hooks-pkg"));
      const names = pf.exports.map((e) => e.name);
      expect(names).toContain("useCounter");
      expect(names).toContain("useToggle");
      expect(names).toContain("useLocalStorage");
      expect(names).toContain("CounterOptions");
      expect(names).toContain("*"); // star re-export from use-fetch

      const typeExport = pf.exports.find((e) => e.name === "CounterOptions");
      expect(typeExport?.isTypeOnly).toBe(true);
    });

    it("extracts hook kind from arrow function name", () => {
      const pf = parseFile(resolve(FIXTURES, "hooks-pkg/src/hooks/use-counter.ts"), resolve(FIXTURES, "hooks-pkg"));
      const hookExport = pf.exports.find((e) => e.name === "useCounter");
      expect(hookExport?.kind).toBe("hook");
      expect(hookExport?.signature).toBeDefined();
    });

    it("extracts interface export", () => {
      const pf = parseFile(resolve(FIXTURES, "hooks-pkg/src/hooks/use-counter.ts"), resolve(FIXTURES, "hooks-pkg"));
      const iface = pf.exports.find((e) => e.name === "CounterOptions");
      expect(iface?.kind).toBe("interface");
      expect(iface?.isTypeOnly).toBe(true);
    });

    it("extracts JSDoc comment", () => {
      const pf = parseFile(resolve(FIXTURES, "minimal-pkg/src/greet.ts"), resolve(FIXTURES, "minimal-pkg"));
      expect(pf.exports[0].jsDocComment).toContain("Greets a person");
    });
  });

  describe("import extraction", () => {
    it("extracts static imports", () => {
      const pf = parseFile(resolve(FIXTURES, "hooks-pkg/src/hooks/use-counter.ts"), resolve(FIXTURES, "hooks-pkg"));
      const reactImport = pf.imports.find((i) => i.moduleSpecifier === "react");
      expect(reactImport).toBeDefined();
      expect(reactImport?.importedNames).toContain("useState");
      expect(reactImport?.importedNames).toContain("useCallback");
      expect(reactImport?.importedNames).toContain("useMemo");
    });
  });

  describe("file classification", () => {
    it("detects test files by .test.ts extension", () => {
      const pf = parseFile(
        resolve(FIXTURES, "hooks-pkg/src/hooks/use-counter.test.ts"),
        resolve(FIXTURES, "hooks-pkg"),
      );
      expect(pf.isTestFile).toBe(true);
    });

    it("detects generated files by content markers", () => {
      const pf = parseFile(
        resolve(FIXTURES, "hooks-pkg/src/graphql/get-data.generated.ts"),
        resolve(FIXTURES, "hooks-pkg"),
      );
      expect(pf.isGeneratedFile).toBe(true);
    });

    it("does not flag normal files as generated", () => {
      const pf = parseFile(resolve(FIXTURES, "hooks-pkg/src/hooks/use-counter.ts"), resolve(FIXTURES, "hooks-pkg"));
      expect(pf.isGeneratedFile).toBe(false);
      expect(pf.isTestFile).toBe(false);
    });
  });

  describe("content signals (E-17: hybrid AST/regex)", () => {
    it("counts React hooks via AST", () => {
      const pf = parseFile(resolve(FIXTURES, "hooks-pkg/src/hooks/use-counter.ts"), resolve(FIXTURES, "hooks-pkg"));
      expect(pf.contentSignals.useStateCount).toBe(1);
      expect(pf.contentSignals.useCallbackCount).toBe(3);
      expect(pf.contentSignals.useMemoCount).toBe(1);
    });

    it("counts jest.mock via regex", () => {
      const pf = parseFile(
        resolve(FIXTURES, "hooks-pkg/src/hooks/use-counter.test.ts"),
        resolve(FIXTURES, "hooks-pkg"),
      );
      expect(pf.contentSignals.jestMockCount).toBe(1);
    });

    it("counts try-catch via AST", () => {
      const pf = parseFile(
        resolve(FIXTURES, "hooks-pkg/src/hooks/use-local-storage.ts"),
        resolve(FIXTURES, "hooks-pkg"),
      );
      // useLocalStorage has try-catch blocks
      expect(pf.contentSignals.tryCatchCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("CJS detection (E-18)", () => {
    it("detects CommonJS patterns", () => {
      const pf = parseFile(resolve(FIXTURES, "cjs-pkg/index.js"), resolve(FIXTURES, "cjs-pkg"));
      expect(pf.hasCJS).toBe(true);
      // Should have mapped module.exports = { foo } and exports.helper
      const exportNames = pf.exports.map((e) => e.name);
      expect(exportNames).toContain("foo"); // module.exports = { foo }
      expect(exportNames).toContain("helper"); // exports.helper
    });

    it("detects require() as import with binding name", () => {
      const pf = parseFile(resolve(FIXTURES, "cjs-pkg/index.js"), resolve(FIXTURES, "cjs-pkg"));
      const barImport = pf.imports.find((i) => i.moduleSpecifier === "./bar");
      expect(barImport).toBeDefined();
      // const bar = require("./bar") → importedNames should include "bar"
      expect(barImport!.importedNames).toContain("bar");
    });

    it("does not flag ESM files as CJS", () => {
      const pf = parseFile(resolve(FIXTURES, "minimal-pkg/src/greet.ts"), resolve(FIXTURES, "minimal-pkg"));
      expect(pf.hasCJS).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws FileNotFoundError for missing files", () => {
      expect(() =>
        parseFile(resolve(FIXTURES, "minimal-pkg/nonexistent.ts"), resolve(FIXTURES, "minimal-pkg")),
      ).toThrow(FileNotFoundError);
    });
  });
});
