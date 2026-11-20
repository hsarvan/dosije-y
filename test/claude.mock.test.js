// Test Claude integracije bez troška: lažni fetch vraća SSE odgovore.
// Provjerava oblik zahtjeva (model, effort, alati, fallback, shema, keširanje),
// nastavak nakon pause_turn, izvlačenje dosijea i parsiranje plana.
import assert from "node:assert/strict";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { research, analyze, setClient } from "../lib/claude.js";

const plan = fs.readFileSync(new URL("../demo/plan.json", import.meta.url), "utf8");
const usage = (o) => ({ input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 }, ...o });

function sse(blocks, stop) {
  const ev = [];
  const push = (type, data) => ev.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  push("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      push("content_block_start", { index, content_block: { type: "text", text: "" } });
      for (let i = 0; i < b.text.length; i += 700) push("content_block_delta", { index, delta: { type: "text_delta", text: b.text.slice(i, i + 700) } });
    } else if (b.type === "thinking") {
      push("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      push("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } });
      push("content_block_delta", { index, delta: { type: "signature_delta", signature: "sig" } });
    } else if (b.type === "server_tool_use") {
      push("content_block_start", { index, content_block: { type: "server_tool_use", id: b.id, name: b.name, input: {} } });
      push("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    } else {
      push("content_block_start", { index, content_block: b });
    }
    push("content_block_stop", { index });
  });
  push("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: usage() });
  push("message_stop", {});
  return ev.join("");
}

const requests = [];
const responses = [];
const fakeFetch = async (url, init) => {
  requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
  const body = responses.shift();
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
setClient(new Anthropic({ apiKey: "test-key", fetch: fakeFetch, maxRetries: 0 }));

const events = [];
const emit = (e) => events.push(e);

// ---- Faza 1: pauza pa nastavak ----
responses.push(
  sse(
    [
      { type: "thinking", thinking: "Tražim raspored kola." },
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Bundesliga 12. kolo raspored" } },
      { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://x.com", title: "x", encrypted_content: "e", page_age: null }] },
    ],
    "pause_turn",
  ),
  sse([{ type: "text", text: "Uvod koji treba odbaciti.\n=== DOSIJE ===\nLIGA: Bundesliga | KOLO: 12 | STATUS: OK\n" + "M1 | A – B | sub 15:30\nTABELA: ...\n".repeat(10) }], "end_turn"),
);
const r1 = await research({ query: "Bundesliga ovaj vikend", mode: "ultra", emit });
assert.equal(requests.length, 2, "pause_turn mora dovesti do drugog zahtjeva");
const q1 = requests[0];
assert.match(q1.url, /\/v1\/messages/);
assert.match(q1.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
assert.equal(q1.body.model, "claude-opus-5-5");
assert.equal(q1.body.fallbacks, "default");
assert.equal(q1.body.output_config.effort, "high");
assert.deepEqual(q1.body.thinking, { type: "adaptive", display: "summarized" });
assert.deepEqual(q1.body.cache_control, { type: "ephemeral" });
assert.equal(q1.body.stream, true);
assert.deepEqual(q1.body.tools.map((t) => t.type), ["web_search_20260209", "web_fetch_20260209"]);
assert.equal(q1.body.tools[0].max_uses, 22);
assert.ok(!("temperature" in q1.body));
// nastavak: ista historija + asistentov odgovor, bez dodatne korisničke poruke
const q2 = requests[1].body;
assert.equal(q2.messages.length, 2);
assert.equal(q2.messages[1].role, "assistant");
assert.ok(q2.messages[1].content.some((b) => b.type === "server_tool_use"));
assert.deepEqual(q2.tools, q1.body.tools, "alati se ne smiju mijenjati između nastavaka");
assert.ok(r1.dossier.startsWith("=== DOSIJE ==="), "dosije počinje markerom");
assert.equal(r1.usage.searches, 4);
assert.ok(events.some((e) => e.type === "log" && e.icon === "search" && e.text.includes("raspored")), "pretraga prikazana u UI");
// trošak: 2 × (1000·4 + 500·20 + 2000·0.2)/1e6 + 4 pretrage × 0.01
assert.ok(Math.abs(r1.cost - (2 * (4000 + 10000 + 400) / 1e6 + 0.04)) < 1e-9, `trošak ${r1.cost}`);

// ---- Faza 2: strukturiran JSON ----
responses.push(sse([{ type: "thinking", thinking: "Modeliram λ." }, { type: "text", text: plan }], "end_turn"));
const r2 = await analyze({ query: "Bundesliga", dossier: r1.dossier, bankroll: 100, currency: "KM", risk: "balansiran", notes: "", mode: "ultra", emit });
const q3 = requests[2].body;
assert.equal(q3.output_config.effort, "max");
assert.equal(q3.output_config.format.type, "json_schema");
assert.equal(q3.output_config.format.schema.additionalProperties, false);
assert.equal(q3.max_tokens, 128000);
assert.equal(q3.tools, undefined, "faza 2 nema alate");
assert.deepEqual(q3.system[0].cache_control, { type: "ephemeral" });
assert.ok(q3.messages[0].content[0].text.includes("=== DOSIJE ==="));
assert.deepEqual(q3.messages[0].content[0].cache_control, { type: "ephemeral" });
assert.ok(q3.messages[0].content[1].text.includes("100 KM"));
assert.equal(r2.plan.tickets.length, 5);
assert.equal(r2.plan.tickets[0].strategy, "sigurica");

// ---- Odbijanje i prekoračenje ----
responses.push(sse([{ type: "text", text: "{" }], "max_tokens"));
await assert.rejects(analyze({ query: "x", dossier: "d", bankroll: 1, currency: "KM", risk: "oprezan", mode: "standard", emit }), /limit tokena/);
responses.push(sse([], "refusal"));
await assert.rejects(analyze({ query: "x", dossier: "d", bankroll: 1, currency: "KM", risk: "oprezan", mode: "standard", emit }), /odbio/);

// Svi poslani zahtjevi moraju proći shemu: bez prefill-a, poruke počinju korisnikom.
for (const r of requests) assert.equal(r.body.messages[0].role, "user");

console.log("claude (mock): svi testovi prošli");
