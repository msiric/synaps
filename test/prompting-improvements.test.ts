// test/prompting-improvements.test.ts — Tests for LLM grounding improvements
// Validates: temperature, XML tags, grounding rules, fill-in-the-blank,
// few-shot example, word counts, whitelist validator, length validation.

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { validateOutput } from "../src/output-validator.js";
import {
  agentsMdSingleTemplate,
  agentsMdMultiRootTemplate,
  agentsMdPackageDetailTemplate,
  agentsMdMultiTemplate,
} from "../src/templates/agents-md.js";
import type { PackageAnalysis, StructuredAnalysis } from "../src/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePackageAnalysis(overrides: Partial<PackageAnalysis> = {}): PackageAnalysis {
  return {
    name: "test-pkg",
    version: "1.0.0",
    description: "test package",
    relativePath: ".",
    files: {
      total: 10,
      byTier: {
        tier1: { count: 3, lines: 100, files: [] },
        tier2: { count: 5, lines: 200, files: [] },
        tier3: { count: 2, lines: 50 },
      },
      byExtension: { ".ts": 10 },
    },
    publicAPI: [
      { name: "useData", kind: "hook", sourceFile: "src/use-data.ts", isTypeOnly: false, importCount: 5 },
    ],
    conventions: [],
    commands: {
      packageManager: "npm",
      build: { run: "tsc", source: "package.json" },
      test: { run: "vitest run", source: "package.json" },
      lint: { run: "biome check .", source: "package.json" },
      other: [],
    },
    architecture: {
      entryPoint: "src/index.ts",
      directories: [],
      packageType: "library",
      hasJSX: false,
    },
    dependencies: {
      internal: [],
      external: [
        { name: "typescript", importCount: 0 },
      ],
      totalUniqueDependencies: 1,
    },
    role: { summary: "test utility", purpose: "testing", whenToUse: "when testing", inferredFrom: [] },
    antiPatterns: [],
    contributionPatterns: [],
    dependencyInsights: {
      runtime: [{ name: "node", version: "22.0.0" }],
      frameworks: [],
      testFramework: { name: "vitest", version: "3.0.0" },
    },
    configAnalysis: {
      linter: { name: "biome", configFile: "biome.json" },
    },
    ...overrides,
  };
}

function makeStructuredAnalysis(overrides: Partial<PackageAnalysis> = {}): StructuredAnalysis {
  return {
    meta: {
      engineVersion: "0.3.0",
      analyzedAt: new Date().toISOString(),
      rootDir: ".",
      config: {} as any,
      timingMs: 100,
    },
    packages: [makePackageAnalysis(overrides)],
    warnings: [],
  };
}

function makeLongOutput(base: string, words: number): string {
  const filler = Array(Math.ceil(words / 12))
    .fill("This is actionable content for AI tools to follow.")
    .join("\n");
  return `${base}\n\n${filler}`;
}

// ─── 1: Temperature ─────────────────────────────────────────────────────────

describe("Change 1: Temperature = 0", () => {
  it("client.ts includes temperature in API call", async () => {
    const clientSource = await import("node:fs").then((fs) =>
      fs.readFileSync(resolve(__dirname, "../src/llm/client.ts"), "utf-8"),
    );
    expect(clientSource).toContain("temperature: 0");
  });
});

// ─── 2: XML Tag Restructuring ───────────────────────────────────────────────

describe("Change 2: XML tag restructuring", () => {
  it("adapter.ts wraps user prompt in XML tags", async () => {
    const adapterSource = await import("node:fs").then((fs) =>
      fs.readFileSync(resolve(__dirname, "../src/llm/adapter.ts"), "utf-8"),
    );
    expect(adapterSource).toContain("<instructions>");
    expect(adapterSource).toContain("</instructions>");
    expect(adapterSource).toContain("<analysis>");
    expect(adapterSource).toContain("</analysis>");
    expect(adapterSource).toContain("Use ONLY data from the <analysis> section");
  });

  it("hierarchical.ts wraps prompts in XML tags", async () => {
    const hierarchicalSource = await import("node:fs").then((fs) =>
      fs.readFileSync(resolve(__dirname, "../src/llm/hierarchical.ts"), "utf-8"),
    );
    expect(hierarchicalSource).toContain("<instructions>");
    expect(hierarchicalSource).toContain("<analysis>");
    expect(hierarchicalSource).toContain("Use ONLY data from the <analysis> section");
  });
});

// ─── 3: Grounding Rules ─────────────────────────────────────────────────────

describe("Change 3: Grounding rules in system prompts", () => {
  it("all templates contain grounding rules", () => {
    for (const template of [
      agentsMdSingleTemplate,
      agentsMdMultiRootTemplate,
      agentsMdPackageDetailTemplate,
      agentsMdMultiTemplate,
    ]) {
      expect(template.systemPrompt).toContain("GROUNDING RULES");
      expect(template.systemPrompt).toContain("DATA FORMATTER");
      expect(template.systemPrompt).toContain("NEVER add technologies");
      expect(template.systemPrompt).toContain("NEVER infer a technology");
    }
  });

  it("grounding rules mention <analysis> tag", () => {
    expect(agentsMdSingleTemplate.systemPrompt).toContain("<analysis>");
  });
});

// ─── 4: Fill-in-the-Blank Template ──────────────────────────────────────────

describe("Change 4: Fill-in-the-blank template", () => {
  it("single template uses {INSERT:} directives", () => {
    const fi = agentsMdSingleTemplate.formatInstructions;
    expect(fi).toContain("{INSERT:");
    expect(fi).toContain("analysis.packages[0].name");
    expect(fi).toContain("analysis.packages[0].dependencyInsights");
    expect(fi).toContain("analysis.packages[0].commands");
  });

  it("multi-root template uses {INSERT:} directives", () => {
    const fi = agentsMdMultiRootTemplate.formatInstructions;
    expect(fi).toContain("{INSERT:");
    expect(fi).toContain("analysis.crossPackage");
  });

  it("package detail template uses {INSERT:} directives", () => {
    const fi = agentsMdPackageDetailTemplate.formatInstructions;
    expect(fi).toContain("{INSERT:");
    expect(fi).toContain("analysis.publicAPI");
    expect(fi).toContain("analysis.contributionPatterns");
  });

  it("references <analysis> data section in instructions", () => {
    expect(agentsMdSingleTemplate.formatInstructions).toContain("from the <analysis> data");
  });
});

// ─── 5: Few-Shot Example ────────────────────────────────────────────────────

describe("Change 5: Few-shot grounding example", () => {
  it("single template includes example_input and example_output", () => {
    const fi = agentsMdSingleTemplate.formatInstructions;
    expect(fi).toContain("<example_input>");
    expect(fi).toContain("</example_input>");
    expect(fi).toContain("<example_output>");
    expect(fi).toContain("</example_output>");
  });

  it("example demonstrates Fastify → only Fastify in output", () => {
    const fi = agentsMdSingleTemplate.formatInstructions;
    expect(fi).toContain("fastify");
    expect(fi).toContain("NOTICE:");
    expect(fi).toContain("does NOT mention Express");
  });
});

// ─── 6: Word Count Enforcement ──────────────────────────────────────────────

describe("Change 6: Word count instead of line count", () => {
  it("single template uses word count", () => {
    expect(agentsMdSingleTemplate.systemPrompt).toContain("900 words");
    expect(agentsMdSingleTemplate.formatInstructions).toContain("900 words");
  });

  it("multi-root template uses word count", () => {
    expect(agentsMdMultiRootTemplate.systemPrompt).toContain("800 words");
    expect(agentsMdMultiRootTemplate.formatInstructions).toContain("800 words");
  });

  it("package detail template uses word count", () => {
    expect(agentsMdPackageDetailTemplate.systemPrompt).toContain("1200 words");
    expect(agentsMdPackageDetailTemplate.formatInstructions).toContain("1200 words");
  });

  it("multi template uses word count", () => {
    expect(agentsMdMultiTemplate.systemPrompt).toContain("1000 words");
    expect(agentsMdMultiTemplate.formatInstructions).toContain("1000 words");
  });
});

// ─── 7: Whitelist-Based Technology Validator ────────────────────────────────

describe("Change 7: Whitelist technology validator", () => {
  it("flags React when not in analysis", () => {
    const analysis = makeStructuredAnalysis();
    const output = makeLongOutput("# Test Package\n\nReact hooks for data fetching.", 400);
    const result = validateOutput(output, analysis, "root");

    const techIssue = result.issues.find(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes("react"),
    );
    expect(techIssue).toBeDefined();
  });

  it("does NOT flag React when react is in frameworks", () => {
    const analysis = makeStructuredAnalysis({
      dependencyInsights: {
        runtime: [{ name: "node", version: "22.0.0" }],
        frameworks: [{ name: "react", version: "19.0.0" }],
        testFramework: { name: "vitest", version: "3.0.0" },
      },
    });
    const output = makeLongOutput("# Test Package\n\nReact components for UI.", 400);
    const result = validateOutput(output, analysis, "root");

    const reactIssues = result.issues.filter(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes("react"),
    );
    expect(reactIssues.length).toBe(0);
  });

  it("flags Bun when not in analysis (standalone, not bundle)", () => {
    const analysis = makeStructuredAnalysis({
      dependencyInsights: {
        runtime: [{ name: "node", version: "22.0.0" }],
        frameworks: [],
        testFramework: { name: "vitest", version: "3.0.0" },
      },
    });
    const output = makeLongOutput("# Test Package\n\nRun with Bun for speed.", 400);
    const result = validateOutput(output, analysis, "root");

    const bunIssue = result.issues.find(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes("bun"),
    );
    expect(bunIssue).toBeDefined();
  });

  it("does NOT flag bundle/bundler as Bun", () => {
    const analysis = makeStructuredAnalysis();
    const output = makeLongOutput("# Test Package\n\nUses esbuild as bundler.", 400);
    const result = validateOutput(output, analysis, "root");

    const bunIssues = result.issues.filter(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes('"bun"'),
    );
    expect(bunIssues.length).toBe(0);
  });

  it("flags Jest when Vitest is the test framework", () => {
    const analysis = makeStructuredAnalysis();
    const output = makeLongOutput("# Test Package\n\nUse jest.mock for testing.", 400);
    const result = validateOutput(output, analysis, "root");

    const jestIssue = result.issues.find(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes("jest"),
    );
    expect(jestIssue).toBeDefined();
  });

  it("does NOT flag Vitest when it is the test framework", () => {
    const analysis = makeStructuredAnalysis();
    const output = makeLongOutput("# Test Package\n\nUse vitest for all tests.", 400);
    const result = validateOutput(output, analysis, "root");

    const vitestIssues = result.issues.filter(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes("vitest"),
    );
    expect(vitestIssues.length).toBe(0);
  });

  it("allows technologies from config tools", () => {
    const analysis = makeStructuredAnalysis();
    const output = makeLongOutput("# Test Package\n\nUse Biome for linting.", 400);
    const result = validateOutput(output, analysis, "root");

    const biomeIssues = result.issues.filter(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes("biome"),
    );
    expect(biomeIssues.length).toBe(0);
  });

  it("allows GraphQL when @apollo/client is in dependencies", () => {
    const analysis = makeStructuredAnalysis({
      dependencies: {
        internal: [],
        external: [{ name: "@apollo/client", importCount: 5 }],
        totalUniqueDependencies: 1,
      },
    });
    const output = makeLongOutput("# Test Package\n\nGraphQL queries via Apollo.", 400);
    const result = validateOutput(output, analysis, "root");

    const graphqlIssues = result.issues.filter(
      (i) => i.type === "hallucinated_technology" && i.message.toLowerCase().includes("graphql"),
    );
    expect(graphqlIssues.length).toBe(0);
  });
});

// ─── 8: Minimum Length Validation ───────────────────────────────────────────

describe("Change 8: Minimum length validation", () => {
  it("flags output under minimum word count for root format", () => {
    const analysis = makeStructuredAnalysis();
    const output = "# Short\n\nToo short.";
    const result = validateOutput(output, analysis, "root");

    const lengthIssue = result.issues.find((i) => i.type === "under_minimum_length");
    expect(lengthIssue).toBeDefined();
    expect(lengthIssue!.severity).toBe("error");
  });

  it("flags output under minimum word count for package-detail format", () => {
    const analysis = makePackageAnalysis();
    const output = "# Short\n\nToo short.";
    const result = validateOutput(output, analysis, "package-detail");

    const lengthIssue = result.issues.find((i) => i.type === "under_minimum_length");
    expect(lengthIssue).toBeDefined();
  });

  it("does NOT flag output meeting minimum word count", () => {
    const analysis = makeStructuredAnalysis();
    const output = makeLongOutput("# Test Package\n\nGood content here.", 400);
    const result = validateOutput(output, analysis, "root");

    const lengthIssues = result.issues.filter((i) => i.type === "under_minimum_length");
    expect(lengthIssues.length).toBe(0);
  });

  it("triggers correction prompt on too-short output", () => {
    const analysis = makeStructuredAnalysis();
    const output = "# Short\n\nNot enough content.";
    const result = validateOutput(output, analysis, "root");

    expect(result.isValid).toBe(false);
    expect(result.correctionPrompt).toBeDefined();
    expect(result.correctionPrompt).toContain("under_minimum_length");
  });
});
