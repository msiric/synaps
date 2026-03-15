// src/bin/setup-hooks.ts — Install PreToolUse/PostToolUse hooks for Claude Code
// Copies hook script to ~/.claude/hooks/autodocs/ and merges config into settings.json.
// Idempotent — safe to run multiple times.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export async function runSetupHooks(): Promise<void> {
  const claudeDir = join(homedir(), ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  // 1. Copy hook script to ~/.claude/hooks/autodocs/
  const hooksDir = join(claudeDir, "hooks", "autodocs");
  mkdirSync(hooksDir, { recursive: true });

  const hookSrc = resolve(import.meta.dirname, "..", "..", "hooks", "autodocs-hook.cjs");
  const hookDest = join(hooksDir, "autodocs-hook.cjs");

  if (!existsSync(hookSrc)) {
    process.stderr.write(`[autodocs] Hook script not found at ${hookSrc}\n`);
    process.stderr.write("[autodocs] Try reinstalling: npm install -g autodocs-engine\n");
    process.exit(1);
  }

  copyFileSync(hookSrc, hookDest);

  // 2. Merge hook config into settings.json
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      process.stderr.write(`[autodocs] Warning: Could not parse ${settingsPath}, creating new config\n`);
    }
  }

  if (!settings.hooks || typeof settings.hooks !== "object") {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown[]>;

  const hookCommand = `node "${hookDest}"`;

  ensureHookEntry(hooks, "PreToolUse", "Grep|Glob|Bash", hookCommand, "Enriching with autodocs context...");
  ensureHookEntry(hooks, "PostToolUse", "Bash", hookCommand, "Checking autodocs freshness...");

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  process.stderr.write("[autodocs] Hooks installed for Claude Code\n");
  process.stderr.write("  PreToolUse: search augmentation (Grep, Glob, Bash)\n");
  process.stderr.write("  PostToolUse: staleness detection (git mutations)\n");
  process.stderr.write(`  Hook script: ${hookDest}\n`);
  process.stderr.write(`  Settings: ${settingsPath}\n`);
}

function ensureHookEntry(
  hooks: Record<string, unknown[]>,
  event: string,
  matcher: string,
  command: string,
  statusMessage: string,
): void {
  if (!Array.isArray(hooks[event])) hooks[event] = [];

  // Idempotent: check if already registered
  const entries = hooks[event] as unknown[];
  const alreadyRegistered = entries.some((entry: any) =>
    entry?.hooks?.some((h: any) => h?.command?.includes("autodocs-hook")),
  );
  if (alreadyRegistered) return;

  entries.push({
    matcher,
    hooks: [{ type: "command" as const, command, timeout: 10, statusMessage }],
  });
}
