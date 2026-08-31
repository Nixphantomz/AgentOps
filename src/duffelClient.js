// src/duffelClient.js
//
// Calls the /api/duffel-search serverless proxy — never Duffel directly
// (browsers are blocked from doing that; see api/duffel-search.js).
//
// Returns null on ANY failure (no proxy deployed, no key configured, Duffel
// down, sandbox inventory exhausted) so the caller can fall back to the
// mission's simulated data. Real data is a strict upgrade, never a
// dependency — the mission always completes either way.

export async function searchRealFlights({ origin, destination, departureDate, returnDate }) {
  try {
    const res = await fetch("/api/duffel-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, destination, departureDate, returnDate }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.offers || data.offers.length === 0) {
      if (data.error) console.warn("[duffel] falling back to simulated data:", data.error);
      return null;
    }
    return data.offers;
  } catch (err) {
    // Most likely: running plain `npm run dev` (Vite alone) instead of
    // `vercel dev`, so /api/duffel-search doesn't exist as a route yet.
    console.warn("[duffel] proxy unreachable, falling back to simulated data:", err.message);
    return null;
  }
}