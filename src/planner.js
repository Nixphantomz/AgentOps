// src/planner.js
//
// Turns a free-text goal into a mission step list using an LLM, so the
// Command Center's natural-language box actually understands the goal
// instead of keyword-matching to one of three canned templates.
//
// Provider-agnostic: talks to any OpenAI-compatible /chat/completions
// endpoint. Defaults to Groq (https://api.groq.com/openai/v1), which has a
// genuinely free, no-credit-card developer tier — a good fit if you don't
// have an OpenAI/Anthropic key. Point it at OpenAI, OpenRouter, or a local
// Ollama server instead by setting the env vars below.
//
// If no API key is configured (or the call fails for any reason), planMission
// returns null and the caller falls back to a keyword-matched template —
// the mission always runs, AI planning is a strict upgrade, never a
// dependency.

const CATEGORIES = [
  "search", "compare", "read", "draft",
  "booking", "purchase", "send_message", "share_info",
  "credential", "password_change", "account_deletion", "financial_transfer",
];

const SYSTEM_PROMPT = `You are the mission planner inside AgentOps, an AI agent that acts on the web through WebMCP tools, gated by a security layer called Sentinel.

Given a user's goal, output a JSON object with a "steps" array (4-7 steps) describing the WebMCP tool calls needed to accomplish it. Each step:
{
  "tool": "webmcp.<domain>.<action>",   // dot-namespaced, e.g. "webmcp.flights.search"
  "label": "Human-readable action",      // e.g. "Search flights JFK to CDG"
  "category": one of ${JSON.stringify(CATEGORIES)},
  "amount": number in USD — REQUIRED whenever the step spends money, places an order, or moves funds (ordering food, buying a product, booking travel, subscribing, transferring money). Invent a realistic price if the user didn't specify one. Omit this field entirely for steps that don't involve money.
  "detail": "Concrete, specific result — invent plausible real-sounding names and exact prices. For a search/compare step: name 2-4 specific options with prices (e.g. 'Hotel Lumière $160/night, Le Marais Inn $145/night — Hotel Lumière selected'). For a booking/purchase step: name the specific chosen option and its exact price. Never write vague filler like 'found good options' — always include invented names and numbers."
}

If any step searches for or books flights, ALSO include a top-level "flightSearch" object in your response (sibling of "steps", not inside it):
{
  "origin": "3-letter IATA airport code — assume JFK if the user didn't specify a departure city",
  "destination": "3-letter IATA airport code for the destination city the user mentioned"
}
Only include "flightSearch" when the goal genuinely involves a flight. Get the destination code right — this is used to make a real flight search, so a wrong or invented code is worse than omitting the field.

Category guide:
- search/compare/read/draft: safe, low-risk actions (should be most of your steps)
- booking/purchase: only when the goal genuinely requires buying or reserving something
- send_message/share_info: only if the goal requires contacting someone or sharing personal data
- credential/password_change/account_deletion/financial_transfer: HIGH RISK — only include one of these if it's a genuinely plausible (if slightly overreaching) side effect of an agent pursuing this goal autonomously. Do not force one in if it doesn't fit.

Order steps the way an agent would actually execute them. Respond with ONLY the JSON object, no prose, no markdown fences.`;

function sanitizeSteps(rawSteps) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;
  const steps = rawSteps
    .slice(0, 8)
    .map((s, i) => {
      if (!s || typeof s.label !== "string") return null;
      const category = CATEGORIES.includes(s.category) ? s.category : "read";
      const tool = typeof s.tool === "string" && s.tool.trim()
        ? s.tool.trim()
        : `webmcp.custom.step${i + 1}`;
      const amount = typeof s.amount === "number" && isFinite(s.amount) ? Math.round(s.amount) : undefined;
      return {
        id: `ai${i + 1}`,
        tool,
        label: s.label.trim(),
        category,
        detail: typeof s.detail === "string" ? s.detail.trim() : undefined,
        ...(amount ? { amount } : {}),
      };
    })
    .filter(Boolean);
  return steps.length ? steps : null;
}

function sanitizeFlightSearch(fs) {
  if (!fs || typeof fs !== "object") return undefined;
  const iata = /^[A-Z]{3}$/;
  const origin = typeof fs.origin === "string" ? fs.origin.trim().toUpperCase() : "";
  const destination = typeof fs.destination === "string" ? fs.destination.trim().toUpperCase() : "";
  if (!iata.test(origin) || !iata.test(destination)) return undefined;
  return { origin, destination };
}

/**
 * @param goal   The user's free-text mission goal.
 * @returns {Promise<{steps: object[], flightSearch?: {origin, destination}}|null>}
 *          null means "use the template fallback".
 */
export async function planMission(goal) {
  const baseURL = (import.meta.env.VITE_LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const apiKey = import.meta.env.VITE_LLM_API_KEY;
  const model = import.meta.env.VITE_LLM_MODEL || "openai/gpt-oss-120b";

  if (!apiKey) {
    console.info("[planner] No VITE_LLM_API_KEY configured — using a template instead of AI planning. See .env.example.");
    return null;
  }

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: goal },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[planner] LLM request failed (${res.status}) — falling back to template.`, body.slice(0, 300));
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      console.warn("[planner] LLM response had no content — falling back to template.");
      return null;
    }

    const parsed = JSON.parse(text);
    const steps = sanitizeSteps(parsed.steps);
    if (!steps) {
      console.warn("[planner] LLM response had no usable steps — falling back to template.");
      return null;
    }
    const flightSearch = sanitizeFlightSearch(parsed.flightSearch);
    return { steps, ...(flightSearch ? { flightSearch } : {}) };
  } catch (err) {
    console.warn("[planner] LLM planning failed — falling back to template:", err);
    return null;
  }
}