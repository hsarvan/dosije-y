// Telegram: parsiranje poruka i formatiranje analize u poruke (HTML, max ~4000 znakova).
import { ticketStats } from "../public/calc.js";
import { MODES, RISK_PROFILES } from "./config.js";

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const fix = (x) => (Number.isFinite(x) ? x : 0).toFixed(2);
const amt = (x) => (Math.abs(x - Math.round(x)) < 0.005 ? String(Math.round(x)) : fix(x));
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const signed = (x) => `${x >= 0 ? "+" : "−"}${fix(Math.abs(x))}`;
const usd = (x) => `$${(x || 0).toFixed(2)}`;

const CUR = { km: "KM", bam: "KM", eur: "€", "€": "€", rsd: "RSD", din: "RSD", $: "$", usd: "$", kn: "kn" };
const RISK_WORDS = {
  oprezan: "oprezan", oprezno: "oprezan", sigurno: "oprezan",
  balansiran: "balansiran", balans: "balansiran", normalno: "balansiran",
  agresivan: "agresivan", agresivno: "agresivan", rizicno: "agresivan", rizično: "agresivan",
};

// "Analiza Bundesliga 1 ultra 50 KM agresivno" -> {cmd, query, mode, risk, bankroll, currency}
export function parseCommand(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (/^\/?(start|help|pomoc|pomoć|\?)(?=$|[\s,.!?:@])/.test(low)) return { cmd: "help" };
  if (/^\/?(potrosnja|potrošnja|trosak|trošak|budzet|budžet)(?=$|[\s,.!?:@])/.test(low)) return { cmd: "spend" };
  const m = t.match(/^\/?(analiza|analiziraj|analize|tiket|tiketi)\b[\s:,-]*(.*)$/is);
  if (!m) return { cmd: "unknown" };
  let rest = m[2];
  const out = { cmd: "analiza" };
  rest = rest.replace(/\b(ultra|standard|standardno|jeftino)\b/gi, (w) => {
    out.mode = /ultra/i.test(w) ? "ultra" : "standard";
    return " ";
  });
  rest = rest.replace(/(\d+(?:[.,]\d+)?)\s*(km|bam|eur|€|rsd|din|\$|usd|kn)(?=\s|$|[.,;])/gi, (_, n, c) => {
    out.bankroll = parseFloat(n.replace(",", "."));
    out.currency = CUR[c.toLowerCase()] || "KM";
    return " ";
  });
  rest = rest.replace(/\b(budzet|budžet|ulog)\s*:?\s*(\d+(?:[.,]\d+)?)/gi, (_, __, n) => {
    out.bankroll = parseFloat(n.replace(",", "."));
    return " ";
  });
  rest = rest.replace(/[\wčćšžđ]+/gi, (w) => {
    const r = RISK_WORDS[w.toLowerCase()];
    if (r) {
      out.risk = r;
      return " ";
    }
    return w;
  });
  out.query = rest.replace(/\s+/g, " ").trim();
  if (out.query.length < 3) return { cmd: "help", reason: "Napiši i ligu, npr. „Analiza Bundesliga 1“." };
  return out;
}

export function helpText(defaults) {
  return [
    "<b>kolo</b> · AI analiza fudbalskog kola (Claude Opus 5.5)",
    "",
    "Pošalji npr.:",
    "<code>Analiza Bundesliga 1</code>",
    "<code>Analiza La Liga 14. kolo</code>",
    "<code>Analiza Premier liga 50 KM agresivno</code>",
    "<code>Analiza Serie A standard</code>  (jeftinije)",
    "",
    `Zadano: ${defaults.mode === "ultra" ? "Ultra (max razmišljanje)" : "Standard"} · budžet ${amt(defaults.bankroll)} ${esc(defaults.currency)} · ${defaults.risk}.`,
    "Riječi u poruci mijenjaju: <i>ultra / standard</i>, <i>oprezno / agresivno</i>, iznos s valutom (npr. 50 KM).",
    "<code>Potrošnja</code> — koliko je AI potrošio ovaj mjesec.",
    "",
    "Odgovor stiže za ~10–25 min (bot provjerava poruke svakih ~5 min, analiza traje 3–10 min).",
  ].join("\n");
}

// Pakuje blokove u poruke do ~3900 znakova (Telegram limit 4096).
export function pack(blocks, limit = 3900) {
  const msgs = [];
  let cur = "";
  for (const b of blocks.filter(Boolean)) {
    const parts = b.length > limit ? b.match(new RegExp(`[\\s\\S]{1,${limit}}`, "g")) : [b];
    for (const p of parts) {
      if (cur && cur.length + 2 + p.length > limit) {
        msgs.push(cur);
        cur = p;
      } else cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) msgs.push(cur);
  return msgs;
}

const TYPE = { pojedinacno: "Pojedinačno", kombinacija: "Kombinacija", sistem: "Sistem" };

function ticketBlock(t, i, a, matchById) {
  const cur = a.currency;
  const s = ticketStats(t, a.bankroll, {});
  const type = t.type === "sistem" ? `Sistem ${t.system_k}/${t.picks.length}` : TYPE[t.type];
  const lines = [`<b>${i + 1}) ${esc(t.name.toUpperCase())}</b> · ${type} · rizik ${esc(t.risk)}`];
  t.picks.forEach((p, j) => {
    const m = matchById[p.match_id];
    const when = m?.kickoff ? ` · ${esc(m.kickoff)}` : "";
    const est = p.odds_source === "procjena" ? "*" : "";
    const push = p.push_prob > 0.005 ? ` +${pct(p.push_prob)} povrat` : "";
    const stake = s.perLeg ? ` · ulog ${amt(s.perLeg[j].stake)} ${esc(cur)}` : "";
    lines.push(`• ${esc(p.match)}${when}\n   ${esc(p.market)}: <b>${esc(p.pick)}</b> @${fix(p.odds)}${est} (${pct(p.prob)}${push})${stake}`);
  });
  const evPct = s.stake > 0 ? (s.ev / s.stake) * 100 : 0;
  const foot = [
    `Ulog <b>${amt(s.stake)} ${esc(cur)}</b>`,
    s.kind === "sistem" ? `${s.combos} komb. × ${fix(s.perCombo)}` : "",
    s.odds && s.kind !== "sistem" ? `kvota <b>${fix(s.odds)}</b>` : "",
    `šansa ${pct(s.prob)}${s.kind === "pojedinacno" ? " prosj." : ""}`,
    `EV ${evPct >= 0 ? "+" : ""}${evPct.toFixed(0)}%`,
    `dobitak do <b>${amt(s.max)} ${esc(cur)}</b>`,
  ].filter(Boolean);
  lines.push(foot.join(" · "));
  if (t.idea) lines.push(`<i>${esc(t.idea)}</i>`);
  return lines.join("\n");
}

export function formatAnalysis(a) {
  const plan = a.plan;
  const cost = (a.cost?.research || 0) + (a.cost?.analysis || 0);
  const searches = (a.usage?.research?.searches || 0) + (a.usage?.analysis?.searches || 0);
  const costLine = a.demo
    ? "<i>DEMO — izmišljeni podaci, bez troška.</i>"
    : `<i>Trošak ${usd(cost)}${a.reusedFrom ? " (podaci ponovo iskorišteni)" : ` · ${searches} pretraga`} · ${MODES[a.mode]?.label || a.mode}</i>`;
  if (!plan) return pack([`<b>${esc(a.query)}</b>`, esc(a.error || "Analiza nije završena."), costLine]);

  const matchById = Object.fromEntries(plan.matches.map((m) => [m.id, m]));
  let total = 0;
  let ev = 0;
  for (const t of plan.tickets) {
    const s = ticketStats(t, a.bankroll, {});
    total += s.stake;
    ev += s.ev;
  }
  const head = [
    `<b>${esc(plan.league)} · ${esc(plan.round)}</b>`,
    `${esc(plan.dates)} · budžet ${amt(a.bankroll)} ${esc(a.currency)} · ${esc(a.risk)}`,
    "",
    esc(plan.overview),
    plan.tickets.length ? `\nUkupno ulog <b>${amt(total)} ${esc(a.currency)}</b> · očekivano ${signed(ev)} ${esc(a.currency)}` : "",
    plan.bankroll_note ? `<i>${esc(plan.bankroll_note)}</i>` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");

  const tickets = plan.tickets.map((t, i) => ticketBlock(t, i, a, matchById));
  const hasEst = plan.tickets.some((t) => t.picks.some((p) => p.odds_source === "procjena"));

  const matches = plan.matches.length
    ? [
        "<b>Mečevi</b> (1 · X · 2 · najvjerovatnije)",
        ...plan.matches.map(
          (m) =>
            `${esc(m.home)} – ${esc(m.away)}: ${pct(m.p_home)} · ${pct(m.p_draw)} · ${pct(m.p_away)} · ${esc(m.likely_score)}\n   <i>${esc(m.verdict)}</i>`,
        ),
      ].join("\n")
    : "";

  const caution = [
    ...plan.avoid.map((x) => `• ${esc(x.match)} — ${esc(x.reason)}`),
    ...plan.warnings.map((w) => `• ${esc(w)}`),
  ];
  const tail = [
    caution.length ? `<b>Oprez</b>\n${caution.join("\n")}` : "",
    hasEst ? "* procijenjena kvota — provjeri u svojoj kladionici." : "",
    costLine,
    "18+ · Nema sigurnog tiketa. Igraj odgovorno.",
  ]
    .filter(Boolean)
    .join("\n");

  return pack([head, ...tickets, matches, tail]);
}

export function parseDefaults(envv = process.env) {
  const mode = MODES[envv.BOT_MODE] ? envv.BOT_MODE : "ultra";
  const risk = RISK_PROFILES.includes(envv.BOT_RISK) ? envv.BOT_RISK : "balansiran";
  const bankroll = Number(envv.BOT_BANKROLL) > 0 ? Number(envv.BOT_BANKROLL) : 100;
  const currency = envv.BOT_CURRENCY || "KM";
  return { mode, risk, bankroll, currency };
}
