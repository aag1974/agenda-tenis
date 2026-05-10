// Nota 0-10 da performance no match — calcula pros 2 lados (atleta e
// adversária). Pura, sem I/O. Não compara contra histórico (isso vai pro
// relatório de Performance depois).
//
// Pesos (somam 100% por lado):
//   25% — % pts ganhos no match  · sinal macro de domínio
//   25% — saldo ofensivo         · agressividade controlada
//   25% — % pts ganhos sacando   · eficiência no saque
//   25% — % pts ganhos recebendo · pressão sobre o saque adversário

const OFFENSIVE = {
  a: new Set(['ace', 'winner', 'returnwin_a']),
  o: new Set(['oppace', 'oppwinner', 'returnwin']),
};
const ERRORS = {
  a: new Set(['df', 'ue', 'fe', 'returnue_a']),
  o: new Set(['oppdf', 'returnue']),
};

function computeOneSide(side, pts) {
  const other = side === 'a' ? 'o' : 'a';
  const total = pts.length;
  if (total === 0) return { score: null, breakdown: null };

  const won = pts.filter(p => p.winner === side).length;
  const pctWon = won / total;

  const off = pts.filter(p => p.winner === side && OFFENSIVE[side].has(p.stat)).length;
  const err = pts.filter(p => p.winner === other && ERRORS[side].has(p.stat)).length;
  const balance = (off - err) / total;

  const servingPts = pts.filter(p => p.server === side);
  const wonServing = servingPts.filter(p => p.winner === side).length;
  const pctServing = servingPts.length > 0 ? wonServing / servingPts.length : null;

  const receivingPts = pts.filter(p => p.server === other);
  const wonReceiving = receivingPts.filter(p => p.winner === side).length;
  const pctReceiving = receivingPts.length > 0 ? wonReceiving / receivingPts.length : null;

  const pctToScore = (x) => Math.max(0, Math.min(10, x * 10));
  const balanceToScore = (b) => Math.max(0, Math.min(10, 5 + b * 10));

  const breakdown = {
    pctWon:    { value: pctWon,       score: pctToScore(pctWon) },
    balance:   { value: balance,      score: balanceToScore(balance) },
    serving:   { value: pctServing,   score: pctServing != null ? pctToScore(pctServing) : null },
    receiving: { value: pctReceiving, score: pctReceiving != null ? pctToScore(pctReceiving) : null },
  };

  const weights = { pctWon: 25, balance: 25, serving: 25, receiving: 25 };
  let total_w = 0, weighted = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (breakdown[k].score != null) {
      weighted += breakdown[k].score * w;
      total_w += w;
    }
  }
  const score = total_w > 0 ? weighted / total_w : null;
  return {
    score: score != null ? Math.round(score * 10) / 10 : null,
    breakdown,
  };
}

export function computeMatchScore(m) {
  const pts = (m && m.points) || [];
  if (pts.length === 0) {
    return { a: { score: null, breakdown: null }, o: { score: null, breakdown: null }, totalPts: 0 };
  }
  return {
    a: computeOneSide('a', pts),
    o: computeOneSide('o', pts),
    totalPts: pts.length,
  };
}

// Anexa a nota no objeto de match — chamado nos endpoints antes de res.json.
export function attachScore(m) {
  if (!m) return m;
  m.computedScore = computeMatchScore(m);
  return m;
}
