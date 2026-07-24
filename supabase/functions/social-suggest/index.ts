import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/*
  social-suggest
  ----------------
  Server-side pipeline that asks Gemini (with live Google Search grounding)
  for real, current things the user could go do nearby, based on their
  stated interests and city. Runs server-side so GEMINI_API_KEY never
  touches the browser.

  Requires this secret set on the Supabase project (Edge Functions > Secrets):
    GEMINI_API_KEY   - from Google AI Studio (same key used by emi-voice-chat)

  Request body:  { "city": "Cairo", "interest": "Outdoors / nature (hikes, parks)", "goal": "Get more social & active" }
  Response body: { "suggestions": [ { "category": "...", "title": "...", "description": "..." }, ... ] }
*/

const SYSTEM_PROMPT = `You find real, current, specific things a person can go do in real life to get out of the house and socialize.
Use Google Search to ground your answer in things that are actually real — real venues, real recurring events, real activity types available in that city.
Respond with ONLY a JSON array (no markdown fences, no preamble, no commentary) of 4 to 5 objects, each with exactly these fields:
"category": a short 1-2 word tag (e.g. "Outdoors", "Food & Drink", "Fitness", "Culture"),
"title": the specific name of a place, event type, or activity,
"description": 1-2 inviting sentences, specific to that city where possible, explaining why it fits the person.
If you cannot verify live events, suggest well-known recurring venues or activity types genuinely available in or near that city instead of inventing anything. Return ONLY the JSON array, nothing else.`;

function extractJsonArray(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  try {
    const { city, interest, goal } = await req.json();
    if (!city || typeof city !== "string") {
      return new Response(JSON.stringify({ error: "city is required" }), { status: 400 });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "Missing GEMINI_API_KEY secret" }), { status: 500 });
    }

    const userMessage = `City: ${city}\nInterest leaning: ${interest || "not specified — pick a well-rounded mix"}\nBroader goal: ${goal || "get out and socialize more"}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          tools: [{ google_search: {} }],
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return new Response(JSON.stringify({ error: "Gemini error", detail: err }), { status: 502 });
    }

    const geminiData = await geminiRes.json();
    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "[]";

    let suggestions;
    try {
      suggestions = extractJsonArray(rawText);
    } catch {
      suggestions = [{ category: "Idea", title: "Explore nearby", description: rawText.slice(0, 300) }];
    }

    return new Response(JSON.stringify({ suggestions }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
