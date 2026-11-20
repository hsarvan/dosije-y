// Matematika tiketa — dijele je server i browser. Bez troška: sve se računa lokalno.
// Tip (leg): prob = vjerovatnoća punog dobitka, push = vjerovatnoća povrata uloga.
// Očekivani povrat po jedinici uloga = prob·kvota + push. Nogu ne-zavisnih mečeva množimo.

const num = (x) => (x === "" || x == null || !Number.isFinite(+x) ? null : +x);
const sum = (arr) => arr.reduce((s, x) => s + x, 0);
const prod = (arr) => arr.reduce((s, x) => s * x, 1);

export function combinations(n, k) {
  const out = [];
  const cur = [];
  (function rec(start) {
    if (cur.length === k) return void out.push(cur.slice());
    for (let i = start; i <= n - (k - cur.length); i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  })(0);
  return out;
}

export function legsOf(ticket, ts = {}) {
  return ticket.picks.map((p, i) => ({
    odds: num(ts.odds?.[i]) ?? p.odds,
    prob: p.prob,
    push: p.push_prob || 0,
    stakePct: p.stake_pct || 0,
    res: ts.res?.[i] || null, // "W" | "L" | "P" | null
  }));
}

const expFactor = (l) => l.prob * l.odds + l.push;
const resFactor = (l) => (l.res === "W" ? l.odds : l.res === "P" ? 1 : l.res === "L" ? 0 : null);

// Vjerovatnoća da prođe bar k od n nezavisnih nogu (DP).
function atLeast(probs, k) {
  let dp = [1];
  for (const p of probs) {
    const nx = new Array(dp.length + 1).fill(0);
    dp.forEach((v, j) => {
      nx[j] += v * (1 - p);
      nx[j + 1] += v * p;
    });
    dp = nx;
  }
  return sum(dp.slice(k));
}

export function ticketStats(ticket, bankroll, ts = {}) {
  const L = legsOf(ticket, ts);
  const n = L.length;
  const B = num(bankroll) ?? 0;
  const override = num(ts.stake);

  if (ticket.type === "pojedinacno") {
    const base = sum(L.map((l) => l.stakePct));
    const scale = override != null && base > 0 ? override / ((B * base) / 100) : 1;
    const items = L.map((l) => {
      const stake = ((B * l.stakePct) / 100) * scale;
      const f = resFactor(l);
      return { stake, ev: stake * (expFactor(l) - 1), max: stake * l.odds, ret: f == null ? null : stake * f };
    });
    const stake = sum(items.map((x) => x.stake));
    const settled = n > 0 && items.every((x) => x.ret != null);
    const ret = sum(items.map((x) => x.ret ?? 0));
    return {
      kind: "pojedinacno",
      stake,
      odds: null,
      prob: stake > 0 ? sum(items.map((x, i) => x.stake * L[i].prob)) / stake : 0,
      ev: sum(items.map((x) => x.ev)),
      max: sum(items.map((x) => x.max)),
      perLeg: items,
      combos: n,
      settled,
      ret: settled ? ret : null,
      profit: settled ? ret - stake : null,
    };
  }

  const stake = override ?? (B * (ticket.stake_pct || 0)) / 100;
  const isSystem = ticket.type === "sistem" && ticket.system_k >= 1 && ticket.system_k < n;

  if (!isSystem) {
    const odds = prod(L.map((l) => l.odds));
    const lost = L.some((l) => l.res === "L");
    const allDone = L.every((l) => l.res);
    const settled = n > 0 && (lost || allDone);
    const ret = lost ? 0 : allDone ? stake * prod(L.map(resFactor)) : null;
    return {
      kind: "kombinacija",
      stake,
      odds,
      prob: prod(L.map((l) => l.prob)),
      safe: prod(L.map((l) => l.prob + l.push)),
      ev: stake * (prod(L.map(expFactor)) - 1),
      max: stake * odds,
      combos: 1,
      settled,
      ret: settled ? ret : null,
      profit: settled ? ret - stake : null,
    };
  }

  const k = ticket.system_k;
  const cs = combinations(n, k);
  const per = stake / cs.length;
  const losses = L.filter((l) => l.res === "L").length;
  const allDone = L.every((l) => l.res);
  const dead = losses > n - k;
  const settled = allDone || dead;
  let ret = null;
  if (settled) {
    ret = dead
      ? 0
      : per * sum(cs.map((c) => prod(c.map((i) => resFactor(L[i])))));
  }
  return {
    kind: "sistem",
    stake,
    odds: Math.max(...cs.map((c) => prod(c.map((i) => L[i].odds)))),
    prob: atLeast(L.map((l) => l.prob), k),
    ev: per * sum(cs.map((c) => prod(c.map((i) => expFactor(L[i]))))) - stake,
    max: per * sum(cs.map((c) => prod(c.map((i) => L[i].odds)))),
    combos: cs.length,
    perCombo: per,
    settled,
    ret,
    profit: settled ? ret - stake : null,
  };
}

// Sažetak cijele analize (za sve tikete, i posebno za uplaćene).
export function planStats(analysis) {
  const plan = analysis.plan;
  const st = analysis.state || {};
  const B = num(st.bankroll) ?? analysis.bankroll;
  const out = { stake: 0, ev: 0, max: 0, placedStake: 0, settledProfit: 0, pending: 0, placed: 0 };
  if (!plan) return out;
  for (const t of plan.tickets) {
    const ts = st.tickets?.[t.id] || {};
    const s = ticketStats(t, B, ts);
    out.stake += s.stake;
    out.ev += s.ev;
    out.max += s.max;
    if (ts.placed) {
      out.placed++;
      out.placedStake += s.stake;
      if (s.settled) out.settledProfit += s.profit;
      else out.pending++;
    }
  }
  return out;
}
