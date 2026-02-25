// test/mcp/integration.test.ts — MCP server integration test
// Spawns the REAL server process (ESM Node.js, not Vitest CJS shim),
// sends JSON-RPC over stdio, verifies every tool responds without error.
// This catches silent ESM failures like the require("typescript") bug.

import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let serverProcess: ChildProcess;
let requestId = 0;
let responseBuffer = "";
let stderrBuffer = "";
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function sendRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++requestId;
  const msg = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
  serverProcess.stdin!.write(msg);
  return new Promise((res, rej) => {
    pending.set(id, { resolve: res, reject: rej });
  });
}

function sendNotification(method: string, params: Record<string, unknown> = {}): void {
  const msg = `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
  serverProcess.stdin!.write(msg);
}

beforeAll(async () => {
  // Build must be up-to-date — run npm run build before these tests
  const serverPath = resolve("dist/bin/autodocs-engine.js");
  const projectPath = resolve("test/fixtures/minimal-pkg");

  serverProcess = spawn("node", [serverPath, "serve", projectPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, AUTODOCS_DEBUG: "0" },
  });

  serverProcess.stdout!.on("data", (chunk: Buffer) => {
    responseBuffer += chunk.toString();
    // JSON-RPC messages are newline-delimited
    const lines = responseBuffer.split("\n");
    responseBuffer = lines.pop()!; // Keep incomplete line in buffer
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)!.resolve(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* ignore non-JSON lines */
      }
    }
  });

  serverProcess.stderr!.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  // MCP handshake: initialize → notifications/initialized
  const initResp = await sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "integration-test", version: "1.0.0" },
  });
  expect(initResp.result).toBeTruthy();
  expect(initResp.result.serverInfo.name).toBe("autodocs-engine");

  sendNotification("notifications/initialized");

  // Wait for cache warmup (minimal fixture: ~100ms analysis)
  await new Promise((r) => setTimeout(r, 1500));
}, 15_000);

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
});

// ─── Tool Listing ─────────────────────────────────────────────────────────

describe("MCP server integration", () => {
  it("lists all 13 tools", async () => {
    const resp = await sendRequest("tools/list");
    const toolNames = resp.result.tools.map((t: any) => t.name).sort();
    expect(toolNames).toContain("get_commands");
    expect(toolNames).toContain("get_architecture");
    expect(toolNames).toContain("diagnose");
    expect(toolNames).toContain("auto_register");
    expect(toolNames).toContain("review_changes");
    expect(toolNames.length).toBe(13);
  });

  // ─── Every Tool Returns Non-Error ───────────────────────────────────────

  it("get_commands returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "get_commands",
      arguments: {},
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("get_architecture returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "get_architecture",
      arguments: {},
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("get_conventions returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "get_conventions",
      arguments: {},
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("get_workflow_rules returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "get_workflow_rules",
      arguments: {},
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("get_contribution_guide returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "get_contribution_guide",
      arguments: {},
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("get_exports returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "get_exports",
      arguments: {},
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("analyze_impact returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "analyze_impact",
      arguments: { filePath: "src/greet.ts" },
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("list_packages returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "list_packages",
      arguments: {},
    });
    expect(resp.result.isError).toBeFalsy();
    expect(resp.result.content[0].text).toContain("minimal-pkg");
  });

  it("plan_change returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "plan_change",
      arguments: { files: ["src/greet.ts"] },
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("get_test_info returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "get_test_info",
      arguments: { filePath: "src/greet.ts" },
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("auto_register returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "auto_register",
      arguments: { newFilePath: "src/utils.ts" },
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("review_changes returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "review_changes",
      arguments: {
        files: [{ path: "src/utils.ts", content: "export function helper() {}" }],
      },
    });
    expect(resp.result.isError).toBeFalsy();
  });

  it("diagnose returns without error", async () => {
    const resp = await sendRequest("tools/call", {
      name: "diagnose",
      arguments: {
        errorText: `TypeError: greet is not a function
    at Object.<anonymous> (src/greet.ts:5:3)`,
      },
    });
    expect(resp.result.isError).toBeFalsy();
    expect(resp.result.content[0].text).toContain("## Diagnosis");
  });

  it("prints session summary on stderr after shutdown", async () => {
    // Kill the server and wait for exit
    const exitPromise = new Promise<void>((resolve) => {
      serverProcess.on("close", () => resolve());
    });
    serverProcess.kill("SIGTERM");
    await exitPromise;

    // The session summary should appear on stderr (we made 13+ tool calls above)
    expect(stderrBuffer).toContain("[autodocs] Session:");
    expect(stderrBuffer).toContain("[autodocs] Tools:");
    expect(stderrBuffer).toMatch(/\d+ calls/);
  });
});
