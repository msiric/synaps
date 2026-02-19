// src/detectors/web-framework.ts — W2-3: Web Framework Pattern Detector
// Detects Express, Fastify, Hono, Koa, NestJS from dependencies.

import type { Convention, ConventionDetector, DetectorContext } from "../types.js";
import { buildConfidence } from "../convention-extractor.js";

const FRAMEWORK_MAP: Record<string, { name: string; middleware: string; router: string }> = {
  express: { name: "Express", middleware: "app.use() middleware chain", router: "express.Router()" },
  fastify: { name: "Fastify", middleware: "plugin system with decorators", router: "route shorthand methods" },
  hono: { name: "Hono", middleware: "app.use() with Context", router: "tree-based routing with multiple router implementations" },
  koa: { name: "Koa", middleware: "async middleware cascade", router: "@koa/router or koa-router" },
  "@nestjs/core": { name: "NestJS", middleware: "decorator-based modules", router: "controller decorators (@Get, @Post)" },
  "@hapi/hapi": { name: "Hapi", middleware: "server.ext() extension points", router: "server.route() configuration" },
};

export const webFrameworkDetector: ConventionDetector = (files, _tiers, _warnings, context) => {
  if (!context?.dependencies) return [];

  const conventions: Convention[] = [];
  const detected = new Set<string>();

  // Check dependency insights
  for (const fw of context.dependencies.frameworks ?? []) {
    const framework = FRAMEWORK_MAP[fw.name];
    if (framework && !detected.has(framework.name)) {
      detected.add(framework.name);
      conventions.push({
        category: "ecosystem",
        name: `${framework.name} web framework`,
        description: `Uses ${framework.name} (${fw.version}). Middleware: ${framework.middleware}. Routes: ${framework.router}.`,
        confidence: buildConfidence(1, 1),
        examples: [`${fw.name}@${fw.version}`],
      });
    }
  }

  // Fallback: check import patterns
  for (const [pkg, framework] of Object.entries(FRAMEWORK_MAP)) {
    if (detected.has(framework.name)) continue;
    const importCount = files.filter((f) =>
      f.imports.some((i) => i.moduleSpecifier === pkg || i.moduleSpecifier.startsWith(pkg + "/")),
    ).length;
    if (importCount > 0) {
      detected.add(framework.name);
      conventions.push({
        category: "ecosystem",
        name: `${framework.name} web framework`,
        description: `Uses ${framework.name}. Middleware: ${framework.middleware}. Routes: ${framework.router}.`,
        confidence: buildConfidence(importCount, importCount),
        examples: [`${importCount} files import from ${pkg}`],
      });
    }
  }

  return conventions;
};
