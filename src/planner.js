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
  "amount": number in USD (ONLY include this field if the step involves spending or moving money),
  "detail": "One sentence of realistic detail about what this step does or finds."
}

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

/**
 * @param goal   The user's free-text mission goal.
 * @returns {Promise<{steps: object[]}|null>} null means "use the template fallback".
 */
export async function planMission(goal) {
  const baseURL = (import.meta.env.VITE_LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const apiKey = import.meta.env.VITE_LLM_API_KEY;
  const model = import.meta.env.VITE_LLM_MODEL || "llama-3.3-70b-versatile";

  if (!apiKey) return null; // no key configured — caller falls back to a template

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
      console.warn(`[planner] LLM request failed (${res.status}) — falling back to template.`);
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return null;

    const parsed = JSON.parse(text);
    const steps = sanitizeSteps(parsed.steps);
    return steps ? { steps } : null;
  } catch (err) {
    console.warn("[planner] LLM planning failed — falling back to template:", err);
    return null;
  }
}