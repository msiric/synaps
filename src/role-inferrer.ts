// src/role-inferrer.ts — Enhancement 1: Package Role Inference
// Produces a natural-language role description and "when to use" hint for each package.
// W3-3: Added HTTP framework / app framework detection for api-server and web-application types.

import type { PackageAnalysis, PackageRole } from "./types.js";

// Domain signals detected from export names
const DOMAIN_SIGNALS: { pattern: RegExp; label: string; actionLabel: string }[] = [
  { pattern: /create|add|insert/i, label: "CRUD operations", actionLabel: "adding create/add operations" },
  { pattern: /update|edit|modify|patch/i, label: "CRUD operations", actionLabel: "modifying update/edit operations" },
  { pattern: /delete|remove|destroy/i, label: "CRUD operations", actionLabel: "adding delete/remove operations" },
  { pattern: /fetch|query|subscription|get(?=[A-Z])/i, label: "data fetching", actionLabel: "adding data fetching or queries" },
  { pattern: /permission|access|auth|role/i, label: "permissions/authorization", actionLabel: "modifying permissions or access control" },
  { pattern: /telemetry|scenario|logging|track/i, label: "telemetry/observability", actionLabel: "adding telemetry or logging" },
  { pattern: /render|view|display|layout/i, label: "UI rendering", actionLabel: "modifying UI rendering or layout" },
  { pattern: /command|action|handler|dispatch/i, label: "commands/actions", actionLabel: "adding new commands or actions" },
  { pattern: /event|emit|subscribe|listen/i, label: "event handling", actionLabel: "adding event handlers or subscriptions" },
  { pattern: /modal|dialog|popup|overlay/i, label: "modals/dialogs", actionLabel: "adding modals or dialogs" },
  { pattern: /parse|transform|convert|serialize/i, label: "data transformation", actionLabel: "adding data parsing or transformation" },
  { pattern: /validate|check|assert|verify/i, label: "validation", actionLabel: "adding validation logic" },
  { pattern: /config|setting|option|preference/i, label: "configuration", actionLabel: "modifying configuration or settings" },
  { pattern: /route|navigate|redirect|path/i, label: "routing/navigation", actionLabel: "modifying routes or navigation" },
  { pattern: /cache|store|persist|save/i, label: "caching/storage", actionLabel: "modifying caching or storage logic" },
];

// Technology signals from dependencies
const TECH_SIGNALS: { deps: string[]; label: string }[] = [
  { deps: ["react", "react-dom"], label: "React-based" },
  { deps: ["@apollo/client", "apollo-client", "graphql", "@graphql-typed-document-node/core"], label: "GraphQL data layer" },
  { deps: ["express", "fastify", "hono", "koa", "nest"], label: "HTTP server" },
  { deps: ["commander", "yargs", "mri", "cac", "meow", "clipanion"], label: "CLI tool" },
  { deps: ["zustand", "redux", "mobx", "jotai", "recoil"], label: "state management" },
  { deps: ["webpack", "rollup", "esbuild", "vite", "rspack"], label: "build tooling" },
  { deps: ["jest", "vitest", "mocha", "ava"], label: "testing framework" },
];

// W3-3: HTTP framework and app framework signals for role classification
const HTTP_FRAMEWORKS = ["hono", "express", "fastify", "koa", "nest", "@hono/node-server", "@hono/bun"];
const APP_FRAMEWORKS = ["next", "nuxt", "remix", "astro", "svelte", "@sveltejs/kit"];

/**
 * Infer the role of a package from its analysis data.
 */
export function inferRole(analysis: Omit<PackageAnalysis, "role" | "antiPatterns" | "contributionPatterns">): PackageRole {
  const evidence: string[] = [];
  const domainSignals = new Set<string>();
  const actionSignals = new Set<string>();

  // 1. Start with package type
  let baseType = analysis.architecture.packageType;
  evidence.push(`packageType: ${baseType}`);

  // 2. Analyze export names for domain signals
  const nonTypeExports = analysis.publicAPI.filter((e) => !e.isTypeOnly);
  const exportNames = nonTypeExports.map((e) => e.name);

  for (const signal of DOMAIN_SIGNALS) {
    const matches = exportNames.filter((name) => signal.pattern.test(name));
    if (matches.length >= 1) {
      domainSignals.add(signal.label);
      actionSignals.add(signal.actionLabel);
      if (matches.length >= 3) {
        evidence.push(`exports ${matches.length} symbols matching "${signal.label}"`);
      }
    }
  }

  // Count exports by kind
  const hookCount = nonTypeExports.filter((e) => e.kind === "hook").length;
  const componentCount = nonTypeExports.filter((e) => e.kind === "component").length;
  const functionCount = nonTypeExports.filter((e) => e.kind === "function").length;
  const classCount = nonTypeExports.filter((e) => e.kind === "class").length;

  if (hookCount > 0) evidence.push(`exports ${hookCount} hooks`);
  if (componentCount > 0) evidence.push(`exports ${componentCount} components`);
  if (functionCount > 0) evidence.push(`exports ${functionCount} functions`);
  if (classCount > 0) evidence.push(`exports ${classCount} classes`);

  // 3. Analyze dependencies for technology signals
  const techSignals = new Set<string>();
  const allDepNames = [
    ...analysis.dependencies.internal,
    ...analysis.dependencies.external.map((d) => d.name),
  ];

  for (const signal of TECH_SIGNALS) {
    if (signal.deps.some((dep) => allDepNames.some((d) => d === dep || d.startsWith(dep + "/")))) {
      techSignals.add(signal.label);
      evidence.push(`depends on ${signal.label}`);
    }
  }

  // W3-3: Override classification for HTTP servers and web applications
  // Check dependency insights (more reliable) then fall back to raw dependency names
  const frameworkNames = analysis.dependencyInsights?.frameworks.map((f) => f.name) ?? [];
  const allDepsForClassification = [...allDepNames, ...frameworkNames];

  const hasHttpFramework = HTTP_FRAMEWORKS.some((fw) =>
    allDepsForClassification.some((d) => d === fw || d.startsWith(fw + "/")),
  );
  const hasAppFramework = APP_FRAMEWORKS.some((fw) =>
    allDepsForClassification.some((d) => d === fw || d.startsWith(fw + "/")),
  );

  if (hasAppFramework && (baseType === "library" || baseType === "unknown" || baseType === "mixed")) {
    baseType = "web-application";
    evidence.push("app framework detected (Next.js/Nuxt/Remix/Astro/SvelteKit)");
  } else if (hasHttpFramework && (baseType === "library" || baseType === "unknown" || baseType === "mixed" || baseType === "server")) {
    baseType = "api-server";
    evidence.push("HTTP framework detected (Hono/Express/Fastify/Koa/Nest)");
  }

  // 4. Compose summary
  const typeLabel = formatPackageType(baseType);
  const domainParts = [...domainSignals].slice(0, 4);
  const summary = domainParts.length > 0
    ? `${typeLabel} — ${domainParts.join(", ")}`
    : typeLabel;

  // 5. Compose purpose
  const purposeParts: string[] = [];
  if (domainSignals.size > 0) {
    purposeParts.push(...domainParts);
  }
  if (techSignals.size > 0) {
    purposeParts.push(...[...techSignals].slice(0, 2));
  }
  const purpose = purposeParts.length > 0
    ? capitalizeFirst(purposeParts.join(", "))
    : analysis.description || `${typeLabel} package`;

  // 6. Compose whenToUse — W3-3: specific guidance for api-server and web-application
  let whenToUse: string;
  const actionParts = [...actionSignals].slice(0, 3);
  if (baseType === "api-server") {
    whenToUse = actionParts.length > 0
      ? `Touch this package when adding API endpoints, routes, middleware, or ${actionParts.join(", or ")}`
      : "Touch this package when adding API endpoints, routes, or middleware";
  } else if (baseType === "web-application") {
    whenToUse = actionParts.length > 0
      ? `Touch this package when adding pages, components, client-side features, or ${actionParts.join(", or ")}`
      : "Touch this package when adding pages, components, or client-side features";
  } else if (actionParts.length > 0) {
    whenToUse = `Touch this package when ${actionParts.join(", or ")}`;
  } else {
    whenToUse = `Touch this package when working on ${typeLabel.toLowerCase()} functionality`;
  }

  return {
    summary,
    purpose,
    whenToUse,
    inferredFrom: evidence,
  };
}

function formatPackageType(type: string): string {
  switch (type) {
    case "react-components": return "React components";
    case "hooks": return "Hooks library";
    case "library": return "Utility library";
    case "cli": return "CLI tool";
    case "server": return "Server application";
    case "web-application": return "Web application";
    case "api-server": return "API server";
    case "mixed": return "Mixed package";
    default: return "Package";
  }
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
