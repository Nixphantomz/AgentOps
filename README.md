# AgentOps

Hackathon demo for the WebMCP Challenge: a mission engine + Sentinel
risk/policy layer sitting between an AI agent and mocked WebMCP tool calls.

## Run it

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually http://localhost:5173).

### Enable AI mission planning (optional but recommended)

By default, the Command Center's natural-language box keyword-matches your
goal to one of the three built-in templates. To have an actual LLM read the
goal and generate the step sequence:

1. Copy `.env.example` to `.env.local`.
2. Get a free API key — [Groq](https://console.groq.com) has a genuinely
   free, no-credit-card developer tier and is the default here. OpenAI,
   OpenRouter, or a local Ollama server work too (see the comments in
   `.env.example` for how to point at them).
3. Paste the key into `VITE_LLM_API_KEY` in `.env.local`.
4. Restart `npm run dev`.

Without a key, missions still run end-to-end — they just use the built-in
templates instead of an AI-generated plan. The sidebar and Mission Workspace
show an `AI-PLANNED` vs `TEMPLATE` badge so it's always clear which one ran.

**Note on API keys in the browser:** this calls the LLM directly from
client-side code, which exposes the key to anyone who opens devtools — fine
for a hackathon demo, not something to ship to real users with a shared key.
If you later deploy this, proxy the call through a small serverless function
instead.

## What's here

- `src/AgentOps.jsx` — the whole app: Command Center, Mission Workspace,
  Sentinel Panel, Trust Policy, Audit Log, and the Three.js Agent Core.
  Sentinel approval now also shows inline in the Mission Workspace sidebar —
  the Sentinel Panel screen is still there for the full risk breakdown, but
  you don't have to leave the workspace to approve/reject.
- `src/main.jsx` — mounts it into `index.html`.
- `src/webmcp.js` — the real WebMCP integration (see below).
- `src/planner.js` — the LLM mission planner (see "Enable AI mission
  planning" above). Falls back to the templates in `AgentOps.jsx`'s
  `MISSIONS` object if no key is configured or the call fails.
- Sentinel's scoring/decision logic (`decideAction`, `riskScore`,
  `reasonsFor`) is plain JS — easy to extend with real policy rules.

## WebMCP integration

This app registers every mission step as a real, callable tool via the
[W3C WebMCP API](https://github.com/webmachinelearning/webmcp)
(`navigator.modelContext` / `document.modelContext`):

- **Native**: Chrome 146+ behind the WebMCP flag
  (`chrome://flags/#enable-webmcp-testing`) exposes the API directly — no
  extra package needed.
- **Everywhere else**: `src/webmcp.js` lazy-loads
  [`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill),
  a strict polyfill of the same core surface (`registerTool`, `getTools`).
- The sidebar shows a live `WEBMCP · NATIVE / POLYFILL / UNAVAILABLE`
  status badge so you can see which mode you're in.

Sentinel's approval/blocking logic lives **inside each tool's `execute()`**
(`makeGate` in `AgentOps.jsx`, wired up in `registerMissionTools`). That
means the gating isn't UI-only — it applies no matter who calls the tool.
Our own mission runner calls tools through `callMissionTool()`, which hits
the exact same `execute()` a real external agent's tool call would hit;
there's no separate "demo path" versus "real path."

To confirm tools are actually registered, open devtools while a mission is
running and check:

```js
document.modelContext.getTools();
```

or install the
[Model Context Tool Inspector](https://webmcpinspector.com) extension to
browse/call them directly.

## Next steps if you keep building

- Point individual steps at real sites: have their `execute()` drive an
  actual fetch, form fill, or WebMCP tool call registered by that site,
  instead of the simulated delay.
- Persist `policy` and `log` to localStorage or a backend so they survive
  a refresh.
- Add a "Simulate external agent" button that calls
  `document.modelContext.getTools()` and invokes one of the returned tools
  directly, to demo an agent driving AgentOps from _outside_ this UI.
- Swap the icosahedron core for whatever visual identity you want — it's
  isolated in the `AgentCore` component.
