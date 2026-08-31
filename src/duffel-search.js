// api/duffel-search.js
//
// A minimal serverless proxy — the ONLY reason this exists is that Duffel
// (like virtually every real commerce/travel API) explicitly blocks direct
// browser calls: exposing a real API secret to every visitor's devtools is
// a genuine security problem, not a formality. See:
// https://help.duffel.com/hc/en-gb/articles/4504698704530
//
// This function holds the secret token server-side and does nothing else —
// no database, no auth, no persistence. Deploy it on Vercel's free tier
// alongside the static site; DUFFEL_API_KEY is set as a Vercel environment
// variable (never committed, never shipped to the client bundle).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = process.env.DUFFEL_API_KEY;
  if (!token) {
    // No key configured — respond gracefully so the frontend can fall back
    // to its simulated data instead of treating this as a hard failure.
    res.status(200).json({ offers: [], error: "DUFFEL_API_KEY not configured" });
    return;
  }

  const { origin = "JFK", destination = "CDG", departureDate, returnDate } = req.body || {};
  const date = departureDate || defaultDate(30);
  const slices = [{ origin, destination, departure_date: date }];
  if (returnDate) slices.push({ origin: destination, destination: origin, departure_date: returnDate });

  try {
    const r = await fetch("https://api.duffel.com/air/offer_requests?return_offers=true", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Duffel-Version": "v2",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          slices,
          passengers: [{ type: "adult" }],
          cabin_class: "economy",
        },
      }),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      res.status(200).json({ offers: [], error: `Duffel API error ${r.status}: ${text.slice(0, 300)}` });
      return;
    }

    const json = await r.json();
    const offers = (json?.data?.offers || []).slice(0, 5).map((o) => {
      const segments = o.slices?.[0]?.segments || [];
      return {
        airline: o.owner?.name || "Unknown carrier",
        price: o.total_amount,
        currency: o.total_currency,
        departure: segments[0]?.departing_at,
        arrival: segments[segments.length - 1]?.arriving_at,
        stops: Math.max(0, segments.length - 1),
      };
    });

    res.status(200).json({ offers, sandbox: true, testAirline: "Duffel Airways" });
  } catch (err) {
    res.status(200).json({ offers: [], error: String(err) });
  }
}

function defaultDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}