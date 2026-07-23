import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

/*
  SLP — Auth + First-Login Deep Intake (LIVE Supabase version)
  --------------------------------------------------------------
  Drop this into your project alongside your existing dashboard code.
  Requires: npm install @supabase/supabase-js

  Schema this expects (already applied to your project):
    public.profiles          + username (text, unique ci), onboarded (bool)
    public.intake_responses  (user_id pk, call_name, schedule_note,
                               habits text[], mood, priorities text[], goal)

  The anon/publishable key below is safe to ship in client code by design —
  it can only do what your Row Level Security policies allow, and every
  table here is RLS-scoped to auth.uid() = user_id / id.
*/

const supabase = createClient(
  "https://drydmrgxwdaaobbfyrzu.supabase.co",
  "sb_publishable_a8gQAmzXtLlv0nVNIvhXlQ_bsNN3t-_"
);

const SHADOW_DOMAIN = "slp.internal";
const toShadowEmail = (username) => `${username.trim().toLowerCase()}@${SHADOW_DOMAIN}`;

const INTAKE_STEPS = [
  { key: "call_name", title: "What should Emi call you?", subtitle: "A name or nickname is fine.", type: "text", placeholder: "e.g. Soly" },
  { key: "age", title: "How old are you?", subtitle: "This helps tune suggestions to your life stage.", type: "text", placeholder: "e.g. 27" },
  { key: "schedule_note", title: "What does a typical day look like?", subtitle: "Roughly when do you wake up and go to sleep?", type: "text", placeholder: "e.g. up at 9am, sleep around 2am" },
  { key: "habits", title: "Any habits you want to track or work on?", subtitle: "Pick any that apply — you can refine this later.", type: "multi", options: ["Smoking", "Vaping", "Screen time", "Late nights", "Skipping meals", "Overspending", "None of these"] },
  { key: "mood", title: "How would you describe most of your days lately?", subtitle: "Be honest — this just helps Emi read your check-ins right.", type: "single", options: ["Mostly good", "Up and down", "Pretty drained", "Stressed", "Numb / just getting through it"] },
  { key: "priorities", title: "What matters most to you right now?", subtitle: "Pick up to three — SLP will surface these first.", type: "multi", options: ["Finance", "Health & sleep", "Career", "Hobbies", "Relationships", "Habits & self-control"] },
  { key: "goal", title: "What's the one thing you'd love SLP to help you fix or build?", subtitle: "One sentence is enough.", type: "text", placeholder: "e.g. actually save money and quit vaping" },
];

function GridBackdrop() {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage:
          "linear-gradient(rgba(217,164,65,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(217,164,65,0.05) 1px, transparent 1px)",
        backgroundSize: "36px 36px",
      }}
    />
  );
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername || !password) {
      setError("Enter a username and password.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password should be at least 6 characters.");
      return;
    }
    setBusy(true);
    const shadowEmail = toShadowEmail(cleanUsername);

    if (mode === "signup") {
      const { data: existing } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", cleanUsername)
        .maybeSingle();

      if (existing) {
        setBusy(false);
        setError("That username is taken.");
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: shadowEmail,
        password,
      });

      if (signUpError) {
        setBusy(false);
        setError(signUpError.message);
        return;
      }

      await supabase.from("profiles").insert({
        id: data.user.id,
        username: cleanUsername,
        onboarded: false,
      });

      setBusy(false);
      onAuthed({ userId: data.user.id, username: cleanUsername, isNewUser: true });
    } else {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: shadowEmail,
        password,
      });

      if (signInError) {
        setBusy(false);
        setError("Wrong username or password.");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarded")
        .eq("id", data.user.id)
        .single();

      setBusy(false);
      onAuthed({
        userId: data.user.id,
        username: cleanUsername,
        isNewUser: !profile?.onboarded,
      });
    }
  };

  return (
    <div className="relative min-h-screen bg-zinc-950 flex items-center justify-center px-4 overflow-hidden">
      <GridBackdrop />
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-amber-500/40 mb-4">
            <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)]" />
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100 tracking-tight">SLP</h1>
          <p className="text-zinc-500 text-sm mt-1">Every part of your life, watched over.</p>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 backdrop-blur">
          <div className="flex mb-6 rounded-lg bg-zinc-950 border border-zinc-800 p-1">
            <button onClick={() => setMode("signin")} className={`flex-1 text-sm py-1.5 rounded-md transition ${mode === "signin" ? "bg-zinc-800 text-amber-400" : "text-zinc-500"}`}>Sign in</button>
            <button onClick={() => setMode("signup")} className={`flex-1 text-sm py-1.5 rounded-md transition ${mode === "signup" ? "bg-zinc-800 text-amber-400" : "text-zinc-500"}`}>Create account</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1.5">Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60 focus:border-amber-500/60" placeholder="soly" autoComplete="username" />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60 focus:border-amber-500/60" placeholder="••••••••" autoComplete={mode === "signup" ? "new-password" : "current-password"} />
            </div>

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <button type="submit" disabled={busy} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-zinc-950 font-medium text-sm rounded-lg py-2.5 transition">
              {busy ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-center text-zinc-600 text-xs mt-6">Anyone with the link can create their own account — your data stays yours.</p>
      </div>
    </div>
  );
}

function IntakeScreen({ userId, onComplete }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const current = INTAKE_STEPS[step];
  const isLast = step === INTAKE_STEPS.length - 1;

  const setAnswer = (val) => setAnswers((a) => ({ ...a, [current.key]: val }));
  const toggleMulti = (opt) => {
    const list = answers[current.key] || [];
    setAnswer(list.includes(opt) ? list.filter((o) => o !== opt) : [...list, opt]);
  };
  const canAdvance = () => {
    const v = answers[current.key];
    if (current.type === "multi") return true;
    if (current.type === "single") return !!v;
    return !!(v && v.trim());
  };

  const finish = async () => {
    setSaving(true);
    const { age, ...intakeFields } = answers;
    await supabase.from("intake_responses").insert({ user_id: userId, ...intakeFields });
    await supabase
      .from("profiles")
      .update({ onboarded: true, age: age ? parseInt(age, 10) : null, name: answers.call_name })
      .eq("id", userId);
    setSaving(false);
    onComplete(answers);
  };

  const next = () => (isLast ? finish() : setStep((s) => s + 1));

  return (
    <div className="relative min-h-screen bg-zinc-950 flex items-center justify-center px-4 overflow-hidden">
      <GridBackdrop />
      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-1.5 mb-8 justify-center">
          {INTAKE_STEPS.map((_, i) => (
            <div key={i} className={`h-1 rounded-full transition-all ${i === step ? "w-8 bg-amber-400" : i < step ? "w-4 bg-amber-500/40" : "w-4 bg-zinc-800"}`} />
          ))}
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-7">
          <p className="text-amber-500/70 text-xs uppercase tracking-widest mb-2">Getting to know you · {step + 1} / {INTAKE_STEPS.length}</p>
          <h2 className="text-zinc-100 text-lg font-medium mb-1">{current.title}</h2>
          <p className="text-zinc-500 text-sm mb-6">{current.subtitle}</p>

          {current.type === "text" && (
            <input value={answers[current.key] || ""} onChange={(e) => setAnswer(e.target.value)} placeholder={current.placeholder} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/60 focus:border-amber-500/60" autoFocus />
          )}

          {current.type === "single" && (
            <div className="space-y-2">
              {current.options.map((opt) => (
                <button key={opt} onClick={() => setAnswer(opt)} className={`w-full text-left text-sm rounded-lg px-3 py-2.5 border transition ${answers[current.key] === opt ? "border-amber-500/60 bg-amber-500/10 text-amber-300" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700"}`}>{opt}</button>
              ))}
            </div>
          )}

          {current.type === "multi" && (
            <div className="flex flex-wrap gap-2">
              {current.options.map((opt) => {
                const active = (answers[current.key] || []).includes(opt);
                return (
                  <button key={opt} onClick={() => toggleMulti(opt)} className={`text-sm rounded-full px-3.5 py-1.5 border transition ${active ? "border-amber-500/60 bg-amber-500/10 text-amber-300" : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700"}`}>{opt}</button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between mt-8">
            <button onClick={() => step > 0 && setStep((s) => s - 1)} className={`text-sm text-zinc-500 hover:text-zinc-300 transition ${step === 0 ? "invisible" : ""}`}>Back</button>
            <button onClick={next} disabled={!canAdvance() || saving} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-medium text-sm rounded-lg px-5 py-2 transition">
              {saving ? "Saving..." : isLast ? "Enter SLP" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SLPAuthFlow({ onReady }) {
  const [stage, setStage] = useState("checking");
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setStage("auth");
        return;
      }
      const userId = data.session.user.id;
      const { data: profile } = await supabase.from("profiles").select("username, onboarded").eq("id", userId).single();
      setSession({ userId, username: profile?.username });
      setStage(profile?.onboarded ? "app" : "intake");
    });
  }, []);

  const handleAuthed = ({ userId, username, isNewUser }) => {
    setSession({ userId, username });
    setStage(isNewUser ? "intake" : "app");
  };

  const handleIntakeComplete = () => setStage("app");

  if (stage === "checking") {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-600 text-sm">Loading...</div>;
  }
  if (stage === "auth") return <AuthScreen onAuthed={handleAuthed} />;
  if (stage === "intake") return <IntakeScreen userId={session.userId} onComplete={handleIntakeComplete} />;

  if (onReady) onReady(session);
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 text-sm">
      Signed in as {session.username}. Render your dashboard here.
    </div>
  );
}
