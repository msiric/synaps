// src/workflow-rules.ts — W3-2: Technology-Aware Workflow Rule Templates
// Composes specific workflow rules from detected technology + discovered commands.

import type {
  WorkflowRule,
  WorkspaceCommand,
  CommandSet,
  ConfigAnalysis,
  DependencyInsights,
  Convention,
} from "./types.js";

interface WorkflowContext {
  workspaceCommands: WorkspaceCommand[];
  rootCommands?: CommandSet;
  packageCommands: { packageName: string; commands: CommandSet }[];
  configAnalysis?: ConfigAnalysis;
  allDependencyInsights: DependencyInsights[];
  allConventions: Convention[];
}

/**
 * Generate technology-specific workflow rules by matching detected technologies
 * to discovered commands.
 */
export function generateWorkflowRules(ctx: WorkflowContext): WorkflowRule[] {
  const rules: WorkflowRule[] = [];

  // Collect all frameworks and dependencies across packages
  const allFrameworks = new Set<string>();
  for (const di of ctx.allDependencyInsights) {
    for (const fw of di.frameworks) {
      allFrameworks.add(fw.name);
    }
    for (const rt of di.runtime) {
      allFrameworks.add(rt.name);
    }
  }

  // Index workspace commands by category and name
  const cmdsByCategory = new Map<string, WorkspaceCommand[]>();
  for (const cmd of ctx.workspaceCommands) {
    const list = cmdsByCategory.get(cmd.category) ?? [];
    list.push(cmd);
    cmdsByCategory.set(cmd.category, list);
  }

  const cmdByScript = new Map<string, WorkspaceCommand>();
  for (const cmd of ctx.workspaceCommands) {
    cmdByScript.set(cmd.scriptName, cmd);
  }

  // --- Drizzle ORM ---
  if (allFrameworks.has("drizzle-orm")) {
    const dbGenerate = findCmd(ctx.workspaceCommands, /^db[:\-]generate/);
    const dbMigrate = findCmd(ctx.workspaceCommands, /^db[:\-]migrate/);
    if (dbGenerate && dbMigrate) {
      rules.push({
        trigger: "After modifying database schema files",
        action: `Run \`${dbGenerate.run}\` to create a migration, then \`${dbMigrate.run}\` to apply it`,
        source: `Drizzle ORM detected + ${dbGenerate.scriptName}/${dbMigrate.scriptName} in ${dbGenerate.packagePath}`,
        impact: "high",
      });
    }
    const dbPush = findCmd(ctx.workspaceCommands, /^db[:\-]push/);
    if (dbPush) {
      rules.push({
        trigger: "For rapid prototyping (no migration file needed)",
        action: `Run \`${dbPush.run}\` to push schema changes directly`,
        source: `Drizzle ORM detected + ${dbPush.scriptName} in ${dbPush.packagePath}`,
        impact: "high",
      });
    }
  }

  // --- Prisma ---
  if (allFrameworks.has("prisma") || allFrameworks.has("@prisma/client")) {
    const prismaGenerate = findCmd(ctx.workspaceCommands, /^(prisma[:\-])?generate/);
    const prismaMigrate = findCmd(ctx.workspaceCommands, /^(prisma[:\-])?migrate/);
    if (prismaGenerate && prismaMigrate) {
      rules.push({
        trigger: "After modifying schema.prisma",
        action: `Run \`${prismaGenerate.run}\` then \`${prismaMigrate.run}\``,
        source: `Prisma detected + ${prismaGenerate.scriptName}/${prismaMigrate.scriptName}`,
        impact: "high",
      });
    }
  }

  // --- GraphQL codegen ---
  if (allFrameworks.has("graphql") || allFrameworks.has("@graphql-codegen/cli")) {
    const codegen = findCmd(ctx.workspaceCommands, /^(codegen|generate[:\-]?(interfaces|types)?)/);
    if (codegen) {
      rules.push({
        trigger: "After modifying .graphql files",
        action: `Run \`${codegen.run}\` to regenerate types`,
        source: `GraphQL detected + ${codegen.scriptName}`,
        impact: "high",
      });
    }
  }

  // --- Turbo monorepo ---
  if (ctx.configAnalysis?.buildTool?.name === "turbo") {
    const pm = ctx.rootCommands?.packageManager ?? "npm";
    rules.push({
      trigger: "For running build/test/lint tasks",
      action: `Use \`turbo run <task>\`, not \`${pm} run <script>\` — Turbo caches and parallelizes`,
      source: "Turbo detected in build tool config",
      impact: "high",
    });
  }

  // --- Biome (not ESLint/Prettier) ---
  if (ctx.configAnalysis?.linter?.name === "biome" || ctx.configAnalysis?.formatter?.name === "biome") {
    const lintCmd = findLintCommand(ctx);
    const cmdHint = lintCmd ? ` (\`${lintCmd}\`)` : "";
    rules.push({
      trigger: "For linting and formatting",
      action: `Use Biome${cmdHint}, NOT ESLint or Prettier — they are not configured`,
      source: "Biome detected in config analysis",
      impact: "high",
    });
  }

  // --- Test framework ---
  const testCmd = findTestCommand(ctx);
  if (testCmd) {
    rules.push({
      trigger: "After modifying source files",
      action: `Run \`${testCmd}\` to verify changes`,
      source: "Test framework detected",
      impact: "high",
    });
  }

  return rules;
}

function findCmd(commands: WorkspaceCommand[], pattern: RegExp): WorkspaceCommand | undefined {
  return commands.find((c) => pattern.test(c.scriptName));
}

function findLintCommand(ctx: WorkflowContext): string | undefined {
  if (ctx.rootCommands?.lint) return ctx.rootCommands.lint.run;
  for (const pc of ctx.packageCommands) {
    if (pc.commands.lint) return pc.commands.lint.run;
  }
  return undefined;
}

function findTestCommand(ctx: WorkflowContext): string | undefined {
  if (ctx.rootCommands?.test) return ctx.rootCommands.test.run;
  for (const pc of ctx.packageCommands) {
    if (pc.commands.test) return pc.commands.test.run;
  }
  return undefined;
}
