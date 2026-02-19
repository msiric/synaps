// src/detectors/database.ts — W2-3: Database/ORM Pattern Detector
// Detects Drizzle, Prisma, TypeORM, Sequelize, Knex from dependencies.

import type { Convention, ConventionDetector, DetectorContext } from "../types.js";
import { buildConfidence } from "../convention-extractor.js";

const ORM_MAP: Record<string, { name: string; description: string }> = {
  "drizzle-orm": { name: "Drizzle ORM", description: "Schema-as-code ORM with SQL-like query builder" },
  "prisma": { name: "Prisma", description: "Schema-first ORM with generated client" },
  "@prisma/client": { name: "Prisma", description: "Schema-first ORM with generated client" },
  "typeorm": { name: "TypeORM", description: "Decorator-based ORM with Active Record and Data Mapper patterns" },
  "sequelize": { name: "Sequelize", description: "Promise-based ORM for SQL databases" },
  "knex": { name: "Knex", description: "SQL query builder (not a full ORM)" },
  "kysely": { name: "Kysely", description: "Type-safe SQL query builder" },
  "mongoose": { name: "Mongoose", description: "MongoDB ODM with schema validation" },
};

export const databaseDetector: ConventionDetector = (files, _tiers, _warnings, context) => {
  if (!context?.dependencies) return [];

  const conventions: Convention[] = [];
  const frameworks = context.dependencies.frameworks?.map((f) => f.name) ?? [];
  const detected = new Set<string>();

  // Check dependency insights for ORM packages
  for (const fw of context.dependencies.frameworks ?? []) {
    const orm = ORM_MAP[fw.name];
    if (orm && !detected.has(orm.name)) {
      detected.add(orm.name);
      conventions.push({
        category: "ecosystem",
        source: "database",
        name: `${orm.name} database`,
        description: `Uses ${orm.name} (${fw.version}): ${orm.description}`,
        confidence: buildConfidence(1, 1),
        examples: [`${fw.name}@${fw.version}`],
      });
    }
  }

  // Also check import patterns in source files for ORMs not in dependency insights
  for (const [pkg, orm] of Object.entries(ORM_MAP)) {
    if (detected.has(orm.name)) continue;
    const importCount = files.filter((f) =>
      f.imports.some((i) => !i.isTypeOnly && (i.moduleSpecifier === pkg || i.moduleSpecifier.startsWith(pkg + "/"))),
    ).length;
    if (importCount > 0) {
      detected.add(orm.name);
      conventions.push({
        category: "ecosystem",
        source: "database",
        name: `${orm.name} database`,
        description: `Uses ${orm.name}: ${orm.description}`,
        confidence: buildConfidence(importCount, importCount),
        examples: [`${importCount} files import from ${pkg}`],
      });
    }
  }

  return conventions;
};
