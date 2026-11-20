// Jednostavno skladište na disku: data/analyses/*.json i data/spend.jsonl
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.KOLO_DATA_DIR || path.join(here, "..", "data");
const ANALYSES = path.join(DATA, "analyses");
const SPEND = path.join(DATA, "spend.jsonl");
fs.mkdirSync(ANALYSES, { recursive: true });

const safeId = (id) => /^[a-z0-9-]{6,40}$/.test(id);
const file = (id) => path.join(ANALYSES, `${id}.json`);

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeQuery(q) {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "dj")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function saveAnalysis(a) {
  a.updatedAt = new Date().toISOString();
  const tmp = file(a.id) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(a, null, 1));
  fs.renameSync(tmp, file(a.id));
  return a;
}

export function getAnalysis(id) {
  if (!safeId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(file(id), "utf8"));
  } catch {
    return null;
  }
}

export function deleteAnalysis(id) {
  if (!safeId(id)) return false;
  try {
    fs.unlinkSync(file(id));
    return true;
  } catch {
    return false;
  }
}

export function listAnalyses() {
  return fs
    .readdirSync(ANALYSES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ANALYSES, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Svjež dosije za isti (normalizovan) upit — da se web ne pretražuje ponovo.
export function findFreshDossier(query, ttlHours) {
  const key = normalizeQuery(query);
  const cutoff = Date.now() - ttlHours * 3600_000;
  return listAnalyses().find(
    (a) => a.dossier && a.queryKey === key && new Date(a.dossierAt || a.createdAt).getTime() > cutoff,
  );
}

export function recordSpend(entry) {
  fs.appendFileSync(SPEND, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

export function spendSummary() {
  let lines = [];
  try {
    lines = fs.readFileSync(SPEND, "utf8").split("\n").filter(Boolean);
  } catch {}
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const s = { today: 0, month: 0, total: 0, calls: 0 };
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      s.total += e.cost || 0;
      s.calls++;
      if (e.ts.startsWith(month)) s.month += e.cost || 0;
      if (e.ts.startsWith(day)) s.today += e.cost || 0;
    } catch {}
  }
  return s;
}
