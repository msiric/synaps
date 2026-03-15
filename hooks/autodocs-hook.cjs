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

  const patternLower = pattern.toLowerCase();

  // Match against public API symbols
  const matches = (pkg.publicAPI || []).filter((e) => e.name.toLowerCase().includes(patternLower));
  if (matches.length === 0) return null;

  const results = [];
  for (const exp of matches.slice(0, 3)) {
    const lines = [`**${exp.name}** (${exp.kind}) — \`${exp.sourceFile}\``];

    // Callers from call graph
    const callers = (pkg.callGraph || [])
      .filter((e) => e.to === exp.name)
      .map((e) => e.from)
      .slice(0, 3);
    if (callers.length > 0) lines.push(`  Called by: ${callers.join(", ")}`);

    // Callees from call graph
    const callees = (pkg.callGraph || [])
      .filter((e) => e.from === exp.name)
      .map((e) => e.to)
      .slice(0, 3);
    if (callees.length > 0) lines.push(`  Calls: ${callees.join(", ")}`);

    // Co-change partners
    const coChanges = (pkg.gitHistory?.coChangeEdges || [])
      .filter((e) => e.file1 === exp.sourceFile || e.file2 === exp.sourceFile)
      .sort((a, b) => b.jaccard - a.jaccard)
      .slice(0, 2)
      .map((e) => {
        const partner = e.file1 === exp.sourceFile ? e.file2 : e.file1;
        return `${partner} (${Math.round(e.jaccard * 100)}%)`;
      });
    if (coChanges.length > 0) lines.push(`  Co-changes with: ${coChanges.join(", ")}`);

    // Execution flows
    const flows = (pkg.executionFlows || [])
      .filter((f) => f.steps.includes(exp.name))
      .slice(0, 2)
      .map((f) => {
        const idx = f.steps.indexOf(exp.name);
        return `${f.label} (step ${idx + 1}/${f.length})`;
      });
    if (flows.length > 0) lines.push(`  Flows: ${flows.join("; ")}`);

    // Import count
    if (exp.importCount > 0) lines.push(`  Imported by: ${exp.importCount} files`);

    results.push(lines.join("\n"));
  }

  if (results.length === 0) return null;
  return `[autodocs] ${results.length} related symbol${results.length > 1 ? "s" : ""} found:\n\n${results.join("\n\n")}`;
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
