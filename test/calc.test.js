// Brzi testovi matematike tiketa: node test/calc.test.js
import assert from "node:assert/strict";
import { ticketStats, combinations } from "../public/calc.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const leg = (odds, prob, push = 0, stake_pct = 0) => ({ odds, prob, push_prob: push, stake_pct });

// Kombinacije
assert.equal(combinations(4, 2).length, 6);
assert.equal(combinations(6, 3).length, 20);
assert.deepEqual(combinations(3, 3), [[0, 1, 2]]);

// Kombinacija: kvota = proizvod, EV = ulog·(Π(p·k+push) − 1)
{
  const t = { type: "kombinacija", stake_pct: 10, system_k: 0, picks: [leg(1.5, 0.7), leg(2.0, 0.5, 0.2)] };
  const s = ticketStats(t, 100, {});
  close(s.stake, 10);
  close(s.odds, 3);
  close(s.ev, 10 * ((0.7 * 1.5) * (0.5 * 2 + 0.2) - 1));
  close(s.max, 30);
  assert.equal(s.settled, false);
  // povrat na drugoj nozi => kvota 1
  const r = ticketStats(t, 100, { res: { 0: "W", 1: "P" } });
  close(r.ret, 15);
  close(r.profit, 5);
  // pad bilo koje noge završava tiket
  assert.equal(ticketStats(t, 100, { res: { 1: "L" } }).profit, -10);
  // ručna kvota
  close(ticketStats(t, 100, { odds: { 0: "1.8" } }).odds, 3.6);
}

// Pojedinačno: ulog po tipu
{
  const t = { type: "pojedinacno", stake_pct: 0, system_k: 0, picks: [leg(1.4, 0.8, 0, 10), leg(2.5, 0.45, 0, 5)] };
  const s = ticketStats(t, 200, {});
  close(s.stake, 30);
  close(s.ev, 20 * (0.8 * 1.4 - 1) + 10 * (0.45 * 2.5 - 1));
  const r = ticketStats(t, 200, { res: { 0: "W", 1: "L" } });
  close(r.ret, 28);
  close(r.profit, -2);
  // ručni ukupni ulog skalira proporcionalno
  close(ticketStats(t, 200, { stake: 60 }).perLeg[0].stake, 40);
}

// Sistem 2/3
{
  const t = { type: "sistem", stake_pct: 3, system_k: 2, picks: [leg(3, 0.4), leg(4, 0.3), leg(5, 0.25)] };
  const s = ticketStats(t, 100, {});
  assert.equal(s.combos, 3);
  close(s.max, 1 * (12 + 15 + 20));
  close(s.ev, 1 * (1.2 * 1.2 + 1.2 * 1.25 + 1.2 * 1.25) - 3);
  // P(bar 2 od 3)
  close(s.prob, 0.4 * 0.3 * 0.75 + 0.4 * 0.7 * 0.25 + 0.6 * 0.3 * 0.25 + 0.4 * 0.3 * 0.25);
  // dva pala => mrtav sistem
  assert.equal(ticketStats(t, 100, { res: { 0: "L", 1: "L" } }).profit, -3);
  const r = ticketStats(t, 100, { res: { 0: "W", 1: "W", 2: "L" } });
  close(r.ret, 12);
}

console.log("calc: svi testovi prošli");
