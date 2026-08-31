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

### Enable real flight data (optional)

By default, the Travel mission's flight-search step uses simulated data. To
have it query real (sandbox) flight offers via
[Duffel](https://duffel.com) instead:

1. Get a free test-mode key at [app.duffel.com](https://app.duffel.com) →
   Developers → Access Tokens (prefix `duffel_test_`).
2. Add `DUFFEL_API_KEY=duffel_test_...` to `.env.local`. **Do not** prefix it
   with `VITE_` — that would bundle it into client code and expose it to
   every visitor. It's read only by `api/duffel-search.js`, server-side.
3. Duffel's own docs are explicit that browsers must not call their API
   directly (real secret key, real CORS block) — so this needs a serverless
   function in front of it, which means plain `npm run dev` (Vite alone)
   won't expose `/api/duffel-search`. Install the Vercel CLI and run
   `vercel dev` instead:
   ```bash
   npm i -g vercel
   vercel dev
   ```
   This serves the frontend _and_ the `/api` function together and reads
   `.env.local` automatically.
4. To deploy: push the repo to Vercel (`vercel` or connect the repo in the
   dashboard) and add `DUFFEL_API_KEY` under the project's Environment
   Variables — the free tier covers this comfortably.

Without a key (or under plain `npm run dev`), the flight-search step falls
back to simulated data automatically — the mission still completes. Each
run shows a `LIVE · DUFFEL SANDBOX` or `SIMULATED FALLBACK` tag next to that
step so it's always clear which one happened. Note Duffel's test mode uses
its own sandbox airline ("Duffel Airways") with realistic-shaped but not
real market prices — it's genuinely live data from a real API, just not
live pricing.

## What's here

- `src/AgentOps.jsx` — the whole app: Command Center, Mission Workspace,
  Sentinel Panel, Trust Policy, Audit Log, and the Three.js Agent Core.
  Sentinel approval shows inline in the Mission Workspace sidebar as well as
  in the full Sentinel Panel.
- `src/main.jsx` — mounts it into `index.html`.
- `src/webmcp.js` — the real WebMCP integration (see below), including tool
  discovery (`listRegisteredTools`).
- `src/planner.js` — the LLM mission planner (see "Enable AI mission
  planning" above). Falls back to the templates in `AgentOps.jsx`'s
  `MISSIONS` object if no key is configured or the call fails.
- `src/duffelClient.js` + `api/duffel-search.js` — real flight search (see
  "Enable real flight data" above). The client module never talks to Duffel
  directly; it only calls the serverless proxy, which is the only place the
  secret key lives.
- Sentinel's scoring/decision logic (`decideAction`, `riskScore`,
  `reasonsFor`) is plain JS — easy to extend with real policy rules. It also
  includes a prompt-injection / trust-boundary check (`detectInjection`):
  the Travel mission's hotel-compare step carries deliberately poisoned
  `untrustedContent` (a fake guest note telling the agent to wire a deposit
  elsewhere) so there's a real, demonstrable "Sentinel blocks an attempted
  instruction override" moment, distinct from an ordinary policy block.
- Trust Policy, the Audit Log (plus a "Past Missions" history), and mission
  stats persist to `localStorage` and survive a refresh.
- Responsive down to ~860px — the sidebar collapses to an icon bar and the
  two-column screens stack to one column.

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
there's no separate "demo path" versus "real path." Before executing
anything, the mission engine also calls `listRegisteredTools()` — a genuine
`getTools()` discovery call, shown in the Mission Workspace as
"Discovered Capabilities" chips — so DISCOVER is a real pipeline stage, not
a hardcoded list.

To confirm tools are actually registered, open devtools while a mission is
running and check:

```js
document.modelContext.getTools();
```

or install the
[Model Context Tool Inspector](https://webmcpinspector.com) extension to
browse/call them directly.

## Next steps if you keep building

- Wire real data into the Shopping mission too (e.g. eBay's Browse API) —
  same serverless-proxy pattern as Duffel, since eBay also requires a
  secret-bearing OAuth token that can't live in the browser.
- Add a "Simulate external agent" button that calls
  `document.modelContext.getTools()` and invokes one of the returned tools
  directly, to demo an agent driving AgentOps from _outside_ this UI.
- Swap the icosahedron core for whatever visual identity you want — it's
  isolated in the `AgentCore` component.
- If you want a second, fully independent WebMCP surface (rather than
  AgentOps registering tools on itself), a small second page/origin that
  registers its own tools would make the External Agent → Sentinel → WebMCP
  Tool → Website story completely literal.
