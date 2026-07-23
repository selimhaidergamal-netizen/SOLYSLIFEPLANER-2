/* ============================================================
   SLP — your own Jarvis
   Single-file app logic: auth, intake, dashboard sections,
   monthly summary, and Emi (Gemini brain + ElevenLabs voice).
   ============================================================ */

const SUPABASE_URL = "https://drydmrgxwdaaobbfyrzu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_a8gQAmzXtLlv0nVNIvhXlQ_bsNN3t-_";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SHADOW_DOMAIN = "slp.internal";
const toShadowEmail = (u) => `${u.trim().toLowerCase()}@${SHADOW_DOMAIN}`;

let state = {
  userId: null,
  username: null,
  currentSection: "overview",
  emiMessages: [],
};

/* ---------------- Screen helpers ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showScreen(id) {
  ["screen-auth", "screen-intake", "screen-app"].forEach((s) => {
    $("#" + s).classList.toggle("hidden", s !== id);
  });
}
function showLoading(on) {
  $("#loading-veil").classList.toggle("hidden", !on);
}

/* ================= AUTH ================= */
let authMode = "signin";

$("#tab-signin").addEventListener("click", () => setAuthMode("signin"));
$("#tab-signup").addEventListener("click", () => setAuthMode("signup"));

function setAuthMode(mode) {
  authMode = mode;
  $("#tab-signin").classList.toggle("active", mode === "signin");
  $("#tab-signup").classList.toggle("active", mode === "signup");
  $("#auth-submit").textContent = mode === "signin" ? "Sign in" : "Create account";
  $("#auth-error").textContent = "";
}

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const usernameRaw = $("#auth-username").value.trim();
  const username = usernameRaw.toLowerCase();
  const password = $("#auth-password").value;
  const errEl = $("#auth-error");
  errEl.textContent = "";

  if (!username || !password) { errEl.textContent = "Enter a username and password."; return; }
  if (authMode === "signup" && password.length < 6) { errEl.textContent = "Password should be at least 6 characters."; return; }

  $("#auth-submit").disabled = true;
  const shadowEmail = toShadowEmail(username);

  try {
    if (authMode === "signup") {
      const { data: existing } = await sb.from("profiles").select("id").ilike("username", username).maybeSingle();
      if (existing) { errEl.textContent = "That username is taken."; $("#auth-submit").disabled = false; return; }

      const { data, error } = await sb.auth.signUp({ email: shadowEmail, password });
      if (error) throw error;

      await sb.from("profiles").insert({ id: data.user.id, username, onboarded: false, currency: "EGP" });
      await enterApp(data.user.id, username, true);
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email: shadowEmail, password });
      if (error) throw new Error("Wrong username or password.");

      const { data: profile } = await sb.from("profiles").select("onboarded").eq("id", data.user.id).single();
      await enterApp(data.user.id, username, !profile?.onboarded);
    }
  } catch (err) {
    errEl.textContent = err.message || "Something went wrong.";
  } finally {
    $("#auth-submit").disabled = false;
  }
});

$("#signout-btn").addEventListener("click", async () => {
  await endSession();
  await sb.auth.signOut();
  state = { userId: null, username: null, currentSection: "overview", emiMessages: [] };
  showScreen("screen-auth");
});

async function enterApp(userId, username, needsIntake) {
  state.userId = userId;
  state.username = username;
  if (needsIntake) {
    startIntake();
  } else {
    await startSession();
    $("#sidebar-name").textContent = username;
    showScreen("screen-app");
    renderSection("overview");
  }
}

/* ================= SESSION TRACKING ================= */
async function startSession() {
  const { data } = await sb.from("activity_sessions").insert({ user_id: state.userId }).select("id").single();
  if (data?.id) sessionStorage.setItem("slp_session_id", data.id);
}
async function endSession() {
  const id = sessionStorage.getItem("slp_session_id");
  if (!id) return;
  await sb.from("activity_sessions").update({ ended_at: new Date().toISOString() }).eq("id", id);
  sessionStorage.removeItem("slp_session_id");
}
window.addEventListener("beforeunload", () => { endSession(); });

/* ================= INTAKE ================= */
const INTAKE_STEPS = [
  { key: "call_name", title: "What should Emi call you?", subtitle: "A name or nickname is fine.", type: "text", placeholder: "e.g. Soly" },
  { key: "age", title: "How old are you?", subtitle: "This helps tune suggestions to your life stage.", type: "text", placeholder: "e.g. 27" },
  { key: "schedule_note", title: "What does a typical day look like?", subtitle: "Roughly when do you wake up and go to sleep?", type: "text", placeholder: "e.g. up at 9am, sleep around 2am" },
  { key: "habits", title: "Any habits you want to track or work on?", subtitle: "Pick any that apply — you can refine this later.", type: "multi", options: ["Smoking", "Vaping", "Screen time", "Late nights", "Skipping meals", "Overspending", "None of these"] },
  { key: "mood", title: "How would you describe most of your days lately?", subtitle: "Be honest — this helps Emi read your check-ins right.", type: "single", options: ["Mostly good", "Up and down", "Pretty drained", "Stressed", "Numb / just getting through it"] },
  { key: "priorities", title: "What matters most to you right now?", subtitle: "Pick up to three — SLP will surface these first.", type: "multi", options: ["Finance", "Health & sleep", "Career", "Hobbies", "Relationships", "Habits & self-control"] },
  { key: "goal", title: "What's the one thing you'd love SLP to help you fix or build?", subtitle: "One sentence is enough.", type: "text", placeholder: "e.g. actually save money and quit vaping" },
];
let intakeStep = 0;
let intakeAnswers = {};

function startIntake() {
  intakeStep = 0;
  intakeAnswers = {};
  showScreen("screen-intake");
  renderIntakeStep();
}

function renderIntakeStep() {
  const step = INTAKE_STEPS[intakeStep];
  const dots = $("#intake-dots");
  dots.innerHTML = INTAKE_STEPS.map((_, i) =>
    `<div class="dot ${i === intakeStep ? "active" : i < intakeStep ? "done" : ""}"></div>`
  ).join("");

  $("#intake-progress").textContent = `Getting to know you · ${intakeStep + 1} / ${INTAKE_STEPS.length}`;
  $("#intake-title").textContent = step.title;
  $("#intake-subtitle").textContent = step.subtitle;

  const body = $("#intake-body");
  const val = intakeAnswers[step.key];

  if (step.type === "text") {
    body.innerHTML = `<input id="intake-text" type="text" placeholder="${step.placeholder}" value="${val || ""}" />`;
    $("#intake-text").addEventListener("input", (e) => { intakeAnswers[step.key] = e.target.value; updateIntakeNav(); });
    setTimeout(() => $("#intake-text")?.focus(), 0);
  } else if (step.type === "single") {
    body.innerHTML = step.options.map((opt) =>
      `<button class="opt-btn ${val === opt ? "selected" : ""}" data-opt="${opt}">${opt}</button>`
    ).join("");
    body.querySelectorAll(".opt-btn").forEach((btn) => btn.addEventListener("click", () => {
      intakeAnswers[step.key] = btn.dataset.opt;
      renderIntakeStep();
    }));
  } else if (step.type === "multi") {
    const list = val || [];
    body.innerHTML = `<div class="chip-row">${step.options.map((opt) =>
      `<button class="chip ${list.includes(opt) ? "selected" : ""}" data-opt="${opt}">${opt}</button>`
    ).join("")}</div>`;
    body.querySelectorAll(".chip").forEach((btn) => btn.addEventListener("click", () => {
      const cur = intakeAnswers[step.key] || [];
      intakeAnswers[step.key] = cur.includes(btn.dataset.opt) ? cur.filter((o) => o !== btn.dataset.opt) : [...cur, btn.dataset.opt];
      renderIntakeStep();
    }));
  }

  updateIntakeNav();
}

function updateIntakeNav() {
  const step = INTAKE_STEPS[intakeStep];
  const val = intakeAnswers[step.key];
  const canAdvance = step.type === "multi" ? true : step.type === "single" ? !!val : !!(val && val.trim());
  $("#intake-next").disabled = !canAdvance;
  $("#intake-next").textContent = intakeStep === INTAKE_STEPS.length - 1 ? "Enter SLP" : "Continue";
  $("#intake-back").classList.toggle("invisible", intakeStep === 0);
}

$("#intake-back").addEventListener("click", () => { if (intakeStep > 0) { intakeStep--; renderIntakeStep(); } });
$("#intake-next").addEventListener("click", async () => {
  if (intakeStep < INTAKE_STEPS.length - 1) { intakeStep++; renderIntakeStep(); return; }
  await finishIntake();
});

async function finishIntake() {
  showLoading(true);
  const { age, ...intakeFields } = intakeAnswers;
  await sb.from("intake_responses").insert({ user_id: state.userId, ...intakeFields });
  await sb.from("profiles").update({
    onboarded: true,
    age: age ? parseInt(age, 10) : null,
    name: intakeAnswers.call_name,
  }).eq("id", state.userId);

  await startSession();
  $("#sidebar-name").textContent = intakeAnswers.call_name || state.username;
  showLoading(false);
  showScreen("screen-app");
  renderSection("overview");
}

/* ================= NAV ================= */
$$(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderSection(btn.dataset.section);
  });
});

function renderSection(name) {
  state.currentSection = name;
  const root = $("#content-root");
  root.innerHTML = `<p class="empty-text">Loading...</p>`;
  const renderers = {
    overview: renderOverview,
    finance: renderFinance,
    habits: renderHabits,
    wellness: renderWellness,
    projects: renderProjects,
    career: renderCareer,
    music: renderMusic,
    shopping: renderShopping,
    summary: renderSummary,
    emi: renderEmi,
  };
  (renderers[name] || renderOverview)(root);
}

/* ================= OVERVIEW ================= */
async function renderOverview(root) {
  const [{ data: profile }, { data: accounts }, { data: habits }, { data: sleep }] = await Promise.all([
    sb.from("profiles").select("name, username, age, currency").eq("id", state.userId).single(),
    sb.from("finance_accounts").select("type, balance").eq("user_id", state.userId),
    sb.from("habits").select("id").eq("user_id", state.userId),
    sb.from("sleep_logs").select("hours").eq("user_id", state.userId).order("log_date", { ascending: false }).limit(1),
  ]);

  const totalBalance = (accounts || []).reduce((s, a) => s + Number(a.balance || 0), 0);
  const currency = profile?.currency || "EGP";
  const lastSleep = sleep?.[0]?.hours;

  root.innerHTML = `
    <h1 class="page-title">Welcome back, ${profile?.name || profile?.username || "there"}.</h1>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Total balance</div><div class="stat-value">${totalBalance.toLocaleString()} ${currency}</div></div>
      <div class="stat-card"><div class="stat-label">Habits tracked</div><div class="stat-value">${(habits || []).length}</div></div>
      <div class="stat-card"><div class="stat-label">Last sleep</div><div class="stat-value">${lastSleep != null ? lastSleep + "h" : "—"}</div></div>
    </div>
    <div class="card">
      <h3 class="card-title">Jump to</h3>
      <div class="chip-row">
        <button class="chip" data-nav="finance">Finance</button>
        <button class="chip" data-nav="habits">Habits</button>
        <button class="chip" data-nav="wellness">Sleep &amp; Self-care</button>
        <button class="chip" data-nav="projects">Projects</button>
        <button class="chip" data-nav="career">Career</button>
        <button class="chip" data-nav="music">Music</button>
        <button class="chip" data-nav="shopping">Shopping</button>
        <button class="chip" data-nav="summary">Monthly Summary</button>
        <button class="chip" data-nav="emi">Talk to Emi</button>
      </div>
    </div>
  `;
  root.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", () => {
    $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.section === btn.dataset.nav));
    renderSection(btn.dataset.nav);
  }));
}

/* ================= FINANCE ================= */
async function renderFinance(root) {
  const [{ data: accounts }, { data: txns }] = await Promise.all([
    sb.from("finance_accounts").select("*").eq("user_id", state.userId),
    sb.from("transactions").select("*").eq("user_id", state.userId).order("occurred_at", { ascending: false }).limit(20),
  ]);

  root.innerHTML = `
    <h1 class="page-title">Finance</h1>
    <div class="stat-grid">
      ${(accounts || []).map((a) => `
        <div class="stat-card">
          <div class="stat-label">${a.type}</div>
          <div class="stat-value">${Number(a.balance).toLocaleString()} EGP</div>
          ${a.goal ? `<div class="stat-sub">Goal: ${Number(a.goal).toLocaleString()} EGP</div>` : ""}
        </div>`).join("") || `<p class="empty-text">No accounts yet.</p>`}
    </div>

    <div class="card">
      <h3 class="card-title">Add a transaction</h3>
      <form id="txn-form" class="inline-form">
        <select id="txn-account">${(accounts || []).map((a) => `<option value="${a.id}">${a.type}</option>`).join("")}</select>
        <input id="txn-amount" type="number" step="0.01" placeholder="Amount (EGP)" />
        <input id="txn-category" type="text" placeholder="Category" />
        <input id="txn-note" type="text" placeholder="Note (optional)" />
        <button class="btn-primary" type="submit">Add</button>
      </form>
    </div>

    <div class="card">
      <h3 class="card-title">Recent transactions</h3>
      <div class="row-list">
        ${(txns || []).map((t) => `
          <div class="row-item">
            <span>${t.category || "Uncategorized"}${t.note ? " — " + t.note : ""}</span>
            <span class="muted">${Number(t.amount).toLocaleString()} EGP · ${new Date(t.occurred_at).toLocaleDateString()}</span>
          </div>`).join("") || `<p class="empty-text">No transactions yet.</p>`}
      </div>
    </div>
  `;

  $("#txn-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = parseFloat($("#txn-amount").value);
    if (!amount) return;
    await sb.from("transactions").insert({
      user_id: state.userId,
      account_id: $("#txn-account").value || null,
      amount,
      category: $("#txn-category").value.trim() || null,
      note: $("#txn-note").value.trim() || null,
    });
    renderFinance(root);
  });
}

/* ================= HABITS ================= */
async function renderHabits(root) {
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: habits }, { data: logs }] = await Promise.all([
    sb.from("habits").select("*").eq("user_id", state.userId),
    sb.from("habit_logs").select("*").eq("user_id", state.userId).eq("logged_date", today),
  ]);
  const logByHabit = Object.fromEntries((logs || []).map((l) => [l.habit_id, l.status]));

  root.innerHTML = `
    <h1 class="page-title">Habits</h1>
    <div class="card">
      <h3 class="card-title">Add a habit</h3>
      <form id="habit-form" class="inline-form">
        <input id="habit-name" type="text" placeholder="Habit name" />
        <select id="habit-kind">
          <option value="build">Build (want to do more)</option>
          <option value="break">Break (want to do less)</option>
        </select>
        <button class="btn-primary" type="submit">Add</button>
      </form>
    </div>

    <div class="card">
      <h3 class="card-title">Today</h3>
      <div class="row-list">
        ${(habits || []).map((h) => `
          <div class="row-item">
            <span>${h.name} <span class="pill">${h.kind}</span></span>
            <span>
              <button class="link-btn" data-habit="${h.id}" data-status="clean">Clean</button>
              &nbsp;·&nbsp;
              <button class="link-btn muted" data-habit="${h.id}" data-status="slipped">Slipped</button>
              &nbsp;<span class="pill ${logByHabit[h.id] === "clean" ? "amber" : ""}">${logByHabit[h.id] || "not logged"}</span>
            </span>
          </div>`).join("") || `<p class="empty-text">No habits yet — add one above.</p>`}
      </div>
    </div>
  `;

  $("#habit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#habit-name").value.trim();
    if (!name) return;
    await sb.from("habits").insert({ user_id: state.userId, name, kind: $("#habit-kind").value });
    renderHabits(root);
  });

  root.querySelectorAll("[data-habit]").forEach((btn) => btn.addEventListener("click", async () => {
    await sb.from("habit_logs").upsert(
      { user_id: state.userId, habit_id: btn.dataset.habit, logged_date: today, status: btn.dataset.status },
      { onConflict: "habit_id,logged_date" }
    );
    renderHabits(root);
  }));
}

/* ================= WELLNESS (sleep + self-care) ================= */
async function renderWellness(root) {
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: sleep }, { data: selfcare }] = await Promise.all([
    sb.from("sleep_logs").select("*").eq("user_id", state.userId).order("log_date", { ascending: false }).limit(10),
    sb.from("selfcare_logs").select("*").eq("user_id", state.userId).order("log_date", { ascending: false }).limit(10),
  ]);

  root.innerHTML = `
    <h1 class="page-title">Sleep &amp; Self-care</h1>

    <div class="card">
      <h3 class="card-title">Log tonight's sleep</h3>
      <form id="sleep-form" class="inline-form">
        <input id="sleep-hours" type="number" step="0.1" placeholder="Hours" />
        <button class="btn-primary" type="submit">Log</button>
      </form>
      <div class="row-list">
        ${(sleep || []).map((s) => `<div class="row-item"><span>${s.log_date}</span><span class="muted">${s.hours}h</span></div>`).join("") || `<p class="empty-text">No sleep logged yet.</p>`}
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">Log a self-care routine</h3>
      <form id="selfcare-form" class="inline-form">
        <input id="selfcare-routine" type="text" placeholder="e.g. skincare, stretching" />
        <button class="btn-primary" type="submit">Mark done</button>
      </form>
      <div class="row-list">
        ${(selfcare || []).map((s) => `<div class="row-item"><span>${s.routine}</span><span class="muted">${s.log_date}</span></div>`).join("") || `<p class="empty-text">Nothing logged yet.</p>`}
      </div>
    </div>
  `;

  $("#sleep-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const hours = parseFloat($("#sleep-hours").value);
    if (!hours) return;
    await sb.from("sleep_logs").upsert({ user_id: state.userId, log_date: today, hours }, { onConflict: "user_id,log_date" });
    renderWellness(root);
  });

  $("#selfcare-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const routine = $("#selfcare-routine").value.trim();
    if (!routine) return;
    await sb.from("selfcare_logs").insert({ user_id: state.userId, log_date: today, routine, done: true });
    renderWellness(root);
  });
}

/* ================= PROJECTS ================= */
async function renderProjects(root) {
  const { data: projects } = await sb.from("projects").select("*").eq("user_id", state.userId).order("created_at", { ascending: false });

  root.innerHTML = `
    <h1 class="page-title">Projects &amp; Ideas</h1>
    <div class="card">
      <h3 class="card-title">New project</h3>
      <form id="project-form" class="inline-form">
        <input id="project-title" type="text" placeholder="Project idea" />
        <button class="btn-primary" type="submit">Add</button>
      </form>
    </div>
    <div class="card">
      <h3 class="card-title">All projects</h3>
      <div class="row-list">
        ${(projects || []).map((p) => `
          <div class="row-item">
            <span>${p.title}</span>
            <span><span class="pill ${p.status === "active" ? "amber" : ""}">${p.status}</span></span>
          </div>`).join("") || `<p class="empty-text">No projects yet.</p>`}
      </div>
    </div>
  `;

  $("#project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#project-title").value.trim();
    if (!title) return;
    await sb.from("projects").insert({ user_id: state.userId, title, status: "active" });
    renderProjects(root);
  });
}

/* ================= CAREER ================= */
async function renderCareer(root) {
  const [{ data: career }, { data: jobs }] = await Promise.all([
    sb.from("career_profile").select("*").eq("user_id", state.userId).maybeSingle(),
    sb.from("job_matches").select("*").eq("user_id", state.userId).order("found_at", { ascending: false }).limit(15),
  ]);

  root.innerHTML = `
    <h1 class="page-title">Career</h1>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">LinkedIn strength</div><div class="stat-value">${career?.linkedin_strength != null ? career.linkedin_strength + "%" : "—"}</div></div>
      <div class="stat-card"><div class="stat-label">Resume updated</div><div class="stat-value">${career?.resume_updated_at || "—"}</div></div>
    </div>
    <div class="card">
      <h3 class="card-title">Job matches</h3>
      <div class="row-list">
        ${(jobs || []).map((j) => `
          <div class="row-item">
            <span>${j.url ? `<a href="${j.url}" target="_blank" rel="noreferrer">${j.title}</a>` : j.title} — ${j.company}</span>
            <span class="pill amber">${j.match_pct}% match</span>
          </div>`).join("") || `<p class="empty-text">No job matches yet.</p>`}
      </div>
    </div>
  `;
}

/* ================= MUSIC ================= */
async function renderMusic(root) {
  const { data: entries } = await sb.from("music_log").select("*").eq("user_id", state.userId).order("logged_at", { ascending: false }).limit(30);

  root.innerHTML = `
    <h1 class="page-title">Music</h1>
    <div class="card">
      <form id="music-form" class="inline-form">
        <input id="music-title" type="text" placeholder="Track" />
        <input id="music-artist" type="text" placeholder="Artist" />
        <input id="music-note" type="text" placeholder="Note (optional)" />
        <button class="btn-primary" type="submit">Add</button>
      </form>
      <div class="row-list">
        ${(entries || []).map((e) => `
          <div class="row-item">
            <span>${e.title}${e.artist ? " — " + e.artist : ""}</span>
            <span class="muted">${new Date(e.logged_at).toLocaleDateString()}</span>
          </div>`).join("") || `<p class="empty-text">Nothing logged yet.</p>`}
      </div>
    </div>
  `;

  $("#music-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#music-title").value.trim();
    if (!title) return;
    await sb.from("music_log").insert({
      user_id: state.userId,
      title,
      artist: $("#music-artist").value.trim() || null,
      note: $("#music-note").value.trim() || null,
    });
    renderMusic(root);
  });
}

/* ================= SHOPPING ================= */
async function renderShopping(root) {
  const { data: items } = await sb.from("shopping_items").select("*").eq("user_id", state.userId).order("created_at", { ascending: false });
  const wanted = (items || []).filter((i) => i.status === "wanted");
  const bought = (items || []).filter((i) => i.status === "bought");

  root.innerHTML = `
    <h1 class="page-title">Shopping</h1>
    <div class="card">
      <form id="shop-form" class="inline-form">
        <input id="shop-item" type="text" placeholder="Item" />
        <input id="shop-price" type="number" step="0.01" placeholder="Price (EGP)" />
        <input id="shop-url" type="url" placeholder="Link (optional)" />
        <button class="btn-primary" type="submit">Add</button>
      </form>

      <h3 class="card-title" style="margin-top:16px">Wanted</h3>
      <div class="row-list">
        ${wanted.map((i) => `
          <div class="row-item">
            <span>${i.url ? `<a href="${i.url}" target="_blank" rel="noreferrer">${i.item}</a>` : i.item}${i.price != null ? " — " + Number(i.price).toLocaleString() + " EGP" : ""}</span>
            <button class="link-btn" data-toggle="${i.id}">Mark bought</button>
          </div>`).join("") || `<p class="empty-text">Nothing on the list.</p>`}
      </div>

      ${bought.length ? `
      <h3 class="card-title" style="margin-top:16px">Bought</h3>
      <div class="row-list">
        ${bought.map((i) => `
          <div class="row-item">
            <span class="strike">${i.item}</span>
            <button class="link-btn muted" data-toggle="${i.id}">Undo</button>
          </div>`).join("")}
      </div>` : ""}
    </div>
  `;

  $("#shop-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const item = $("#shop-item").value.trim();
    if (!item) return;
    await sb.from("shopping_items").insert({
      user_id: state.userId,
      item,
      price: $("#shop-price").value ? parseFloat($("#shop-price").value) : null,
      url: $("#shop-url").value.trim() || null,
    });
    renderShopping(root);
  });

  root.querySelectorAll("[data-toggle]").forEach((btn) => btn.addEventListener("click", async () => {
    const row = items.find((i) => i.id === btn.dataset.toggle);
    await sb.from("shopping_items").update({ status: row.status === "bought" ? "wanted" : "bought" }).eq("id", row.id);
    renderShopping(root);
  }));
}

/* ================= MONTHLY SUMMARY ================= */
const LATE_LOGIN_HOUR = 23;
const SHORT_SESSION_MINUTES = 3;
const LOW_SLEEP_HOURS = 6;

function monthBounds(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString(), label: start.toLocaleString("en-US", { month: "long", year: "numeric" }) };
}

async function renderSummary(root) {
  root.innerHTML = `<h1 class="page-title">Monthly Summary</h1><p class="empty-text">Building your summary...</p>`;
  const { start, end, label } = monthBounds();

  const [{ data: txns }, { data: habitLogs }, { data: habits }, { data: sleep }, { data: selfcare }, { data: sessions }] = await Promise.all([
    sb.from("transactions").select("amount, category, occurred_at").eq("user_id", state.userId).gte("occurred_at", start).lt("occurred_at", end),
    sb.from("habit_logs").select("habit_id, status, logged_date").eq("user_id", state.userId).gte("logged_date", start).lt("logged_date", end),
    sb.from("habits").select("id, name").eq("user_id", state.userId),
    sb.from("sleep_logs").select("hours, log_date").eq("user_id", state.userId).gte("log_date", start).lt("log_date", end),
    sb.from("selfcare_logs").select("done, log_date").eq("user_id", state.userId).gte("log_date", start).lt("log_date", end),
    sb.from("activity_sessions").select("started_at, ended_at").eq("user_id", state.userId).gte("started_at", start).lt("started_at", end),
  ]);

  const totalSpent = (txns || []).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const byCategory = {};
  (txns || []).forEach((t) => { const c = t.category || "Uncategorized"; byCategory[c] = (byCategory[c] || 0) + Math.abs(Number(t.amount)); });
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  const habitNameById = Object.fromEntries((habits || []).map((h) => [h.id, h.name]));
  const habitStats = {};
  (habitLogs || []).forEach((l) => {
    const name = habitNameById[l.habit_id] || "Habit";
    habitStats[name] = habitStats[name] || { clean: 0, total: 0 };
    habitStats[name].total += 1;
    if (l.status === "clean") habitStats[name].clean += 1;
  });
  const habitSummaries = Object.entries(habitStats).map(([name, s]) => ({ name, cleanPct: s.total ? Math.round((s.clean / s.total) * 100) : 0 }));

  const sleepHours = (sleep || []).map((s) => Number(s.hours)).filter((h) => !isNaN(h));
  const avgSleep = sleepHours.length ? sleepHours.reduce((a, b) => a + b, 0) / sleepHours.length : null;
  const lowSleepNights = sleepHours.filter((h) => h < LOW_SLEEP_HOURS).length;

  const selfcareDone = (selfcare || []).filter((s) => s.done).length;
  const selfcareRate = selfcare?.length ? Math.round((selfcareDone / selfcare.length) * 100) : null;

  const loginHours = (sessions || []).map((s) => new Date(s.started_at).getHours());
  const lateLogins = loginHours.filter((h) => h >= LATE_LOGIN_HOUR || h < 4).length;
  const avgLoginHour = loginHours.length ? loginHours.reduce((a, b) => a + b, 0) / loginHours.length : null;

  const sessionLengths = (sessions || []).filter((s) => s.ended_at).map((s) => (new Date(s.ended_at) - new Date(s.started_at)) / 60000);
  const shortSessions = sessionLengths.filter((m) => m < SHORT_SESSION_MINUTES).length;

  const flags = [];
  if (lateLogins >= 5) flags.push(`You logged in late at night (${LATE_LOGIN_HOUR}:00 or after) on ${lateLogins} day${lateLogins === 1 ? "" : "s"} this month.`);
  if (shortSessions >= 5) flags.push(`${shortSessions} of your sessions lasted under ${SHORT_SESSION_MINUTES} minutes — logging out almost as soon as you log in.`);
  if (avgSleep !== null && avgSleep < LOW_SLEEP_HOURS) flags.push(`Average sleep this month was ${avgSleep.toFixed(1)}h, under the ${LOW_SLEEP_HOURS}h mark.`);
  if (lowSleepNights >= 8) flags.push(`${lowSleepNights} nights this month were under ${LOW_SLEEP_HOURS} hours of sleep.`);
  habitSummaries.forEach((h) => { if (h.cleanPct < 50) flags.push(`${h.name}: only ${h.cleanPct}% clean days this month.`); });

  root.innerHTML = `
    <h1 class="page-title">${label}</h1>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Spent this month</div><div class="stat-value">${totalSpent.toLocaleString()} EGP</div>${topCategory ? `<div class="stat-sub">Top: ${topCategory[0]}</div>` : ""}</div>
      <div class="stat-card"><div class="stat-label">Avg sleep</div><div class="stat-value">${avgSleep !== null ? avgSleep.toFixed(1) + "h" : "—"}</div>${lowSleepNights ? `<div class="stat-sub">${lowSleepNights} nights under 6h</div>` : ""}</div>
      <div class="stat-card"><div class="stat-label">Self-care rate</div><div class="stat-value">${selfcareRate !== null ? selfcareRate + "%" : "—"}</div></div>
      <div class="stat-card"><div class="stat-label">Sessions logged</div><div class="stat-value">${sessions?.length || 0}</div>${avgLoginHour !== null ? `<div class="stat-sub">avg login ~${Math.round(avgLoginHour)}:00</div>` : ""}</div>
    </div>

    ${habitSummaries.length ? `
    <div class="card">
      <h3 class="card-title">Habits</h3>
      <div class="row-list">
        ${habitSummaries.map((h) => `<div class="row-item"><span>${h.name}</span><span class="${h.cleanPct >= 70 ? "pill amber" : "pill"}">${h.cleanPct}% clean</span></div>`).join("")}
      </div>
    </div>` : ""}

    <div class="card">
      <h3 class="card-title">Flagged this month</h3>
      ${flags.length === 0 ? `<p class="empty-text">Nothing stood out — a clean month.</p>` : `
      <div class="row-list">
        ${flags.map((f) => `<div class="row-item"><span>${f}</span></div>`).join("")}
      </div>`}
    </div>
  `;
}

/* ================= EMI (voice chat) ================= */
async function renderEmi(root) {
  root.innerHTML = `
    <div class="emi-shell">
      <div class="emi-orb-wrap">
        <div class="emi-orb" id="emi-orb"></div>
        <p class="emi-label">Emi</p>
      </div>
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-input-row">
        <button class="mic-btn" id="mic-btn" title="Voice input">🎤</button>
        <input id="chat-input" type="text" placeholder="Type to Emi..." />
        <button class="btn-primary" id="chat-send">Send</button>
      </div>
    </div>
    <audio id="emi-audio" class="hidden"></audio>
  `;

  const { data: history } = await sb.from("emi_messages").select("*").eq("user_id", state.userId).order("created_at", { ascending: true }).limit(50);
  state.emiMessages = history || [];
  paintChat();

  $("#chat-send").addEventListener("click", sendEmiMessage);
  $("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendEmiMessage(); });

  // Optional voice input via the Web Speech API (browser-dependent; falls back silently)
  const micBtn = $("#mic-btn");
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec) {
    const recognizer = new SpeechRec();
    recognizer.lang = "en-GB";
    recognizer.onresult = (e) => { $("#chat-input").value = e.results[0][0].transcript; sendEmiMessage(); };
    recognizer.onend = () => micBtn.classList.remove("active");
    micBtn.addEventListener("click", () => { micBtn.classList.add("active"); recognizer.start(); });
  } else {
    micBtn.disabled = true;
    micBtn.title = "Voice input not supported in this browser";
  }
}

function paintChat() {
  const log = $("#chat-log");
  if (!log) return;
  log.innerHTML = state.emiMessages.map((m) =>
    `<div class="msg ${m.role === "user" ? "user" : "emi"}">${escapeHtml(m.content)}</div>`
  ).join("");
  log.scrollTop = log.scrollHeight;
}
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function sendEmiMessage() {
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  state.emiMessages.push({ role: "user", content: text });
  paintChat();
  await sb.from("emi_messages").insert({ user_id: state.userId, role: "user", content: text });

  state.emiMessages.push({ role: "emi", content: "…" });
  paintChat();

  const { data: { session } } = await sb.auth.getSession();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/emi-voice-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();

    state.emiMessages.pop(); // remove the "…" placeholder
    const replyText = data.text || "Sorry, I couldn't reach my brain just now.";
    state.emiMessages.push({ role: "emi", content: replyText });
    paintChat();
    await sb.from("emi_messages").insert({ user_id: state.userId, role: "emi", content: replyText });

    if (data.audioBase64) {
      const audioEl = $("#emi-audio");
      const orb = $("#emi-orb");
      audioEl.src = `data:audio/mpeg;base64,${data.audioBase64}`;
      orb.classList.add("speaking");
      audioEl.onended = () => orb.classList.remove("speaking");
      audioEl.play();
    }
  } catch (err) {
    state.emiMessages.pop();
    state.emiMessages.push({ role: "emi", content: "I couldn't reach my brain just now — try again in a moment." });
    paintChat();
  }
}

/* ================= BOOT ================= */
(async function boot() {
  showLoading(true);
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    showLoading(false);
    showScreen("screen-auth");
    return;
  }
  const userId = data.session.user.id;
  const { data: profile } = await sb.from("profiles").select("username, onboarded").eq("id", userId).single();
  showLoading(false);
  await enterApp(userId, profile?.username, !profile?.onboarded);
})();
