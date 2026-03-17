// src/bin/visualize.ts — CLI entry point for visual report generation
// Usage: synaps visualize [path] [--open]

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyze } from "../index.js";
import { generateReport } from "../visualizer.js";

export async function runVisualize(args: { path?: string; open?: boolean; verbose?: boolean }): Promise<void> {
  const projectPath = resolve(args.path ?? ".");
  const outPath = resolve("synaps-report.html");

  process.stderr.write(`[synaps] Analyzing ${projectPath}...\n`);
  const analysis = await analyze({ packages: [projectPath] });

  process.stderr.write("[synaps] Generating visual report...\n");
  const html = generateReport(analysis);

  writeFileSync(outPath, html);
  process.stderr.write(`[synaps] Report written to ${outPath}\n`);

  // Auto-open in browser if requested
  if (args.open !== false) {
    try {
      const { execFileSync } = await import("node:child_process");
      const platform = process.platform;
      const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
      execFileSync(cmd, [outPath], { stdio: "ignore", timeout: 5000 });
    } catch {
      // Silently skip if browser can't be opened (CI, SSH, etc.)
    }
  }
}
