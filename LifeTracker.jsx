import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

/*
  Music + Shopping tracker
  ---------------------------
  Addiction tracking isn't duplicated here — it's already covered by the
  existing habits/habit_logs tables (smoking, vaping, or any custom habit),
  which already support exactly this kind of tracking with clean-day logging.

  Tables used (added this pass):
    music_log       — songs/artists you've been into, with an optional note
    shopping_items   — things wanted or bought, with price + a link
*/

const supabase = createClient(
  "https://drydmrgxwdaaobbfyrzu.supabase.co",
  "sb_publishable_a8gQAmzXtLlv0nVNIvhXlQ_bsNN3t-_"
);

function Section({ title, children }) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 mb-6">
      <p className="text-amber-500/70 text-xs uppercase tracking-widest mb-4">{title}</p>
      {children}
    </div>
  );
}

function MusicTab({ userId }) {
  const [entries, setEntries] = useState([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [note, setNote] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("music_log")
      .select("*")
      .eq("user_id", userId)
      .order("logged_at", { ascending: false })
      .limit(30);
    setEntries(data || []);
  };

  useEffect(() => {
    load();
  }, [userId]);

  const add = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    await supabase.from("music_log").insert({ user_id: userId, title: title.trim(), artist: artist.trim() || null, note: note.trim() || null });
    setTitle("");
    setArtist("");
    setNote("");
    load();
  };

  return (
    <Section title="Music">
      <form onSubmit={add} className="flex flex-wrap gap-2 mb-4">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Track" className="flex-1 min-w-[100px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60" />
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist" className="flex-1 min-w-[100px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="flex-1 min-w-[100px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60" />
        <button className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-sm rounded-lg px-4 transition">Add</button>
      </form>

      <div className="space-y-2">
        {entries.length === 0 && <p className="text-zinc-600 text-sm">Nothing logged yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between text-sm border-b border-zinc-800/60 pb-2">
            <div>
              <span className="text-zinc-100">{e.title}</span>
              {e.artist && <span className="text-zinc-500"> — {e.artist}</span>}
              {e.note && <p className="text-zinc-600 text-xs mt-0.5">{e.note}</p>}
            </div>
            <span className="text-zinc-600 text-xs">{new Date(e.logged_at).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ShoppingTab({ userId }) {
  const [items, setItems] = useState([]);
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [url, setUrl] = useState("");

  const load = async () => {
    const { data } = await supabase.from("shopping_items").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    setItems(data || []);
  };

  useEffect(() => {
    load();
  }, [userId]);

  const add = async (e) => {
    e.preventDefault();
    if (!item.trim()) return;
    await supabase.from("shopping_items").insert({
      user_id: userId,
      item: item.trim(),
      price: price ? parseFloat(price) : null,
      url: url.trim() || null,
    });
    setItem("");
    setPrice("");
    setUrl("");
    load();
  };

  const toggleBought = async (row) => {
    await supabase.from("shopping_items").update({ status: row.status === "bought" ? "wanted" : "bought" }).eq("id", row.id);
    load();
  };

  const wanted = items.filter((i) => i.status === "wanted");
  const bought = items.filter((i) => i.status === "bought");

  return (
    <Section title="Shopping">
      <form onSubmit={add} className="flex flex-wrap gap-2 mb-4">
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item" className="flex-1 min-w-[100px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60" />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (EGP)" className="w-28 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (optional)" className="flex-1 min-w-[100px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60" />
        <button className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-sm rounded-lg px-4 transition">Add</button>
      </form>

      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">Wanted</p>
      <div className="space-y-2 mb-4">
        {wanted.length === 0 && <p className="text-zinc-600 text-sm">Nothing on the list.</p>}
        {wanted.map((i) => (
          <div key={i.id} className="flex items-center justify-between text-sm border-b border-zinc-800/60 pb-2">
            <div>
              {i.url ? (
                <a href={i.url} target="_blank" rel="noreferrer" className="text-zinc-100 hover:text-amber-400">{i.item}</a>
              ) : (
                <span className="text-zinc-100">{i.item}</span>
              )}
              {i.price != null && <span className="text-zinc-500"> — {i.price} EGP</span>}
            </div>
            <button onClick={() => toggleBought(i)} className="text-xs text-amber-400 hover:text-amber-300">Mark bought</button>
          </div>
        ))}
      </div>

      {bought.length > 0 && (
        <>
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-2">Bought</p>
          <div className="space-y-2">
            {bought.map((i) => (
              <div key={i.id} className="flex items-center justify-between text-sm border-b border-zinc-800/60 pb-2 opacity-60">
                <span className="text-zinc-300 line-through">{i.item}</span>
                <button onClick={() => toggleBought(i)} className="text-xs text-zinc-500 hover:text-zinc-300">Undo</button>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

export default function LifeTracker({ userId }) {
  const [tab, setTab] = useState("music");

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="flex mb-6 rounded-lg bg-zinc-900 border border-zinc-800 p-1 w-fit">
          <button onClick={() => setTab("music")} className={`text-sm px-4 py-1.5 rounded-md transition ${tab === "music" ? "bg-zinc-800 text-amber-400" : "text-zinc-500"}`}>Music</button>
          <button onClick={() => setTab("shopping")} className={`text-sm px-4 py-1.5 rounded-md transition ${tab === "shopping" ? "bg-zinc-800 text-amber-400" : "text-zinc-500"}`}>Shopping</button>
        </div>
        {tab === "music" ? <MusicTab userId={userId} /> : <ShoppingTab userId={userId} />}
      </div>
    </div>
  );
}
