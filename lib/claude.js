// Integracija s Claude API-jem (Opus 5.5).
// Faza 1: istraživanje kola preko web pretrage -> kompaktan dosije (tekst).
// Faza 2: analiza + strategija -> plan s tiketima (structured output, JSON).
// Dvije faze = manji trošak: skupo "max" razmišljanje čita samo kratak dosije,
// a ne stotine hiljada tokena sirovih rezultata pretrage.
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, MODES, priceUsage } from "./config.js";
import { RESEARCH_SYSTEM, ANALYST_SYSTEM, researchUserMessage, analysisParams } from "./prompts.js";
import { PLAN_SCHEMA, sanitizePlan } from "./schema.js";

export class UserError extends Error {}

// Server-side fallback: ako sigurnosni klasifikator odbije zahtjev, API ga
// sam ponovi na preporučenom modelu (cijena se računa po modelu koji je odgovorio).
const BETAS = ["server-side-fallback-2026-07-01"];
const MAX_CONTINUATIONS = 4;

let client;
const api = () => (client ??= new Anthropic({ maxRetries: 3, timeout: 20 * 60 * 1000 }));
export const setClient = (c) => (client = c); // za testove

export function blankUsage() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, thinking: 0, searches: 0, fetches: 0 };
}

function addUsage(acc, u) {
  if (!u) return acc;
  acc.input += u.input_tokens || 0;
  acc.output += u.output_tokens || 0;
  acc.cacheWrite += u.cache_creation_input_tokens || 0;
  acc.cacheRead += u.cache_read_input_tokens || 0;
  acc.thinking += u.output_tokens_details?.thinking_tokens || 0;
  acc.searches += u.server_tool_use?.web_search_requests || 0;
  acc.fetches += u.server_tool_use?.web_fetch_requests || 0;
  return acc;
}

// Prosljeđuje napredak u UI: pretrage, sažetak razmišljanja, dužinu izlaza.
function wireProgress(stream, emit) {
  let buf = "";
  let last = 0;
  const flush = () => {
    if (buf) emit({ type: "thinking", text: buf });
    buf = "";
    last = Date.now();
  };
  stream.on("thinking", (delta) => {
    buf += delta;
    if (Date.now() - last > 500) flush();
  });
  let chars = 0;
  stream.on("text", (delta) => {
    chars += delta.length;
    if (chars % 400 < delta.length) emit({ type: "writing", chars });
  });
  stream.on("contentBlock", (b) => {
    flush();
    if (b.type === "thinking") emit({ type: "thinking", text: "\n" });
    if (b.type === "server_tool_use") {
      if (b.name === "web_search") emit({ type: "log", icon: "search", text: String(b.input?.query ?? "") });
      else if (b.name === "web_fetch") emit({ type: "log", icon: "fetch", text: String(b.input?.url ?? "") });
    }
    if (b.type === "web_search_tool_result" && b.content && !Array.isArray(b.content)) {
      emit({ type: "log", icon: "warn", text: `pretraga nije uspjela (${b.content.error_code})` });
    }
  });
}

function checkStop(msg) {
  if (msg.stop_reason === "refusal") {
    throw new UserError("Claude je odbio ovaj zahtjev. Preformuliši upit (npr. samo naziv lige i kolo).");
  }
}

export async function research({ query, mode, emit, signal }) {
  const cfg = MODES[mode].research;
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: cfg.searches },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: cfg.fetches, max_content_tokens: 12000 },
  ];
  const messages = [{ role: "user", content: researchUserMessage({ query, searches: cfg.searches, fetches: cfg.fetches }) }];
  const usage = blankUsage();
  let cost = 0;
  let text = "";
  let model = MODEL;

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = api().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: cfg.maxTokens,
        betas: BETAS,
        fallbacks: "default",
        cache_control: { type: "ephemeral" }, // automatsko keširanje prefiksa (sistem + alati + historija)
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: cfg.effort },
        system: RESEARCH_SYSTEM,
        tools,
        messages,
      },
      { signal },
    );
    wireProgress(stream, emit);
    const msg = await stream.finalMessage();
    model = msg.model;
    addUsage(usage, msg.usage);
    cost += priceUsage(msg.model, msg.usage);
    emit({ type: "cost", phase: "research", cost, usage });
    checkStop(msg);
    text += msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    // Server-side petlja alata je pauzirana: vrati odgovor kakav jeste i nastavi.
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    if (msg.stop_reason === "max_tokens") emit({ type: "log", icon: "warn", text: "dosije je skraćen (limit tokena)" });
    break;
  }

  const i = text.lastIndexOf("=== DOSIJE ===");
  const dossier = (i >= 0 ? text.slice(i) : text).trim();
  if (dossier.length < 150) {
    throw Object.assign(new UserError("Istraživanje nije vratilo upotrebljive podatke. Probaj precizniji upit (liga + kolo ili datum)."), { cost, usage });
  }
  return { dossier, cost, usage, model };
}

export async function analyze({ query, dossier, bankroll, currency, risk, notes, mode, emit, signal }) {
  const cfg = MODES[mode].analysis;
  const stream = api().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: cfg.maxTokens,
      betas: BETAS,
      fallbacks: "default",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: cfg.effort, format: { type: "json_schema", schema: PLAN_SCHEMA } },
      // Stabilan sistemski prompt i dosije su keširani: "Nova strategija" na
      // istom dosijeu u narednih 5 min plaća ulaz ~10x jeftinije.
      system: [{ type: "text", text: ANALYST_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `DOSIJE KOLA:\n${dossier}`, cache_control: { type: "ephemeral" } },
            { type: "text", text: analysisParams({ query, bankroll, currency, risk, notes }) },
          ],
        },
      ],
    },
    { signal },
  );
  wireProgress(stream, emit);
  const msg = await stream.finalMessage();
  const usage = addUsage(blankUsage(), msg.usage);
  const cost = priceUsage(msg.model, msg.usage);
  emit({ type: "cost", phase: "analysis", cost, usage });
  checkStop(msg);
  if (msg.stop_reason === "max_tokens") {
    throw Object.assign(new UserError("Analiza je prekoračila limit tokena. Probaj režim Standard ili uži upit."), { cost, usage });
  }
  const json = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  let plan;
  try {
    plan = sanitizePlan(JSON.parse(json));
  } catch {
    throw Object.assign(new UserError("Odgovor modela nije validan JSON. Pokušaj ponovo."), { cost, usage });
  }
  return { plan, cost, usage, model: msg.model };
}

export function friendlyError(e) {
  if (e instanceof UserError) return e.message;
  if (e instanceof Anthropic.APIUserAbortError) return "Analiza je prekinuta.";
  if (e instanceof Anthropic.AuthenticationError) return "Neispravan API ključ. Provjeri ANTHROPIC_API_KEY u .env fajlu.";
  if (e instanceof Anthropic.PermissionDeniedError) return "API ključ nema pristup modelu Opus 5.5.";
  if (e instanceof Anthropic.RateLimitError) return "Previše zahtjeva prema Claude API-ju. Pokušaj za minut.";
  if (e instanceof Anthropic.BadRequestError) return `Claude API je odbio zahtjev: ${e.message}`;
  if (e instanceof Anthropic.InternalServerError) return "Claude API je trenutno preopterećen. Pokušaj ponovo za par minuta.";
  if (e instanceof Anthropic.APIConnectionError) return "Nema veze s Claude API-jem. Provjeri internet.";
  if (e instanceof Anthropic.APIError) return `Greška Claude API-ja (${e.status}): ${e.message}`;
  if (/api[_ ]?key|credentials/i.test(String(e?.message))) return "Nedostaje ANTHROPIC_API_KEY. Upiši ga u .env (vidi .env.example).";
  return `Neočekivana greška: ${e?.message || e}`;
}
