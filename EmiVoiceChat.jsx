import { useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/*
  Emi Voice Chat — client component
  ------------------------------------
  Talks to the emi-voice-chat Edge Function (Gemini brain + ElevenLabs
  British voice), plays the returned audio, and logs both sides of the
  conversation to emi_messages so it shows up in Emi's chat history.

  SETUP (one-time, in the Supabase dashboard):
    Project > Edge Functions > emi-voice-chat > Secrets, set:
      GEMINI_API_KEY
      ELEVENLABS_API_KEY
      EMI_VOICE_ID   (pick a British voice from the ElevenLabs Voice Library)
*/

const supabase = createClient(
  "https://drydmrgxwdaaobbfyrzu.supabase.co",
  "sb_publishable_a8gQAmzXtLlv0nVNIvhXlQ_bsNN3t-_"
);

export default function EmiVoiceChat({ userId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const audioRef = useRef(null);

  const send = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    await supabase.from("emi_messages").insert({ user_id: userId, role: "user", content: text });

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch("https://drydmrgxwdaaobbfyrzu.supabase.co/functions/v1/emi-voice-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();

    if (data.text) {
      setMessages((m) => [...m, { role: "emi", content: data.text }]);
      await supabase.from("emi_messages").insert({ user_id: userId, role: "emi", content: data.text });
    }

    if (data.audioBase64 && audioRef.current) {
      audioRef.current.src = `data:audio/mpeg;base64,${data.audioBase64}`;
      audioRef.current.play();
    }

    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col px-4 py-6">
      <audio ref={audioRef} className="hidden" />
      <div className="max-w-lg w-full mx-auto flex flex-col flex-1">
        <p className="text-amber-500/70 text-xs uppercase tracking-widest mb-4">Emi</p>

        <div className="flex-1 space-y-3 overflow-y-auto mb-4">
          {messages.length === 0 && (
            <p className="text-zinc-600 text-sm">Ask Emi anything — she'll answer out loud.</p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                m.role === "user"
                  ? "bg-zinc-800 text-zinc-100 ml-auto"
                  : "bg-amber-500/10 border border-amber-500/30 text-amber-100"
              }`}
            >
              {m.content}
            </div>
          ))}
          {busy && <p className="text-zinc-600 text-xs">Emi is thinking...</p>}
        </div>

        <form onSubmit={send} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type to Emi..."
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60 focus:border-amber-500/60"
          />
          <button
            type="submit"
            disabled={busy}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-zinc-950 font-medium text-sm rounded-lg px-4 transition"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
