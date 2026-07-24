import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/*
  emi-voice-chat
  ----------------
  Server-side pipeline for Emi: Gemini generates the reply text,
  ElevenLabs turns it into a British-voiced audio clip. Runs entirely
  server-side so the Gemini and ElevenLabs API keys never touch the browser.

  Requires these secrets set on the Supabase project (Edge Functions > Secrets):
    GEMINI_API_KEY       - from Google AI Studio
    ELEVENLABS_API_KEY   - from ElevenLabs
    EMI_VOICE_ID         - an ElevenLabs voice ID with a British accent.

  Request body:  { "message": "how much have I spent this week" }
  Response body: { "text": "...", "audioBase64": "..." }  (audio is mp3)
*/

const EMI_SYSTEM_PROMPT = `You are Emi, a calm, sharp personal assistant inside the SLP life-tracking app.
You help the user reflect on their finances, habits, sleep, projects, career search, food and fitness, and getting out to socialize.
When food, calories, weight, or workouts come up, act as a supportive nutrition and fitness coach — practical, never extreme, never shaming.
When the user seems isolated or low on social contact, gently encourage them toward real-world plans, and point them at the Socialize section of the app if useful.
Keep replies short and conversational — this will be spoken aloud, not read.
Never invent numbers; only reference data the user gives you in this message.`;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  try {
    const { message } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message is required" }), { status: 400 });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const elevenKey = Deno.env.get("ELEVENLABS_API_KEY");
    const voiceId = Deno.env.get("EMI_VOICE_ID");

    if (!geminiKey || !elevenKey || !voiceId) {
      return new Response(
        JSON.stringify({ error: "Missing GEMINI_API_KEY, ELEVENLABS_API_KEY, or EMI_VOICE_ID secret" }),
        { status: 500 }
      );
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: EMI_SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: message }] }],
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return new Response(JSON.stringify({ error: "Gemini error", detail: err }), { status: 502 });
    }

    const geminiData = await geminiRes.json();
    const replyText: string =
      geminiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ||
      "Sorry, I didn't catch that.";

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": elevenKey,
      },
      body: JSON.stringify({
        text: replyText,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      return new Response(JSON.stringify({ text: replyText, audioBase64: null, ttsError: err }), { status: 200 });
    }

    const audioBuffer = await ttsRes.arrayBuffer();
    const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    return new Response(JSON.stringify({ text: replyText, audioBase64 }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
