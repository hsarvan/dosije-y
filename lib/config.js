// Centralna konfiguracija: model, cijene, režimi rada.

export const MODEL = "claude-opus-5-5";

// USD po 1M tokena (Anthropic list cijene). Ako server-side fallback preuzme
// odgovor, račun se vodi po modelu koji je stvarno odgovorio.
export const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};
export const WEB_SEARCH_USD = 0.01; // $10 / 1000 pretraga

// Dva režima. "ultra" = Opus 5.5 s maksimalnim razmišljanjem u fazi analize.
// Istraživanje (faza 1) je namjerno jeftinije: prikupljanje podataka ne treba
// max razmišljanje, a pretrage i rezultati pretraga su najveći trošak.
export const MODES = {
  standard: {
    label: "Standard",
    research: { effort: "medium", searches: 12, fetches: 4, maxTokens: 32000 },
    analysis: { effort: "high", maxTokens: 48000 },
  },
  ultra: {
    label: "Ultra",
    research: { effort: "high", searches: 22, fetches: 8, maxTokens: 48000 },
    analysis: { effort: "max", maxTokens: 128000 },
  },
};

export const RISK_PROFILES = ["oprezan", "balansiran", "agresivan"];

export const env = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  password: process.env.APP_PASSWORD || "",
  monthlyBudget: Number(process.env.MONTHLY_BUDGET_USD || 0),
  dossierTtlHours: Number(process.env.DOSSIER_TTL_HOURS || 12),
  demo: ["1", "true", "yes"].includes(String(process.env.DEMO || "").toLowerCase()),
};

export function priceUsage(model, usage) {
  if (!usage) return 0;
  const p = PRICES[model] || PRICES[MODEL];
  const M = 1_000_000;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const searches = usage.server_tool_use?.web_search_requests || 0;
  return (
    ((usage.input_tokens || 0) * p.input) / M +
    ((usage.output_tokens || 0) * p.output) / M +
    (cacheWrite * p.cacheWrite) / M +
    (cacheRead * p.cacheRead) / M +
    searches * WEB_SEARCH_USD
  );
}
