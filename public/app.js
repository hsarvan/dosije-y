import { ticketStats, planStats } from "./calc.js";

const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fix = (x) => (Number.isFinite(x) ? x : 0).toFixed(2);
const money = (x, cur) => `${fix(x)} ${esc(cur)}`;
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const signed = (x, cur = "") => `${x >= 0 ? "+" : "−"}${fix(Math.abs(x))}${cur ? " " + esc(cur) : ""}`;
const usd = (x) => `$${(x || 0) < 0.995 ? (x || 0).toFixed(3) : (x || 0).toFixed(2)}`;
const cls = (x) => (x > 0.0001 ? "pos" : x < -0.0001 ? "neg" : "");
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const LEAGUES = [
  "Bundesliga ovaj vikend",
  "Premier liga ovaj vikend",
  "La Liga ovaj vikend",
  "Serie A ovaj vikend",
  "Ligue 1 ovaj vikend",
  "Premijer liga BiH",
  "Superliga Srbije",
  "HNL",
  "Liga prvaka sljedeće kolo",
];
const MODE_HINT = {
  standard: "Opus 5.5 · razmišljanje high · do 12 pretraga · okvirno $0.5–1.5 po kolu",
  ultra: "Opus 5.5 · maksimalno razmišljanje · do 22 pretrage · okvirno $1.5–4 po kolu",
};
const RISKS = ["oprezan", "balansiran", "agresivan"];
const TYPE_LABEL = { pojedinacno: "Pojedinačno", kombinacija: "Kombinacija", sistem: "Sistem" };

// ---------- lokalne postavke (samo udobnost) ----------
const prefs = (() => {
  const d = { bankroll: 100, currency: "KM", risk: "balansiran", mode: "ultra", notes: "" };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem("kolo.prefs") || "{}") };
  } catch {
    return d;
  }
})();
const savePrefs = () => {
  try {
    localStorage.setItem("kolo.prefs", JSON.stringify(prefs));
  } catch {}
};

// ---------- API ----------
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, body: j });
  return j;
}

let S = null;
async function refreshState() {
  S = await api("/api/state");
  const sp = S.spend;
  document.getElementById("spend").innerHTML = `AI <b>${usd(sp.month)}</b>${sp.budget ? ` / $${sp.budget}` : ""} mj.`;
  const bal = Object.entries(S.balance || {});
  document.getElementById("balance").innerHTML = bal.length
    ? "Bilans " + bal.map(([cur, b]) => `<b class="${cls(b.profit)}">${signed(b.profit, cur)}</b>`).join(" · ")
    : "Bilans —";
  return S;
}

// ---------- ruter ----------
let cleanup = null;
async function route() {
  cleanup?.();
  cleanup = null;
  const h = location.hash.slice(1) || "/";
  try {
    await refreshState();
    let m;
    if ((m = h.match(/^\/job\/([\w-]+)/))) return progressView(m[1]);
    if ((m = h.match(/^\/a\/([\w-]+)/))) return await resultView(m[1]);
    homeView();
  } catch (e) {
    $app.innerHTML = `<div class="err">${esc(e.message)}</div><a class="back" href="#/">← Početna</a>`;
  }
}
window.addEventListener("hashchange", route);
route();

// ---------- segmentirani izbor ----------
function seg(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options
    .map(([v, label]) => `<button type="button" data-v="${v}" class="${v === value ? "on" : ""}">${label}</button>`)
    .join("")}</div>`;
}
function bindSeg(root, onChange) {
  root.querySelectorAll(".seg").forEach((el) =>
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      onChange(el.dataset.seg, b.dataset.v);
    }),
  );
}

// ---------- početna ----------
function homeView() {
  const active = S.activeJobId
    ? `<div class="err" style="color:var(--fg);background:var(--soft)">Analiza je u toku. <a href="#/job/${S.activeJobId}">Otvori →</a></div>`
    : "";
  const hist = S.history;
  $app.innerHTML = `
    ${active}
    <form class="ask" id="ask">
      <input class="q" id="q" autocomplete="off" placeholder="Koje kolo? npr. Bundesliga ovaj vikend" value="" />
      <div class="chips">${LEAGUES.map((l) => `<button type="button" class="chip">${esc(l)}</button>`).join("")}</div>
      <div class="row">
        <label class="field">Budžet <input class="num" id="bankroll" type="number" min="1" step="1" value="${esc(prefs.bankroll)}" /></label>
        <select class="sel" id="currency">${["KM", "€", "RSD", "$", "kn"].map((c) => `<option ${c === prefs.currency ? "selected" : ""}>${c}</option>`).join("")}</select>
        ${seg("risk", RISKS.map((r) => [r, r[0].toUpperCase() + r.slice(1)]), prefs.risk)}
      </div>
      <div class="row">
        ${seg("mode", [["standard", "Standard"], ["ultra", "Ultra"]], prefs.mode)}
        <span class="small muted" id="modehint">${MODE_HINT[prefs.mode]}</span>
      </div>
      <input class="note" id="notes" placeholder="Napomena (opciono): npr. bez HT/FT, više golova, izbjegni derbije" value="${esc(prefs.notes)}" />
      <button class="go" id="go" ${S.activeJobId ? "disabled" : ""}>Analiziraj kolo</button>
      ${S.demo ? `<div class="hint">DEMO režim — izmišljeni podaci, bez troška.</div>` : ""}
      <div id="formerr"></div>
    </form>
    ${
      hist.length
        ? `<h2>Kola</h2><div class="list">${hist.map(historyRow).join("")}</div>`
        : `<p class="hint" style="margin-top:28px">Upiši ligu i (opciono) kolo. App istraži raspored, formu, H2H, izostanke i kvote, pa napravi tikete s ulozima.</p>`
    }`;
  const q = document.getElementById("q");
  q.focus();
  $app.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => ((q.value = c.textContent), q.focus())));
  bindSeg($app, (k, v) => {
    prefs[k] = v;
    savePrefs();
    if (k === "mode") document.getElementById("modehint").textContent = MODE_HINT[v];
  });
  document.getElementById("ask").addEventListener("submit", async (e) => {
    e.preventDefault();
    prefs.bankroll = +document.getElementById("bankroll").value || 100;
    prefs.currency = document.getElementById("currency").value;
    prefs.notes = document.getElementById("notes").value;
    savePrefs();
    const btn = document.getElementById("go");
    btn.disabled = true;
    try {
      const { jobId } = await api("/api/analyze", {
        method: "POST",
        body: JSON.stringify({ query: q.value, ...prefs }),
      });
      location.hash = `#/job/${jobId}`;
    } catch (err) {
      if (err.body?.jobId) return void (location.hash = `#/job/${err.body.jobId}`);
      document.getElementById("formerr").innerHTML = `<div class="err">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

function historyRow(h) {
  const title = h.hasPlan ? `${h.league} · ${h.round}` : h.query;
  const sub = [fmtDate(h.createdAt), h.mode === "ultra" ? "Ultra" : "Standard", h.error && !h.hasPlan ? "nedovršeno" : ""]
    .filter(Boolean)
    .join(" · ");
  let pl = "";
  if (h.placed) {
    pl = h.pending
      ? `<div class="muted">${h.pending} na čekanju</div>`
      : `<div class="${cls(h.settledProfit)}">${signed(h.settledProfit, h.currency)}</div>`;
  }
  return `<a class="item" href="#/a/${h.id}">
    <div><div class="t">${esc(title)}${h.demo ? '<span class="demo-badge">DEMO</span>' : ""}</div><div class="small muted">${esc(sub)}</div></div>
    <div class="r"><div class="muted">${usd(h.cost)}</div>${pl}</div></a>`;
}

// ---------- napredak ----------
function progressView(jobId) {
  $app.innerHTML = `
    <a class="back" href="#/">← Početna</a>
    <h1 id="ptitle">Analiziram…</h1>
    <div class="steps">
      <div class="step" id="s1"><i></i>Istraživanje</div>
      <div class="step" id="s2"><i></i>Analiza</div>
      <div class="step" id="s3"><i></i>Tiketi</div>
    </div>
    <ul class="log" id="log"></ul>
    <div class="think" id="think" hidden></div>
    <div class="meter"><span id="cost">Trošak $0.000</span><span id="clock">0:00</span></div>
    <div class="actions"><button class="btn" id="cancel">Prekini</button></div>
    <div id="perr"></div>`;
  const $ = (id) => document.getElementById(id);
  const costs = { research: 0, analysis: 0 };
  let phase = "research";
  let thinkText = "";
  let t0 = null;
  const step = (id, s) => ($(id).className = `step ${s}`);
  const log = (icon, text) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="muted">${{ search: "⌕", fetch: "↗", warn: "!", reuse: "↺" }[icon] || "·"}</span><span>${esc(text)}</span>`;
    $("log").prepend(li);
    while ($("log").children.length > 9) $("log").lastChild.remove();
  };
  const timer = setInterval(() => {
    if (!t0) return;
    const s = Math.floor((Date.now() - t0) / 1000);
    $("clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  let es;
  const connect = () => {
    es = new EventSource(`/api/jobs/${jobId}/stream`);
    es.onmessage = (e) => handle(JSON.parse(e.data));
    es.onerror = async () => {
      es.close();
      await new Promise((r) => setTimeout(r, 1500));
      if (!document.getElementById("log")) return;
      const st = await refreshState().catch(() => null);
      if (st?.activeJobId === jobId) connect();
      else {
        const last = st?.history?.[0];
        location.hash = last ? `#/a/${last.id}` : "#/";
      }
    };
  };
  const handle = (ev) => {
    t0 ??= ev.t;
    if (ev.type === "phase") {
      phase = ev.phase;
      if (ev.phase === "research" && ev.status === "start") {
        step("s1", "on");
        $("ptitle").textContent = "Istražujem kolo…";
      }
      if (ev.phase === "research" && ev.status === "reused") {
        step("s1", "ok");
        log("reuse", `Koristim podatke istražene ${fmtDate(ev.at)} — bez novog troška pretrage`);
      }
      if (ev.phase === "research" && ev.status === "done") step("s1", "ok");
      if (ev.phase === "analysis") {
        step("s1", "ok");
        step("s2", "on");
        $("ptitle").textContent = ev.mode === "ultra" ? "Razmišljam (Ultra)…" : "Razmišljam…";
      }
    } else if (ev.type === "log") log(ev.icon, ev.text);
    else if (ev.type === "thinking") {
      thinkText = (thinkText + ev.text).slice(-1500);
      $("think").hidden = !thinkText.trim();
      $("think").textContent = thinkText.trim();
    } else if (ev.type === "writing") {
      if (phase === "analysis") {
        step("s2", "ok");
        step("s3", "on");
        $("ptitle").textContent = `Pišem tikete… ${ev.chars} zn.`;
      } else $("ptitle").textContent = `Sastavljam dosije… ${ev.chars} zn.`;
    } else if (ev.type === "cost") {
      costs[ev.phase] = ev.cost;
      $("cost").textContent = `Trošak ${usd(costs.research + costs.analysis)}${ev.usage?.searches ? ` · ${ev.usage.searches} pretraga` : ""}`;
    } else if (ev.type === "done") {
      es.close();
      location.hash = `#/a/${ev.analysisId}`;
    } else if (ev.type === "error") {
      es.close();
      $("ptitle").textContent = "Zaustavljeno";
      document.querySelectorAll(".step.on").forEach((s) => (s.className = "step"));
      $("cancel").remove();
      $("perr").innerHTML = `<div class="err">${esc(ev.message)}</div>${
        ev.analysisId
          ? `<div class="actions"><button class="btn dark" id="retry">Pokušaj analizu ponovo (bez nove pretrage)</button><a class="btn" href="#/a/${ev.analysisId}">Vidi dosije</a></div>`
          : `<div class="actions"><a class="btn" href="#/">Nazad</a></div>`
      }`;
      $("retry")?.addEventListener("click", () => rerun(ev.analysisId, {}));
    }
  };
  $("cancel").addEventListener("click", () => api(`/api/jobs/${jobId}/cancel`, { method: "POST" }));
  connect();
  cleanup = () => {
    clearInterval(timer);
    es?.close();
  };
}

async function rerun(id, body) {
  try {
    const { jobId } = await api(`/api/analyses/${id}/rerun`, { method: "POST", body: JSON.stringify(body) });
    location.hash = `#/job/${jobId}`;
  } catch (e) {
    if (e.body?.jobId) location.hash = `#/job/${e.body.jobId}`;
    else alert(e.message);
  }
}

// ---------- rezultat ----------
async function resultView(id) {
  const a = await api(`/api/analyses/${id}`);
  const plan = a.plan;
  a.state ||= {};
  a.state.tickets ||= {};
  const cur = a.currency;
  const B = () => +a.state.bankroll || a.bankroll;
  const ts = (tid) => (a.state.tickets[tid] ||= {});

  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await api(`/api/analyses/${id}`, { method: "PATCH", body: JSON.stringify({ state: a.state }) }).catch(() => {});
      refreshState().catch(() => {});
    }, 500);
  };

  const costTotal = (a.cost?.research || 0) + (a.cost?.analysis || 0);
  const u = { input: 0, output: 0, thinking: 0, searches: 0, cacheRead: 0 };
  for (const part of Object.values(a.usage || {})) for (const k in u) u[k] += part?.[k] || 0;
  const kt = (x) => `${Math.round(x / 1000)}k`;
  const costLine = `Trošak ove analize: ${a.reusedFrom ? "istraživanje ponovo iskorišteno ($0)" : `istraživanje ${usd(a.cost?.research)}`} · analiza ${usd(a.cost?.analysis)} · ukupno <b>${usd(costTotal)}</b>${
    u.searches ? ` · ${u.searches} pretraga` : ""
  }${u.input || u.output ? ` · ulaz ${kt(u.input + u.cacheRead)} / izlaz ${kt(u.output)} tokena (razmišljanje ${kt(u.thinking)})` : ""}${a.model ? ` · ${esc(a.model)}` : ""}`;

  if (!plan) {
    $app.innerHTML = `
      <a class="back" href="#/">← Sva kola</a>
      <h1>${esc(a.query)}</h1>
      <div class="err">${esc(a.error || "Analiza nije završena.")}</div>
      <div class="actions"><button class="btn dark" id="retry">Pokreni analizu (bez nove pretrage)</button><button class="btn ghost" id="del">Obriši</button></div>
      <h2>Dosije</h2><div class="raw">${esc(a.dossier)}</div>
      <div class="costline">${costLine}</div>`;
    document.getElementById("retry").onclick = () => rerun(id, {});
    document.getElementById("del").onclick = () => del(id);
    return;
  }

  const matchById = Object.fromEntries(plan.matches.map((m) => [m.id, m]));

  $app.innerHTML = `
    <a class="back" href="#/">← Sva kola</a>
    <h1>${esc(plan.league)} · ${esc(plan.round)}${a.demo ? '<span class="demo-badge">DEMO</span>' : ""}</h1>
    <div class="small muted">${esc(plan.dates)} · ${a.mode === "ultra" ? "Ultra" : "Standard"} · ${esc(a.risk)} · ${fmtDate(a.createdAt)}</div>
    <p class="overview">${esc(plan.overview)}</p>
    <div class="stats" id="stats"></div>
    <div class="small muted">${esc(plan.bankroll_note)}</div>
    <h2>Tiketi</h2>
    <div id="tickets">${plan.tickets.length ? "" : `<p class="muted">Nema tiketa za ovo kolo.</p>`}</div>
    ${plan.matches.length ? `<h2>Mečevi</h2>${plan.matches.map(matchHTML).join("")}` : ""}
    ${
      plan.avoid.length || plan.warnings.length
        ? `<h2>Oprez</h2><ul class="kf">${plan.avoid.map((x) => `<li><b>${esc(x.match)}</b> — ${esc(x.reason)}</li>`).join("")}${plan.warnings
            .map((w) => `<li class="warn">${esc(w)}</li>`)
            .join("")}</ul>`
        : ""
    }
    <h2>Nova strategija</h2>
    <p class="small muted" style="margin-top:-4px">Ista istražena data, nova analiza (plaća se samo analiza). Promjena budžeta gore je besplatna — ulozi se preračunaju lokalno.</p>
    <div class="row">
      ${seg("risk", RISKS.map((r) => [r, r[0].toUpperCase() + r.slice(1)]), a.risk)}
      ${seg("mode", [["standard", "Standard"], ["ultra", "Ultra"]], a.mode)}
    </div>
    <input class="note" id="rnotes" placeholder="Napomena za novu strategiju (opciono)" value="${esc(a.notes || "")}" />
    <div class="actions">
      <button class="btn dark" id="rerun">Nova strategija</button>
      <button class="btn" id="refresh">Osvježi podatke i analiziraj</button>
      <button class="btn ghost" id="del">Obriši</button>
    </div>
    <details style="margin-top:18px"><summary class="small muted" style="cursor:pointer">Dosije (sirovi podaci istraživanja)</summary><div class="raw" style="margin-top:8px">${esc(a.dossier)}</div></details>
    <div class="costline">${costLine}</div>`;

  const rr = { risk: a.risk, mode: a.mode };
  bindSeg($app, (k, v) => (rr[k] = v));
  document.getElementById("rerun").onclick = () =>
    rerun(id, { ...rr, bankroll: B(), currency: cur, notes: document.getElementById("rnotes").value });
  document.getElementById("refresh").onclick = async () => {
    try {
      const { jobId } = await api("/api/analyze", {
        method: "POST",
        body: JSON.stringify({ query: a.query, bankroll: B(), currency: cur, ...rr, notes: document.getElementById("rnotes").value, refresh: true }),
      });
      location.hash = `#/job/${jobId}`;
    } catch (e) {
      alert(e.message);
    }
  };
  document.getElementById("del").onclick = () => del(id);

  // --- statistika na vrhu ---
  const renderStats = () => {
    const s = planStats(a);
    document.getElementById("stats").innerHTML = `
      <div><div class="k">Budžet</div><input id="bk" type="number" min="1" value="${esc(B())}" /></div>
      <div><div class="k">Svi tiketi</div><div class="v">${money(s.stake, cur)}</div></div>
      <div><div class="k">Očekivano (EV)</div><div class="v ${cls(s.ev)}">${signed(s.ev, cur)}</div></div>
      <div><div class="k">${s.placed ? "Bilans uplaćenih" : "Max dobitak"}</div><div class="v ${s.placed ? cls(s.settledProfit) : ""}">${
        s.placed ? (s.pending && !s.settledProfit ? `${s.pending} čeka` : signed(s.settledProfit, cur)) : money(s.max, cur)
      }</div></div>`;
    document.getElementById("bk").addEventListener("change", (e) => {
      a.state.bankroll = Math.max(1, +e.target.value || a.bankroll);
      save();
      renderAll();
    });
  };

  // --- tiketi ---
  const $tickets = document.getElementById("tickets");
  const renderTicket = (t) => {
    const st = ts(t.id);
    const s = ticketStats(t, B(), st);
    const typeLabel = t.type === "sistem" ? `Sistem ${t.system_k}/${t.picks.length}` : TYPE_LABEL[t.type];
    const picks = t.picks
      .map((p, i) => {
        const odds = st.odds?.[i] ?? p.odds;
        const res = st.res?.[i];
        const m = matchById[p.match_id];
        return `<div class="pick">
          <div><div class="m">${esc(p.match)}${m?.kickoff ? ` · ${esc(m.kickoff)}` : ""} · ${esc(p.market)}</div><div class="p">${esc(p.pick)}</div></div>
          <div class="pr">${pct(p.prob)}${p.push_prob > 0.005 ? `<br><span class="small">+${pct(p.push_prob)} povrat</span>` : ""}${
            s.perLeg ? `<br><span class="small">${money(s.perLeg[i].stake, cur)}</span>` : ""
          }</div>
          <input class="odds ${p.odds_source === "procjena" && st.odds?.[i] == null ? "est" : ""}" inputmode="decimal" value="${esc(odds)}" data-i="${i}" title="Upiši kvotu svoje kladionice" />
          <div class="why" style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <span>${esc(p.reason)}${p.odds_source === "procjena" && st.odds?.[i] == null ? " · kvota procijenjena" : ""}</span>
            ${
              st.placed
                ? `<span class="res">${["W", "P", "L"]
                    .map((r) => `<button class="${r} ${res === r ? "on" : ""}" data-i="${i}" data-r="${r}" title="${{ W: "Prošao", P: "Povrat", L: "Pao" }[r]}">${{ W: "✓", P: "↺", L: "✗" }[r]}</button>`)
                    .join("")}</span>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");
    const evPct = s.stake > 0 ? (s.ev / s.stake) * 100 : 0;
    const foot = [
      `Ulog <b>${money(s.stake, cur)}</b>`,
      s.kind === "sistem" ? `${s.combos} komb. × ${money(s.perCombo, cur)}` : "",
      s.odds ? `Kvota <b>${fix(s.odds)}</b>${s.kind === "sistem" ? " max" : ""}` : "",
      `Šansa <b>${pct(s.prob)}</b>${s.kind === "pojedinacno" ? " prosj." : ""}${s.safe && s.safe - s.prob > 0.01 ? ` (bez gubitka ${pct(s.safe)})` : ""}`,
      `EV <b class="${cls(s.ev)}">${signed(s.ev)} (${evPct >= 0 ? "+" : ""}${evPct.toFixed(0)}%)</b>`,
      `Dobitak do <b>${money(s.max, cur)}</b>`,
      s.settled && st.placed ? `Rezultat <b class="${cls(s.profit)}">${signed(s.profit, cur)}</b>` : "",
    ]
      .filter(Boolean)
      .join("<span class='muted'> · </span>");
    return `
      <div class="th"><span class="name">${esc(t.name)}</span>
        <span><span class="tag">${typeLabel}</span> <span class="tag r-${esc(t.risk)}">rizik: ${esc(t.risk)}</span></span></div>
      <div class="idea">${esc(t.idea)}</div>
      ${picks}
      <div class="tf">${foot}</div>
      <div class="ta">
        <label><input type="checkbox" class="placed" ${st.placed ? "checked" : ""}/> Uplaćen</label>
        ${st.placed ? `<label>Stvarni ulog <input class="stake-in" type="number" min="0" step="0.5" value="${esc(st.stake ?? fix(s.stake))}" /></label>` : ""}
        <button class="btn copy">Kopiraj tiket</button>
      </div>`;
  };

  const cards = {};
  const renderAll = () => {
    renderStats();
    for (const t of plan.tickets) {
      cards[t.id].innerHTML = renderTicket(t);
      cards[t.id].classList.toggle("placed", !!ts(t.id).placed);
    }
  };

  for (const t of plan.tickets) {
    const el = document.createElement("div");
    el.className = "ticket";
    cards[t.id] = el;
    $tickets.appendChild(el);
    const rerender = () => {
      el.innerHTML = renderTicket(t);
      el.classList.toggle("placed", !!ts(t.id).placed);
      renderStats();
    };
    el.addEventListener("change", (e) => {
      const st = ts(t.id);
      if (e.target.classList.contains("odds")) {
        const v = parseFloat(String(e.target.value).replace(",", "."));
        st.odds ||= {};
        if (v > 1) st.odds[e.target.dataset.i] = v;
        else delete st.odds[e.target.dataset.i];
      } else if (e.target.classList.contains("placed")) {
        st.placed = e.target.checked;
      } else if (e.target.classList.contains("stake-in")) {
        const v = parseFloat(String(e.target.value).replace(",", "."));
        if (v >= 0) st.stake = v;
        else delete st.stake;
      } else return;
      save();
      rerender();
    });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.r) {
        const st = ts(t.id);
        st.res ||= {};
        st.res[b.dataset.i] = st.res[b.dataset.i] === b.dataset.r ? undefined : b.dataset.r;
        if (!st.res[b.dataset.i]) delete st.res[b.dataset.i];
        save();
        rerender();
      } else if (b.classList.contains("copy")) {
        copyTicket(t, ticketStats(t, B(), ts(t.id)), ts(t.id), plan, cur).then(() => {
          b.textContent = "Kopirano ✓";
          setTimeout(() => (b.textContent = "Kopiraj tiket"), 1500);
        });
      }
    });
  }
  renderAll();
}

function matchHTML(m) {
  const conf = "●".repeat(m.confidence) + "○".repeat(5 - m.confidence);
  return `<details class="match">
    <summary><span><b>${esc(m.home)} – ${esc(m.away)}</b> <span class="small muted">${esc(m.kickoff)}</span></span>
      <span class="small muted" style="white-space:nowrap">1 ${pct(m.p_home)} · X ${pct(m.p_draw)} · 2 ${pct(m.p_away)}</span></summary>
    <div class="body">
      <div class="bar"><span style="width:${m.p_home * 100}%"></span><span style="width:${m.p_draw * 100}%"></span><span style="width:${m.p_away * 100}%"></span></div>
      <div>${esc(m.verdict)}</div>
      <div class="small muted" style="margin-top:6px">xG ${(+m.xg_home).toFixed(2)} – ${(+m.xg_away).toFixed(2)} · najvjerovatnije ${esc(m.likely_score)} · 3+ ${pct(m.p_over25)} · GG ${pct(m.p_btts)} · pouzdanost <span class="dots">${conf}</span></div>
      <ul class="kf">${m.key_factors.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
    </div></details>`;
}

async function copyTicket(t, s, st, plan, cur) {
  const lines = [
    `${t.name} (${t.type === "sistem" ? `Sistem ${t.system_k}/${t.picks.length}` : TYPE_LABEL[t.type]}) — ${plan.league} ${plan.round}`,
    ...t.picks.map((p, i) => {
      const odds = st.odds?.[i] ?? p.odds;
      const stake = s.perLeg ? ` · ulog ${fix(s.perLeg[i].stake)} ${cur}` : "";
      return `${i + 1}. ${p.match} — ${p.market}: ${p.pick} @${fix(+odds)}${stake}`;
    }),
    `${s.odds ? `Kvota ${fix(s.odds)} · ` : ""}Ulog ${fix(s.stake)} ${cur} · Dobitak do ${fix(s.max)} ${cur}`,
  ];
  const text = lines.join("\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

async function del(id) {
  if (!confirm("Obrisati ovu analizu?")) return;
  await api(`/api/analyses/${id}`, { method: "DELETE" });
  location.hash = "#/";
}
