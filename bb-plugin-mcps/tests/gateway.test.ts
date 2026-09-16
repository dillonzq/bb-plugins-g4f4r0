import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMcpRequest, McpGateway, type McpStdioHost } from "../src/gateway.js";
import { McpsStore } from "../src/store.js";
import type { Tool } from "@modelcontextprotocol/client";

function memoryStore() {
  const db = new Database(":memory:");
  return new McpsStore(db, (target, statements) => {
    for (const statement of statements) target.exec(statement);
  });
}

function hostWithTools(tools: Tool[], onCall: () => void): McpStdioHost {
  const catalog = { tools, prompts: [], resources: [], resourceTemplates: [] };
  return {
    async start() { return catalog; },
    async refresh() { return catalog; },
    async close() {},
    async callTool() { onCall(); return { content: [{ type: "text", text: "ok" }] }; },
    async getPrompt() { return {}; },
    async readResource() { return {}; },
    async complete() { return {}; },
    async subscribeResource() {},
    async unsubscribeResource() {},
    async setLoggingLevel() {},
  };
}

function seed(store: McpsStore, id = "echo", name = "Fixture") {
  const now = Date.now();
  store.upsertSource({
    id, name, description: "test server", sourceKind: "manual", sourceRef: "echo",
    registryName: null, registryVersion: null, pluginRoot: "/tmp/mcps-root", pluginData: "/tmp/mcps-data",
    createdAt: now, updatedAt: now,
  });
  store.upsertMcpServer({
    pluginId: id, serverId: "mcp", type: "stdio",
    configJson: JSON.stringify({ type: "stdio", command: "echo", args: [], cwd: "${PLUGIN_DATA}" }),
    status: "ready", lastError: null, approved: 1, enabled: 1,
  });
}

const echoTool = { name: "echo", description: "Echo a message", inputSchema: { type: "object" } } as Tool;
const writeTool = { name: "write_file", description: "Write a file", inputSchema: { type: "object" }, annotations: { destructiveHint: true } } as Tool;
const queryTool = {
  name: "query_data_sources",
  description: "Run a structured lookup",
  inputSchema: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          query: { type: "string" },
          data_source_urls: { type: "array", items: { type: "string" } },
        },
        required: ["query", "data_source_urls"],
      },
    },
    required: ["data"],
  },
} as Tool;

describe("lazy MCP gateway", () => {
  const gateways: McpGateway[] = [];
  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  });

  it("calls one tool without listing the full catalog", async () => {
    const store = memoryStore();
    seed(store);
    const stdioHost = hostWithTools([echoTool, writeTool], () => {});
    const gateway = new McpGateway(store, { info() {}, warn() {}, error() {} }, { stdioHost });
    gateways.push(gateway);
    const listTools = vi.spyOn(gateway, "listTools");
    const { tools: hits } = await gateway.searchTools("echo");
    expect(hits[0]?.name).toBe("echo");
    expect(hits).toHaveLength(1);
    const result = await gateway.call(hits[0]!.opaqueId, {});
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    const schema = await gateway.getTool(hits[0]!.opaqueId);
    expect(schema.inputSchema).toEqual({ type: "object" });
    expect(listTools).not.toHaveBeenCalled();
  });

  it("ranks tools by parameter names and attaches a call card", async () => {
    const store = memoryStore();
    seed(store);
    const stdioHost = hostWithTools([echoTool, queryTool], () => {});
    const gateway = new McpGateway(store, { info() {}, warn() {}, error() {} }, { stdioHost });
    gateways.push(gateway);
    const { tools } = await gateway.searchTools("data_source_urls");
    expect(tools[0]?.name).toBe("query_data_sources");
    expect(tools[0]?.card?.shape).toBe("{ data: { query, data_source_urls } }");
    expect(tools[0]?.card?.example).toEqual({ data: { query: "", data_source_urls: [""] } });
  });

  it("compactServers does not connect", async () => {
    const store = memoryStore();
    seed(store);
    const start = vi.fn(async () => ({ tools: [echoTool], prompts: [], resources: [], resourceTemplates: [] }));
    const stdioHost = hostWithTools([echoTool], () => {});
    stdioHost.start = start;
    const gateway = new McpGateway(store, { info() {}, warn() {}, error() {} }, { stdioHost });
    gateways.push(gateway);
    const servers = await gateway.compactServers();
    expect(servers).toEqual([expect.objectContaining({ id: "echo", status: "ready", toolCount: null })]);
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects invalid arguments without invoking the tool", async () => {
    const store = memoryStore();
    seed(store);
    let calls = 0;
    const stdioHost = hostWithTools([queryTool], () => { calls += 1; });
    const gateway = new McpGateway(store, { info() {}, warn() {}, error() {} }, { stdioHost });
    gateways.push(gateway);
    const { tools } = await gateway.searchTools("query_data_sources");
    await expect(gateway.call(tools[0]!.opaqueId, { query: "today" })).rejects.toThrow(/Invalid arguments/);
    expect(calls).toBe(0);
    expect(gateway.peekTool(tools[0]!.opaqueId)?.name).toBe("query_data_sources");
  });

  it("returns ready catalogs without waiting for a hung server", async () => {
    const store = memoryStore();
    seed(store, "echo", "Echo");
    seed(store, "slow", "Slow");
    const stdioHost: McpStdioHost = {
      async start(config, signal) {
        if (config.key.startsWith("slow:")) {
          await new Promise<never>((_, reject) => {
            const fail = () => reject(new Error("aborted"));
            if (signal?.aborted) fail();
            else signal?.addEventListener("abort", fail, { once: true });
          });
        }
        return { tools: [echoTool], prompts: [], resources: [], resourceTemplates: [] };
      },
      async refresh() { return { tools: [echoTool], prompts: [], resources: [], resourceTemplates: [] }; },
      async close() {},
      async callTool() { return { content: [{ type: "text", text: "ok" }] }; },
      async getPrompt() { return {}; },
      async readResource() { return {}; },
      async complete() { return {}; },
      async subscribeResource() {},
      async unsubscribeResource() {},
      async setLoggingLevel() {},
    };
    const gateway = new McpGateway(store, { info() {}, warn() {}, error() {} }, { stdioHost, searchWaitMs: 80 });
    gateways.push(gateway);
    const started = Date.now();
    const result = await gateway.searchTools("echo");
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.tools.some((tool) => tool.serverName === "Echo")).toBe(true);
    expect(result.unavailable.some((item) => item.startsWith("Slow"))).toBe(true);
  });
});

describe("MCP header attachment", () => {
  const configured = new URL("https://mcp.example/mcp");
  const jsonrpc = { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }) };

  it("keeps configured headers off cross-origin JSON-RPC and event-stream requests", () => {
    expect(isMcpRequest(new URL("https://evil.example/mcp"), configured, configured, jsonrpc)).toBe(false);
    expect(isMcpRequest(
      new URL("https://evil.example/events"),
      configured,
      configured,
      { method: "GET", headers: { accept: "text/event-stream" } },
    )).toBe(false);
    expect(isMcpRequest(configured, configured, configured, jsonrpc)).toBe(true);
  });
});
