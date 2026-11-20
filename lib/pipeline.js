// Cijela analiza kola (istraživanje + strategija) — koriste je web server i Telegram bot.
import { env } from "./config.js";
import { research, analyze, friendlyError } from "./claude.js";
import { demoResearch, demoAnalyze } from "./demo.js";
import { newId, normalizeQuery, saveAnalysis, getAnalysis, findFreshDossier, recordSpend, spendSummary } from "./store.js";

export function budgetBlocked() {
  if (env.demo || !env.monthlyBudget) return null;
  const s = spendSummary();
  if (s.month >= env.monthlyBudget)
    return `Mjesečni budžet za AI ($${env.monthlyBudget}) je potrošen ($${s.month.toFixed(2)}). Povećaj MONTHLY_BUDGET_USD.`;
  return null;
}

// opts: query, bankroll, currency, risk, mode, notes, refresh, sourceId, source ("web"|"telegram")
// Vraća sačuvanu analizu. Kod greške baca Error s .friendly i .analysis (ako je dosije plaćen).
export async function runAnalysis(opts, { emit = () => {}, signal } = {}) {
  const { query, bankroll, currency, risk, mode, notes = "", refresh, sourceId } = opts;
  const run = env.demo ? { research: demoResearch, analyze: demoAnalyze } : { research, analyze };
  const a = {
    id: newId(),
    query,
    queryKey: normalizeQuery(query),
    createdAt: new Date().toISOString(),
    source: opts.source || "web",
    mode,
    bankroll,
    currency,
    risk,
    notes,
    demo: env.demo,
    cost: { research: 0, analysis: 0 },
    usage: {},
    state: {},
  };
  try {
    // Faza 1 — istraživanje (ili ponovna upotreba svježeg dosijea = 0 troška)
    const source = sourceId ? getAnalysis(sourceId) : refresh ? null : findFreshDossier(query, env.dossierTtlHours);
    if (source?.dossier) {
      a.dossier = source.dossier;
      a.dossierAt = source.dossierAt || source.createdAt;
      a.reusedFrom = source.id;
      emit({ type: "phase", phase: "research", status: "reused", at: a.dossierAt });
    } else {
      emit({ type: "phase", phase: "research", status: "start", mode });
      const r = await run.research({ query, mode, emit, signal });
      a.dossier = r.dossier;
      a.dossierAt = new Date().toISOString();
      a.cost.research = r.cost;
      a.usage.research = r.usage;
      if (!env.demo) recordSpend({ phase: "research", cost: r.cost, query, analysisId: a.id, model: r.model });
      emit({ type: "phase", phase: "research", status: "done" });
    }
    saveAnalysis(a); // dosije je plaćen — čuva se i ako faza 2 padne

    // Faza 2 — analiza i tiketi
    emit({ type: "phase", phase: "analysis", status: "start", mode });
    const r2 = await run.analyze({ query, dossier: a.dossier, bankroll, currency, risk, notes, mode, emit, signal });
    a.plan = r2.plan;
    a.model = r2.model;
    a.cost.analysis = r2.cost;
    a.usage.analysis = r2.usage;
    if (!env.demo) recordSpend({ phase: "analysis", cost: r2.cost, query, analysisId: a.id, model: r2.model });
    saveAnalysis(a);
    return a;
  } catch (e) {
    if (e?.cost && !env.demo) recordSpend({ phase: "failed", cost: e.cost, query, analysisId: a.id });
    a.error = friendlyError(e);
    if (a.dossier) saveAnalysis(a);
    throw Object.assign(new Error(a.error), { friendly: a.error, analysis: a.dossier ? a : null, cause: e });
  }
}
