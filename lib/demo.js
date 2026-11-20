// DEMO režim: simulira obje faze bez API ključa i bez troška (izmišljeni podaci).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankUsage, UserError } from "./claude.js";
import { sanitizePlan } from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", "demo", f), "utf8");

const sleep = (ms, signal) =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(Object.assign(new UserError("Analiza je prekinuta."), { name: "AbortError" }));
    });
  });

export async function demoResearch({ emit, signal }) {
  const steps = [
    ["search", "Demo liga 12. kolo raspored"],
    ["search", "Demo liga tabela domaćin gost"],
    ["fetch", "https://example.com/demo-liga/xg"],
    ["search", "Demo liga povrede suspenzije 12. kolo"],
    ["search", "Demo liga kvote 12. kolo"],
    ["search", "Bergheim Elbtal h2h poluvrijeme"],
  ];
  for (const [icon, text] of steps) {
    await sleep(450, signal);
    emit({ type: "log", icon, text });
    emit({ type: "thinking", text: `Provjeravam: ${text}. ` });
  }
  emit({ type: "cost", phase: "research", cost: 0, usage: blankUsage() });
  return { dossier: read("dossier.txt"), cost: 0, usage: blankUsage(), model: "demo" };
}

export async function demoAnalyze({ emit, signal }) {
  const thoughts = [
    "Računam λ za svaki meč iz xG i forme kod kuće/u gostima. ",
    "Rheinau–Nordhafen: λ 2.05 / 0.85, kvota 1.55 implicira 62% — blizu modela, ali 1X na 1.22 nosi 84%. ",
    "Steinfeld u gostima: model 36% naspram 31% tržišta — value. ",
    "Ostend–Moorbach bez vrijednosti u 1X2, ali Manje 3.0 s povratom ima smisla. ",
    "Slažem portfolio: sigurica, value, mix, sistem 2/4 i forma. Ulozi po ¼ Kelly. ",
  ];
  for (const t of thoughts) {
    await sleep(600, signal);
    emit({ type: "thinking", text: t });
  }
  for (let c = 400; c <= 4000; c += 900) {
    await sleep(200, signal);
    emit({ type: "writing", chars: c });
  }
  emit({ type: "cost", phase: "analysis", cost: 0, usage: blankUsage() });
  return { plan: sanitizePlan(JSON.parse(read("plan.json"))), cost: 0, usage: blankUsage(), model: "demo" };
}
