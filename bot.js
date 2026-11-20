// Telegram bot: pošalješ „Analiza Bundesliga 1“, bot vrati analizu i tikete.
//   node bot.js          — radi stalno (long polling), npr. na serveru ili računaru
//   node bot.js --once   — obradi poruke na čekanju i izađi (GitHub Actions svakih ~5 min)
import "./lib/load-env.js";
import fs from "node:fs";
import path from "node:path";
import { env, MODES } from "./lib/config.js";
import { runAnalysis, budgetBlocked } from "./lib/pipeline.js";
import { spendSummary, DATA } from "./lib/store.js";
import { parseCommand, helpText, formatAnalysis, parseDefaults } from "./lib/telegram.js";

const OWNER_FILE = path.join(DATA, "telegram_owner.json");
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const API = `${process.env.TELEGRAM_API_BASE || "https://api.telegram.org"}/bot${TOKEN}`;
const ONCE = process.argv.includes("--once");
const defaults = parseDefaults();
let changed = false; // da li treba sačuvati data/ (GitHub Actions keš)

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw Object.assign(new Error(`Telegram ${method}: ${j.description || r.status}`), { code: j.error_code });
  return j.result;
}

async function send(chatId, html) {
  try {
    return await tg("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    if (e.code !== 400) throw e;
    // HTML nije prošao — pošalji kao čist tekst
    const plain = html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    return tg("sendMessage", { chat_id: chatId, text: plain });
  }
}

const edit = (chatId, messageId, html) =>
  tg("editMessageText", { chat_id: chatId, message_id: messageId, text: html, parse_mode: "HTML" }).catch(() => {});

function allowedChats() {
  const fromEnv = (process.env.TELEGRAM_CHAT_ID || "").split(/[,\s]+/).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  try {
    return [String(JSON.parse(fs.readFileSync(OWNER_FILE, "utf8")).id)];
  } catch {
    return [];
  }
}

async function handle(msg) {
  const chatId = msg.chat?.id;
  if (!chatId || typeof msg.text !== "string") return;

  // Prvi privatni chat postaje vlasnik bota (ako TELEGRAM_CHAT_ID nije zadan).
  let allowed = allowedChats();
  if (!allowed.length && msg.chat.type === "private") {
    fs.mkdirSync(path.dirname(OWNER_FILE), { recursive: true });
    fs.writeFileSync(OWNER_FILE, JSON.stringify({ id: chatId, name: msg.from?.first_name || "", at: new Date().toISOString() }));
    changed = true;
    allowed = [String(chatId)];
    await send(chatId, `🔒 Bot je sada vezan samo za tebe (chat ID <code>${chatId}</code>). Drugi ga ne mogu koristiti.`);
  }
  if (!allowed.includes(String(chatId))) return; // tuđe poruke se ignorišu (nema troška)

  const cmd = parseCommand(msg.text);
  if (!cmd) return;
  if (cmd.cmd === "help") return send(chatId, (cmd.reason ? `${esc(cmd.reason)}\n\n` : "") + helpText(defaults));
  if (cmd.cmd === "unknown") return send(chatId, `Nisam razumio. Pošalji npr. <code>Analiza Bundesliga 1</code> ili <code>pomoć</code>.`);
  if (cmd.cmd === "spend") {
    const s = spendSummary();
    return send(
      chatId,
      `AI potrošnja: danas <b>$${s.today.toFixed(2)}</b> · ovaj mjesec <b>$${s.month.toFixed(2)}</b>${env.monthlyBudget ? ` od $${env.monthlyBudget}` : ""} · ukupno $${s.total.toFixed(2)}`,
    );
  }

  // --- analiza ---
  if (!env.demo && !process.env.ANTHROPIC_API_KEY) {
    return send(chatId, "Nedostaje Claude API ključ: dodaj GitHub secret <code>ANTHROPIC_API_KEY</code> u repozitoriju dosije-y.");
  }
  const blocked = budgetBlocked();
  if (blocked) return send(chatId, `⛔ ${esc(blocked)}`);

  const opts = {
    query: cmd.query,
    mode: cmd.mode || defaults.mode,
    risk: cmd.risk || defaults.risk,
    bankroll: cmd.bankroll || defaults.bankroll,
    currency: cmd.currency || defaults.currency,
    notes: "",
    source: "telegram",
  };
  const label = `⏳ <b>${esc(opts.query)}</b> · ${MODES[opts.mode].label} · ${opts.bankroll} ${esc(opts.currency)} · ${opts.risk}`;
  const ack = await send(chatId, `${label}\nKrećem: istraživanje kola…`);

  const t0 = Date.now();
  const st = { phase: "research", searches: 0, reused: false, writing: false };
  let lastEdit = 0;
  let lastText = "";
  const status = () => {
    const sec = Math.round((Date.now() - t0) / 1000);
    const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    if (st.phase === "research") return `Istraživanje: ${st.searches} pretraga… (${clock})`;
    if (st.writing) return `Pišem tikete… (${clock})`;
    return `${st.reused ? "Podaci od ranije (bez troška pretrage). " : ""}Analiza${opts.mode === "ultra" ? " (Opus 5.5, max razmišljanje)" : ""}… (${clock})`;
  };
  const emit = (ev) => {
    if (ev.type === "log" && ev.icon === "search") st.searches++;
    if (ev.type === "phase" && ev.phase === "analysis") st.phase = "analysis";
    if (ev.type === "phase" && ev.status === "reused") st.reused = true;
    if (ev.type === "writing" && st.phase === "analysis") st.writing = true;
    const text = `${label}\n${status()}`;
    if (Date.now() - lastEdit > 15_000 && text !== lastText) {
      lastEdit = Date.now();
      lastText = text;
      edit(chatId, ack.message_id, text);
    }
  };

  try {
    const a = await runAnalysis(opts, { emit });
    changed = true;
    for (const m of formatAnalysis(a)) await send(chatId, m);
    await edit(chatId, ack.message_id, label.replace("⏳", "✅") + `\nGotovo za ${Math.round((Date.now() - t0) / 60000) || 1} min.`);
  } catch (e) {
    if (e.analysis) changed = true;
    console.error(e.cause || e);
    await edit(chatId, ack.message_id, label.replace("⏳", "⚠️") + "\nZaustavljeno.");
    await send(chatId, `⚠️ ${esc(e.friendly || e.message)}`);
  }
}

async function main() {
  if (!TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN nije postavljen — bot preskače ovo pokretanje.");
    return;
  }
  let offset;
  let conflicts = 0;
  while (true) {
    let updates;
    try {
      updates = await tg("getUpdates", { offset, timeout: ONCE ? 20 : 50, allowed_updates: ["message"] });
    } catch (e) {
      if (e.code === 409 && conflicts++ < 5) {
        // drugi proces trenutno čita poruke (ili je postavljen webhook)
        if (conflicts === 1) await tg("deleteWebhook", {}).catch(() => {});
        await sleep(5000);
        continue;
      }
      throw e;
    }
    conflicts = 0;
    for (const u of updates) {
      offset = u.update_id + 1;
      // Potvrdi poruku odmah: i ako nešto padne, ista analiza se neće platiti dvaput.
      await tg("getUpdates", { offset, limit: 1, timeout: 0 }).catch(() => {});
      if (!u.message) continue;
      try {
        await handle(u.message);
      } catch (e) {
        console.error(e);
        await send(u.message.chat.id, "⚠️ Greška bota. Pokušaj ponovo.").catch(() => {});
      }
    }
    if (ONCE && updates.length === 0) break;
  }
}

try {
  await main();
} finally {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
