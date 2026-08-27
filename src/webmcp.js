// src/webmcp.js
//
// Real WebMCP integration (W3C navigator.modelContext / document.modelContext).
//
// Every mission step is registered as an actual callable tool via
// registerTool() — the exact surface a real external agent (Claude, ChatGPT,
// Chrome's built-in AI, a browser extension, etc.) would discover and call if
// it inspected this page. Sentinel sits inside each tool's execute(), so
// approval/blocking is enforced no matter who invokes the tool.
//
// Native support: Chrome 146+ behind the WebMCP flag, exposing the surface on
// navigator.modelContext. Everywhere else we load the strict
// @mcp-b/webmcp-polyfill, which installs the same core API on
// document.modelContext (canonical location per the April 2026 W3C draft;
// navigator.modelContext is kept as a deprecated alias). See
// https://docs.mcp-b.ai for details.
//
// The strict polyfill intentionally only ships registerTool()/getTools() —
// no callTool() convenience — so we keep a small local registry of each
// tool's execute() to drive the mission ourselves. That registry entry IS the
// same function a real agent's tool call would run; nothing about Sentinel's
// gating differs between the two call paths.

let loadPromise = null;
const registry = new Map(); // name -> execute()

/** Ensure navigator.modelContext / document.modelContext exists (native or polyfilled). Idempotent. */
export async function ensureWebMCP() {
  if (typeof window === "undefined") return "unavailable";
  if (!loadPromise) {
    loadPromise = (async () => {
      const hasNative = "modelContext" in navigator;
      if (hasNative) return "native";
      try {
        const { initializeWebMCPPolyfill } = await import("@mcp-b/webmcp-polyfill");
        initializeWebMCPPolyfill({ installTestingShim: true });
        return "polyfill";
      } catch (err) {
        console.warn("[webmcp] polyfill failed to load, tools will run in local-only mode:", err);
        return "unavailable";
      }
    })();
  }
  return loadPromise;
}

export function getModelContext() {
  if (typeof window === "undefined") return null;
  return document.modelContext || navigator.modelContext || null;
}

function slug(tool) {
  return tool.replace(/\./g, "-");
}

/**
 * Register every step of a mission as a WebMCP tool.
 *
 * @param mission   The mission definition ({ steps: [...] }).
 * @param gate      async (step) => { text, isError? } — Sentinel's risk/approval
 *                  logic (kept in AgentOps.jsx so it can drive React state).
 * @returns { controller, mode } — controller.abort() unregisters every tool.
 */
export async function registerMissionTools(mission, gate) {
  const mode = await ensureWebMCP();
  const mc = getModelContext();
  const controller = new AbortController();
  registry.clear();
  if (!mc) return { controller, mode };

  for (const step of mission.steps) {
    const name = slug(step.tool);
    const properties = {};
    if (step.amount) properties.amount = { type: "number", description: "USD amount involved in this action." };

    const execute = async () => {
      const result = await gate(step);
      return {
        content: [{ type: "text", text: result.text }],
        isError: !!result.isError,
      };
    };
    registry.set(name, execute);

    mc.registerTool(
      {
        name,
        description: `${step.label}. Category: ${step.category}.${step.amount ? ` Amount: $${step.amount}.` : ""}`,
        inputSchema: { type: "object", properties },
        execute,
      },
      { signal: controller.signal }
    );
  }

  return { controller, mode };
}

/**
 * Invoke a registered tool by its mission-step name. This calls the exact
 * same execute() a real agent's tool call would hit — Sentinel gating and
 * all — just dispatched from our own mission loop instead of from an
 * external agent's tool-call request.
 */
export async function callMissionTool(step) {
  const execute = registry.get(slug(step.tool));
  if (!execute) throw new Error(`WebMCP tool "${step.tool}" is not registered.`);
  return execute();
}