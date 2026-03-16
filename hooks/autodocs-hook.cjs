// hooks/autodocs-hook.cjs — PreToolUse/PostToolUse handler for Claude Code
// Reads cached analysis from ~/.autodocs/cache/ and augments search results
// with callers, co-change partners, and execution flows.
//
// Design principles:
// - Silent on any error (never break the original tool)
// - <100ms response time (reads pre-computed JSON snapshot)
// - No analysis in hook process (MCP server writes the snapshot)
// - CommonJS for broad Node.js compatibility

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// ─── Dispatch ──────────────────────────────────────────────────────────────

const handlers = {
  PreToolUse: handlePreToolUse,
  PostToolUse: handlePostToolUse,
};

function main() {
  try {
    const input = JSON.parse(fs.readFileSync("/dev/stdin", "utf-8"));
    const handler = handlers[input.hook_event_name];
    if (handler) handler(input);
  } catch {
    // Silent — never break the original tool
    if (process.env.AUTODOCS_DEBUG) {
      process.stderr.write("[autodocs-hook] Error in main dispatch\n");
    }
  }
}

// ─── PreToolUse: Augment searches with graph context ───────────────────────

function handlePreToolUse(input) {
  const pattern = extractPattern(input.tool_name, input.tool_input);
  if (!pattern || pattern.length < 3) return;

  const cwd = input.cwd;
  if (!cwd || !path.isAbsolute(cwd)) return;

  const snapshot = loadSnapshot(cwd);
  if (!snapshot) return;

  const context = augment(snapshot, pattern);
  if (!context) return;

  emit("PreToolUse", context);
}

// ─── PostToolUse: Detect index staleness after git mutations ───────────────

const GIT_MUTATION_RE = /\bgit\s+(commit|merge|rebase|cherry-pick|pull)(\s|$)/;

function handlePostToolUse(input) {
  if (input.tool_name !== "Bash") return;

  const cmd = input.tool_input?.command || "";
  if (!GIT_MUTATION_RE.test(cmd)) return;
  if (input.tool_output?.exit_code !== 0) return;

  const cwd = input.cwd;
  if (!cwd || !path.isAbsolute(cwd)) return;

  const snapshot = loadSnapshot(cwd);
  if (!snapshot) return;

  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Cache key format: "HEAD_HASH:STATUS_HASH"
    const snapshotHead = (snapshot.cacheKey || "").split(":")[0];
    if (snapshotHead === head) return; // Still fresh

    emit(
      "PostToolUse",
      "[autodocs] Analysis cache is stale after git change. The MCP server will re-analyze automatically on the next tool call.",
    );
  } catch {
    // Silent
  }
}

// ─── Pattern Extraction ────────────────────────────────────────────────────

function extractPattern(toolName, toolInput) {
  if (!toolInput) return null;

  // Grep: pattern is directly available
  if (toolName === "Grep") {
    return toolInput.pattern || null;
  }

  // Glob: extract meaningful name from glob syntax
  if (toolName === "Glob") {
    const raw = toolInput.pattern || "";
    // "**/*.ts" → skip (too generic). "auth*.ts" → "auth". "**/authenticate/**" → "authenticate"
    const match = raw.match(/[*/]([a-zA-Z][a-zA-Z0-9_-]{2,})/);
    return match ? match[1] : null;
  }

  // Bash: parse grep/rg commands for the search pattern
  if (toolName === "Bash") {
    const cmd = toolInput.command || "";
    if (!/\brg\b|\bgrep\b/.test(cmd)) return null;

    // Simple token extraction: skip the command name and flags
    const tokens = cmd.split(/\s+/);
    const skipNextValue = new Set(["-e", "-f", "-A", "-B", "-C", "--glob", "--type", "-g", "-t"]);
    let skipNext = false;

    for (let i = 1; i < tokens.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      const t = tokens[i].replace(/^['"]|['"]$/g, "");
      if (t.startsWith("-")) {
        if (skipNextValue.has(t)) skipNext = true;
        continue;
      }
      if (t.length >= 3) return t;
    }
    return null;
  }

  return null;
}

// ─── Snapshot Loading ──────────────────────────────────────────────────────

function loadSnapshot(cwd) {
  try {
    const hash = crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 12);
    const cacheFile = path.join(os.homedir(), ".autodocs", "cache", `${hash}.json`);
    return JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  } catch {
    return null;
  }
}

// ─── Augmentation ──────────────────────────────────────────────────────────

function augment(snapshot, pattern) {
  // Find the primary package (largest)
  const pkgs = snapshot.packages || [];
  if (pkgs.length === 0) return null;
  const pkg = pkgs.reduce((a, b) => ((a.publicAPI || []).length > (b.publicAPI || []).length ? a : b));

  const q = pattern.toLowerCase();
  const callGraph = pkg.callGraph || [];
  const sections = [];

  // ── Pass 1: Public API symbols ──
  const apiMatches = (pkg.publicAPI || []).filter((e) => e.name.toLowerCase().includes(q));
  const matchedNames = new Set(apiMatches.map((e) => e.name));

  // ── Pass 2: Internal call graph functions not in public API ──
  for (const e of callGraph) {
    for (const fn of [e.from, e.to]) {
      if (matchedNames.has(fn) || !fn.toLowerCase().includes(q)) continue;
      matchedNames.add(fn);
      const file = e.from === fn ? e.fromFile : e.toFile;
      apiMatches.push({ name: fn, kind: "function", sourceFile: file, importCount: 0 });
    }
  }

  // Format symbol results (top 3) with call graph + co-change + flow context
  for (const exp of apiMatches.slice(0, 3)) {
    const lines = [`**${exp.name}** (${exp.kind}) — \`${exp.sourceFile}\``];

    const callers = callGraph.filter((e) => e.to === exp.name).map((e) => e.from).slice(0, 3);
    if (callers.length > 0) lines.push(`  Called by: ${callers.join(", ")}`);

    const callees = callGraph.filter((e) => e.from === exp.name).map((e) => e.to).slice(0, 3);
    if (callees.length > 0) lines.push(`  Calls: ${callees.join(", ")}`);

    const coChanges = (pkg.gitHistory?.coChangeEdges || [])
      .filter((e) => e.file1 === exp.sourceFile || e.file2 === exp.sourceFile)
      .sort((a, b) => b.jaccard - a.jaccard)
      .slice(0, 2)
      .map((e) => {
        const partner = e.file1 === exp.sourceFile ? e.file2 : e.file1;
        return `${partner} (${Math.round(e.jaccard * 100)}%)`;
      });
    if (coChanges.length > 0) lines.push(`  Co-changes with: ${coChanges.join(", ")}`);

    const flows = (pkg.executionFlows || [])
      .filter((f) => f.steps.includes(exp.name))
      .slice(0, 2)
      .map((f) => {
        const idx = f.steps.indexOf(exp.name);
        return `${f.label} (step ${idx + 1}/${f.length})`;
      });
    if (flows.length > 0) lines.push(`  Flows: ${flows.join("; ")}`);

    if (exp.importCount > 0) lines.push(`  Imported by: ${exp.importCount} files`);

    sections.push(lines.join("\n"));
  }

  // ── Pass 3: File paths from import chain ──
  const coveredFiles = new Set(apiMatches.slice(0, 3).map((e) => e.sourceFile));
  const seenFiles = new Set();
  const fileResults = [];

  for (const edge of pkg.importChain || []) {
    for (const fp of [edge.importer, edge.source]) {
      if (seenFiles.has(fp) || coveredFiles.has(fp) || !fp.toLowerCase().includes(q)) continue;
      seenFiles.add(fp);

      let context = "";
      const coChange = (pkg.gitHistory?.coChangeEdges || []).find((e) => e.file1 === fp || e.file2 === fp);
      if (coChange) {
        const partner = coChange.file1 === fp ? coChange.file2 : coChange.file1;
        context = ` — co-changes with ${partner} (${Math.round(coChange.jaccard * 100)}%)`;
      }
      fileResults.push(`\`${fp}\`${context}`);
    }
  }
  if (fileResults.length > 0) {
    sections.push(`**Files:** ${fileResults.slice(0, 3).join(", ")}`);
  }

  // ── Pass 4: Conventions and workflow rules ──
  for (const conv of pkg.conventions || []) {
    if (!conv.name.toLowerCase().includes(q) && !(conv.description || "").toLowerCase().includes(q)) continue;
    sections.push(`**Convention:** ${conv.name} — ${conv.description}`);
    break; // At most 1 convention match to keep output concise
  }

  for (const rule of snapshot.workflowRules || []) {
    if (!rule.trigger.toLowerCase().includes(q) && !rule.action.toLowerCase().includes(q)) continue;
    sections.push(`**Rule:** ${rule.trigger} → ${rule.action}`);
    break; // At most 1 rule match
  }

  if (sections.length === 0) return null;
  return `[autodocs] ${sections.length} result${sections.length > 1 ? "s" : ""} found:\n\n${sections.join("\n\n")}`;
}

// ─── Output ────────────────────────────────────────────────────────────────

function emit(hookEventName, additionalContext) {
  const response = {
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(response));
}

// ─── Entry Point ───────────────────────────────────────────────────────────
main();
