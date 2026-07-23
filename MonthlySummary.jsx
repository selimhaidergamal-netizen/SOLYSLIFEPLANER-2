import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

/*
  SLP — Monthly Summary Report (LIVE Supabase version)
  --------------------------------------------------------
  Drop in alongside SLPAuth.real.jsx. Pass the signed-in userId as a prop
  (you already have this from SLPAuthFlow's onReady callback).

  WHAT THIS NEEDS FROM YOUR APP:
  1. Call `startSession(userId)` right after sign-in (writes an
     activity_sessions row with started_at = now()).
  2. Call `endSession(userId)` on sign-out / tab close (updates that row's
     ended_at). A `beforeunload` listener is wired below as a fallback.
  Both helpers are exported from this file.

  WHAT IT SHOWS:
  - Spending for the month vs. allowance, by account
  - Habit clean-day rate per tracked habit
  - Average sleep + nights under a healthy threshold
  - Self-care routine completion rate
  - Session pattern flags: average login hour, late-night logins,
    short sessions (the "logging in too late / out too early" ask)
*/

const supabase = createClient(
  "https://drydmrgxwdaaobbfyrzu.supabase.co",
  "sb_publishable_a8gQAmzXtLlv0nVNIvhXlQ_bsNN3t-_"
);

const LATE_LOGIN_HOUR = 23;
const SHORT_SESSION_MINUTES = 3;
const LOW_SLEEP_HOURS = 6;

export async function startSession(userId) {
  const { data } = await supabase
    .from("activity_sessions")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (data?.id) sessionStorage.setItem("slp_session_id", data.id);
  return data?.id;
}

export async function endSession() {
  const id = sessionStorage.getItem("slp_session_id");
  if (!id) return;
  await supabase.from("activity_sessions").update({ ended_at: new Date().toISOString() }).eq("id", id);
  sessionStorage.removeItem("slp_session_id");
}

function monthBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString(), label: start.toLocaleString("en-US", { month: "long", year: "numeric" }) };
}

async function buildSummary(userId) {
  const { start, end, label } = monthBounds();

  const [{ data: txns }, { data: habitLogs }, { data: habits }, { data: sleep }, { data: selfcare }, { data: sessions }] = await Promise.all([
    supabase.from("transactions").select("amount, category, occurred_at").eq("user_id", userId).gte("occurred_at", start).lt("occurred_at", end),
    supabase.from("habit_logs").select("habit_id, status, logged_date").eq("user_id", userId).gte("logged_date", start).lt("logged_date", end),
    supabase.from("habits").select("id, name").eq("user_id", userId),
    supabase.from("sleep_logs").select("hours, log_date").eq("user_id", userId).gte("log_date", start).lt("log_date", end),
    supabase.from("selfcare_logs").select("done, log_date").eq("user_id", userId).gte("log_date", start).lt("log_date", end),
    supabase.from("activity_sessions").select("started_at, ended_at").eq("user_id", userId).gte("started_at", start).lt("started_at", end),
  ]);

  const totalSpent = (txns || []).reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const byCategory = {};
  (txns || []).forEach((t) => {
    const cat = t.category || "Uncategorized";
    byCategory[cat] = (byCategory[cat] || 0) + Math.abs(Number(t.amount));
  });
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  const habitNameById = Object.fromEntries((habits || []).map((h) => [h.id, h.name]));
  const habitStats = {};
  (habitLogs || []).forEach((l) => {
    const name = habitNameById[l.habit_id] || "Habit";
    habitStats[name] = habitStats[name] || { clean: 0, total: 0 };
    habitStats[name].total += 1;
    if (l.status === "clean") habitStats[name].clean += 1;
  });
  const habitSummaries = Object.entries(habitStats).map(([name, s]) => ({
    name,
    cleanPct: s.total ? Math.round((s.clean / s.total) * 100) : 0,
  }));

  const sleepHours = (sleep || []).map((s) => Number(s.hours)).filter((h) => !isNaN(h));
  const avgSleep = sleepHours.length ? sleepHours.reduce((a, b) => a + b, 0) / sleepHours.length : null;
  const lowSleepNights = sleepHours.filter((h) => h < LOW_SLEEP_HOURS).length;

  const selfcareDone = (selfcare || []).filter((s) => s.done).length;
  const selfcareRate = selfcare?.length ? Math.round((selfcareDone / selfcare.length) * 100) : null;

  const loginHours = (sessions || []).map((s) => new Date(s.started_at).getHours());
  const lateLogins = loginHours.filter((h) => h >= LATE_LOGIN_HOUR || h < 4).length;
  const avgLoginHour = loginHours.length ? loginHours.reduce((a, b) => a + b, 0) / loginHours.length : null;

  const sessionLengths = (sessions || [])
    .filter((s) => s.ended_at)
    .map((s) => (new Date(s.ended_at) - new Date(s.started_at)) / 60000);
  const shortSessions = sessionLengths.filter((m) => m < SHORT_SESSION_MINUTES).length;

  const flags = [];
  if (lateLogins >= 5) flags.push(`You logged in late at night (${LATE_LOGIN_HOUR}:00 or after) on ${lateLogins} day${lateLogins === 1 ? "" : "s"} this month.`);
  if (shortSessions >= 5) flags.push(`${shortSessions} of your sessions lasted under ${SHORT_SESSION_MINUTES} minutes — logging out almost as soon as you log in.`);
  if (avgSleep !== null && avgSleep < LOW_SLEEP_HOURS) flags.push(`Average sleep this month was ${avgSleep.toFixed(1)}h, under the ${LOW_SLEEP_HOURS}h mark.`);
  if (lowSleepNights >= 8) flags.push(`${lowSleepNights} nights this month were under ${LOW_SLEEP_HOURS} hours of sleep.`);
  habitSummaries.forEach((h) => {
    if (h.cleanPct < 50) flags.push(`${h.name}: only ${h.cleanPct}% clean days this month.`);
  });

  return {
    label, totalSpent, topCategory, habitSummaries,
    avgSleep, lowSleepNights, selfcareRate,
    avgLoginHour, lateLogins, shortSessions,
    sessionCount: sessions?.length || 0,
    flags,
  };
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
      <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="text-zinc-100 text-xl font-semibold">{value}</p>
      {sub && <p className="text-zinc-600 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

export default function MonthlySummary({ userId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    buildSummary(userId).then((s) => {
      setSummary(s);
      setLoading(false);
    });
  }, [userId]);

  if (loading) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-600 text-sm">Building your summary...</div>;
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <p className="text-amber-500/70 text-xs uppercase tracking-widest mb-1">Monthly summary</p>
        <h1 className="text-zinc-100 text-2xl font-semibold mb-8">{summary.label}</h1>

        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatCard label="Spent this month" value={`${summary.totalSpent.toLocaleString()} EGP`} sub={summary.topCategory ? `Top: ${summary.topCategory[0]}` : undefined} />
          <StatCard label="Avg sleep" value={summary.avgSleep !== null ? `${summary.avgSleep.toFixed(1)}h` : "—"} sub={summary.lowSleepNights ? `${summary.lowSleepNights} nights under 6h` : undefined} />
          <StatCard label="Self-care rate" value={summary.selfcareRate !== null ? `${summary.selfcareRate}%` : "—"} />
          <StatCard label="Sessions logged" value={summary.sessionCount} sub={summary.avgLoginHour !== null ? `avg login ~${Math.round(summary.avgLoginHour)}:00` : undefined} />
        </div>

        {summary.habitSummaries.length > 0 && (
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 mb-6">
            <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Habits</p>
            <div className="space-y-2">
              {summary.habitSummaries.map((h) => (
                <div key={h.name} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{h.name}</span>
                  <span className={h.cleanPct >= 70 ? "text-amber-400" : "text-zinc-500"}>{h.cleanPct}% clean</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
          <p className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Flagged this month</p>
          {summary.flags.length === 0 ? (
            <p className="text-zinc-400 text-sm">Nothing stood out — a clean month.</p>
          ) : (
            <ul className="space-y-2">
              {summary.flags.map((f, i) => (
                <li key={i} className="text-sm text-zinc-300 flex gap-2">
                  <span className="text-amber-400">·</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
