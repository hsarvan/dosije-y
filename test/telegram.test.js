// Testovi Telegram bota: parsiranje, formatiranje i cijeli tok s lažnim Telegram serverom (DEMO, bez troška).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCommand, formatAnalysis, pack } from "../lib/telegram.js";
import { sanitizePlan } from "../lib/schema.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- parsiranje ----
assert.deepEqual(parseCommand("Analiza Bundesliga 1"), { cmd: "analiza", query: "Bundesliga 1" });
assert.deepEqual(parseCommand("analiza la liga 14. kolo ultra 50 KM agresivno"), {
  cmd: "analiza",
  mode: "ultra",
  bankroll: 50,
  currency: "KM",
  risk: "agresivan",
  query: "la liga 14. kolo",
});
assert.equal(parseCommand("Analiza Serie A standard 20€").currency, "€");
assert.equal(parseCommand("Analiza Premijer liga BiH budžet 30").bankroll, 30);
assert.equal(parseCommand("/start").cmd, "help");
assert.equal(parseCommand("Pomoć").cmd, "help");
assert.equal(parseCommand("Potrošnja").cmd, "spend");
assert.equal(parseCommand("Analiza").cmd, "help");
assert.equal(parseCommand("zdravo").cmd, "unknown");

// ---- formatiranje ----
const plan = sanitizePlan(JSON.parse(fs.readFileSync(path.join(root, "demo/plan.json"), "utf8")));
const a = { query: "Demo", plan, bankroll: 100, currency: "KM", risk: "balansiran", mode: "ultra", cost: { research: 0.8, analysis: 1.1 }, usage: { research: { searches: 14 } } };
const msgs = formatAnalysis(a);
assert.ok(msgs.length >= 1);
for (const m of msgs) assert.ok(m.length <= 4096, `poruka predugačka: ${m.length}`);
const all = msgs.join("\n");
for (const s of ["SIGURICA", "LUDI SISTEM 2/4", "Sistem 2/4", "1X</b> @1.22", "Trošak $1.90 · 14 pretraga", "procijenjena kvota"]) assert.ok(all.includes(s), `nedostaje: ${s}`);
assert.ok(!/<(?!\/?(b|i|code)>)/.test(all), "samo dozvoljeni HTML tagovi");
assert.equal(pack(["a".repeat(3000), "b".repeat(3000)]).length, 2);

// ---- cijeli tok: lažni Telegram server + node bot.js --once (DEMO) ----
const queue = [
  { update_id: 10, message: { message_id: 1, date: 0, chat: { id: 111, type: "private" }, from: { first_name: "Haris" }, text: "/start" } },
  { update_id: 11, message: { message_id: 2, date: 0, chat: { id: 111, type: "private" }, text: "Analiza Bundesliga 1 50 KM agresivno" } },
  { update_id: 12, message: { message_id: 3, date: 0, chat: { id: 222, type: "private" }, text: "Analiza La Liga" } },
  { update_id: 13, message: { message_id: 4, date: 0, chat: { id: 111, type: "private" }, text: "Potrošnja" } },
];
const sent = [];
const edits = [];
let confirmed = 0;
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const p = JSON.parse(body || "{}");
  const method = req.url.split("/").pop();
  let result = true;
  if (method === "getUpdates") {
    if (p.offset) confirmed = Math.max(confirmed, p.offset);
    result = queue.filter((u) => u.update_id >= (p.offset || 0)).slice(0, p.limit || 100);
  } else if (method === "sendMessage") {
    sent.push(p);
    result = { message_id: 1000 + sent.length, chat: { id: p.chat_id } };
  } else if (method === "editMessageText") edits.push(p);
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, result }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-bot-"));
const outFile = path.join(dataDir, "gh_output");
const code = await new Promise((resolve) => {
  const child = spawn(process.execPath, ["bot.js", "--once"], {
    cwd: root,
    env: { ...process.env, DEMO: "1", TELEGRAM_BOT_TOKEN: "test", TELEGRAM_CHAT_ID: "", TELEGRAM_API_BASE: `http://127.0.0.1:${server.address().port}`, KOLO_DATA_DIR: dataDir, GITHUB_OUTPUT: outFile },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", resolve);
});
server.close();
assert.equal(code, 0);
assert.equal(confirmed, 14, "sve poruke potvrđene");
assert.ok(sent.every((m) => m.chat_id === 111), "stranac (222) ne dobija odgovor");
const texts = sent.map((m) => m.text);
assert.match(texts[0], /vezan samo za tebe/);
assert.match(texts[1], /Analiza Bundesliga 1/);
assert.ok(texts.some((t) => t.includes("⏳ <b>Bundesliga 1</b> · Ultra · 50 KM · agresivan")));
assert.ok(texts.some((t) => t.includes("SIGURICA") && t.includes("Ulog <b>17.50 KM</b>")), "ulozi skalirani na 50 KM");
assert.match(texts[texts.length - 1], /AI potrošnja/);
assert.ok(edits.some((e) => e.text.startsWith("✅")), "potvrda završetka");
assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "telegram_owner.json"), "utf8")).id, 111);
assert.match(fs.readFileSync(outFile, "utf8"), /changed=true/);
assert.equal(fs.readdirSync(path.join(dataDir, "analyses")).length, 1);

console.log("telegram: svi testovi prošli");
