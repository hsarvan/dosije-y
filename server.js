import "./lib/load-env.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, MODES, RISK_PROFILES, MODEL } from "./lib/config.js";
import { runAnalysis, budgetBlocked } from "./lib/pipeline.js";
import { newId, saveAnalysis, getAnalysis, deleteAnalysis, listAnalyses, spendSummary } from "./lib/store.js";
import { planStats } from "./public/calc.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

// ---------- Poslovi (analiza traje minutama; nastavlja se i ako se browser zatvori) ----------
const jobs = new Map();
let activeJobId = null;

function createJob() {
  const job = { id: newId(), events: [], clients: new Set(), done: false, ac: new AbortController() };
  jobs.set(job.id, job);
  activeJobId = job.id;
  return job;
}

function emit(job, ev) {
  ev.t = Date.now();
  const last = job.events[job.events.length - 1];
  // Spajamo uzastopne "thinking" događaje da replay ostane mali.
  if (ev.type === "thinking" && last?.type === "thinking") {
    last.text = (last.text + ev.text).slice(-6000);
  } else if (ev.type === "writing" && last?.type === "writing") {
    last.chars = ev.chars;
  } else {
    job.events.push({ ...ev });
  }
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of job.clients) res.write(line);
}

function finishJob(job) {
  job.done = true;
  if (activeJobId === job.id) activeJobId = null;
  for (const res of job.clients) res.end();
  job.clients.clear();
  setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
}

async function runJob(job, opts) {
  try {
    const a = await runAnalysis({ ...opts, source: "web" }, { emit: (ev) => emit(job, ev), signal: job.ac.signal });
    emit(job, { type: "done", analysisId: a.id });
  } catch (e) {
    emit(job, { type: "error", message: e.friendly || String(e.message), analysisId: e.analysis?.id || null });
    if (!/prekinut/i.test(e.friendly || "")) console.error(e.cause || e);
  } finally {
    finishJob(job);
  }
}

// ---------- HTTP ----------
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error("too large");
  }
  return data ? JSON.parse(data) : {};
}

function checkAuth(req, res) {
  if (!env.password) return true;
  const h = req.headers.authorization || "";
  const pass = h.startsWith("Basic ") ? Buffer.from(h.slice(6), "base64").toString().split(":").slice(1).join(":") : "";
  if (pass === env.password) return true;
  res.writeHead(401, { "www-authenticate": 'Basic realm="kolo"' });
  res.end("Potrebna lozinka");
  return false;
}

function parseRunOptions(body) {
  const query = String(body.query || "").trim().slice(0, 300);
  const bankroll = Math.max(1, Math.min(1e7, Number(body.bankroll) || 100));
  const currency = String(body.currency || "KM").slice(0, 6);
  const risk = RISK_PROFILES.includes(body.risk) ? body.risk : "balansiran";
  const mode = MODES[body.mode] ? body.mode : "ultra";
  const notes = String(body.notes || "").slice(0, 500);
  return { query, bankroll, currency, risk, mode, notes };
}

function startJob(res, opts) {
  if (activeJobId) return json(res, 409, { error: "Analiza je već u toku.", jobId: activeJobId });
  const blocked = budgetBlocked();
  if (blocked) return json(res, 402, { error: blocked });
  const job = createJob();
  runJob(job, opts);
  json(res, 200, { jobId: job.id });
}

function historyItem(a) {
  const s = planStats(a);
  return {
    id: a.id,
    query: a.query,
    league: a.plan?.league || null,
    round: a.plan?.round || null,
    dates: a.plan?.dates || null,
    createdAt: a.createdAt,
    mode: a.mode,
    currency: a.currency,
    cost: (a.cost?.research || 0) + (a.cost?.analysis || 0),
    hasPlan: !!a.plan,
    error: a.error || null,
    demo: !!a.demo,
    placed: s.placed,
    placedStake: s.placedStake,
    settledProfit: s.settledProfit,
    pending: s.pending,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const m = (re) => p.match(re);
    let r;

    if (req.method === "GET" && p === "/api/state") {
      const items = listAnalyses().map(historyItem);
      const balance = {};
      for (const h of items) {
        if (!h.placed || h.demo) continue;
        const b = (balance[h.currency] ??= { profit: 0, staked: 0, pending: 0 });
        b.profit += h.settledProfit;
        b.staked += h.placedStake;
        b.pending += h.pending;
      }
      return json(res, 200, {
        spend: { ...spendSummary(), budget: env.monthlyBudget },
        balance,
        history: items,
        activeJobId,
        demo: env.demo,
        model: MODEL,
        modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, { label: v.label, research: v.research, analysis: v.analysis }])),
      });
    }

    if (req.method === "POST" && p === "/api/analyze") {
      const body = await readBody(req);
      const opts = parseRunOptions(body);
      if (opts.query.length < 3) return json(res, 400, { error: "Upiši ligu, npr. „Bundesliga ovaj vikend“." });
      return startJob(res, { ...opts, refresh: !!body.refresh });
    }

    if (req.method === "POST" && (r = m(/^\/api\/analyses\/([\w-]+)\/rerun$/))) {
      const src = getAnalysis(r[1]);
      if (!src?.dossier) return json(res, 404, { error: "Analiza ne postoji." });
      const body = await readBody(req);
      const opts = parseRunOptions({ ...src, ...body, query: src.query });
      return startJob(res, { ...opts, sourceId: src.id });
    }

    if ((r = m(/^\/api\/analyses\/([\w-]+)$/))) {
      if (req.method === "GET") {
        const a = getAnalysis(r[1]);
        return a ? json(res, 200, a) : json(res, 404, { error: "Analiza ne postoji." });
      }
      if (req.method === "PATCH") {
        const a = getAnalysis(r[1]);
        if (!a) return json(res, 404, { error: "Analiza ne postoji." });
        const body = await readBody(req);
        if (body.state && typeof body.state === "object") a.state = body.state;
        saveAnalysis(a);
        return json(res, 200, { ok: true });
      }
      if (req.method === "DELETE") return json(res, 200, { ok: deleteAnalysis(r[1]) });
    }

    if (req.method === "GET" && (r = m(/^\/api\/jobs\/([\w-]+)\/stream$/))) {
      const job = jobs.get(r[1]);
      if (!job) return json(res, 404, { error: "Posao ne postoji." });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (job.done) return res.end();
      job.clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 20000);
      req.on("close", () => {
        clearInterval(ping);
        job.clients.delete(res);
      });
      return;
    }

    if (req.method === "POST" && (r = m(/^\/api\/jobs\/([\w-]+)\/cancel$/))) {
      const job = jobs.get(r[1]);
      if (job && !job.done) job.ac.abort();
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && !p.startsWith("/api/")) {
      const f = path.normalize(path.join(PUBLIC, p === "/" ? "index.html" : p));
      if (!f.startsWith(PUBLIC + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" });
      return fs.createReadStream(f).pipe(res);
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: "Greška servera." });
  }
});

server.listen(env.port, env.host, () => {
  const where = `http://${env.host === "0.0.0.0" ? "localhost" : env.host}:${env.port}`;
  console.log(`kolo · AI analiza kola → ${where}${env.demo ? "  [DEMO režim, bez API troška]" : ""}`);
  if (!env.demo && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("Upozorenje: ANTHROPIC_API_KEY nije postavljen (.env). Za probu bez ključa: npm run demo");
  }
});
