// JSON shema izlaza faze 2 (structured outputs garantuju validan JSON).

const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });
const int = (description) => ({ type: "integer", description });

const obj = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const pick = obj({
  match_id: str("Id meča iz dosijea, npr. M3"),
  match: str("Domaćin – Gost"),
  market: str("Tržište, npr. Dupla šansa, Ukupno golova (azijski), Tim daje gol, Poluvrijeme/Kraj"),
  pick: str("Tip kako ga kladionica piše, npr. 1X, Više 2.0 (tačno 2 = povrat), Domaćin daje gol, 2/1"),
  odds: num("Decimalna kvota za ovaj tip"),
  odds_source: { type: "string", enum: ["kladionica", "procjena"] },
  prob: num("Konačna vjerovatnoća punog dobitka, 0–1"),
  push_prob: num("Vjerovatnoća povrata uloga (azijske linije, ishod bez remija), inače 0"),
  stake_pct: num("Samo za pojedinačne tikete: % budžeta za ovaj tip. Inače 0"),
  reason: str("Jedna rečenica zašto"),
});

const ticket = obj({
  id: str("T1, T2, ..."),
  name: str("Kratko ime tiketa, npr. Sigurica, Value, Ludi sistem 2/4, Mix"),
  strategy: { type: "string", enum: ["sigurica", "value", "forma_h2h", "ludi_sistem", "mix", "ostalo"] },
  type: { type: "string", enum: ["pojedinacno", "kombinacija", "sistem"] },
  system_k: int("Za sistem: koliko tipova mora proći u kombinaciji (k u k/n). Inače 0"),
  stake_pct: num("Ulog cijelog tiketa u % budžeta (za pojedinačne = zbir tipova)"),
  risk: { type: "string", enum: ["nizak", "srednji", "visok", "ekstreman"] },
  idea: str("Strategija tiketa u 1–2 rečenice"),
  picks: { type: "array", items: pick },
});

const match = obj({
  id: str("M1, M2, ..."),
  home: str("Domaćin"),
  away: str("Gost"),
  kickoff: str("Dan i vrijeme, npr. sub 15:30"),
  xg_home: num("Očekivani golovi domaćina (λ)"),
  xg_away: num("Očekivani golovi gosta (λ)"),
  p_home: num("Vjerovatnoća 1"),
  p_draw: num("Vjerovatnoća X"),
  p_away: num("Vjerovatnoća 2"),
  p_over25: num("Vjerovatnoća 3+ golova"),
  p_btts: num("Vjerovatnoća GG"),
  likely_score: str("Najvjerovatniji rezultat"),
  confidence: int("Pouzdanost procjene 1–5"),
  verdict: str("Kratak zaključak o meču"),
  key_factors: { type: "array", items: { type: "string" } },
});

export const PLAN_SCHEMA = obj({
  league: str("Liga"),
  round: str("Kolo"),
  dates: str("Datumi kola"),
  overview: str("2–4 rečenice o kolu i strategiji"),
  bankroll_note: str("Kako je budžet raspoređen i zašto"),
  matches: { type: "array", items: match },
  tickets: { type: "array", items: ticket },
  avoid: { type: "array", items: obj({ match: str("Meč"), reason: str("Zašto ga preskočiti") }) },
  warnings: { type: "array", items: { type: "string" } },
});

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+x) ? +x : lo));

// Sanitizacija: model vraća validan JSON, ali brojke dodatno ograničavamo.
export function sanitizePlan(plan) {
  plan.matches ??= [];
  plan.tickets ??= [];
  plan.avoid ??= [];
  plan.warnings ??= [];
  for (const t of plan.tickets) {
    t.picks ??= [];
    for (const p of t.picks) {
      p.prob = clamp(p.prob > 1 ? p.prob / 100 : p.prob, 0, 1);
      p.push_prob = clamp(p.push_prob > 1 ? p.push_prob / 100 : p.push_prob, 0, 1 - p.prob);
      p.odds = clamp(p.odds, 1.01, 1000);
      p.stake_pct = clamp(p.stake_pct, 0, 100);
    }
    t.stake_pct = clamp(t.stake_pct, 0, 100);
    if (t.type === "pojedinacno") {
      t.stake_pct = +t.picks.reduce((s, p) => s + p.stake_pct, 0).toFixed(2);
    }
    if (t.type === "sistem") {
      const n = t.picks.length;
      if (!(t.system_k >= 1 && t.system_k < n)) t.type = "kombinacija";
    }
    if (t.type !== "sistem") t.system_k = 0;
  }
  for (const m of plan.matches) {
    for (const k of ["p_home", "p_draw", "p_away", "p_over25", "p_btts"]) m[k] = clamp(m[k] > 1 ? m[k] / 100 : m[k], 0, 1);
    m.confidence = clamp(Math.round(m.confidence), 1, 5);
  }
  return plan;
}
