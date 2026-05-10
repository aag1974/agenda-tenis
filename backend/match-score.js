// Nota 0-10 da performance no match — calcula pros 2 lados (atleta e
// adversária). Pura, sem I/O.
//
// Pesos (somam 100% por lado):
//   25% — % pts ganhos no match  · sinal macro de domínio
//   25% — saldo ofensivo         · agressividade controlada
//   25% — % pts ganhos sacando   · eficiência no saque
//   25% — % pts ganhos recebendo · pressão sobre o saque adversário
//
// Modelo de stats (padrão iOnCourt):
//   ace, service_winner, double_fault       (lado do server)
//   return_winner, return_error              (lado do receiver)
//   winner, forced_error, unforced_error     (rally — `winner` indica quem ganhou,
//                                              `unforced_error` quem PERDEU = oposto)

function classifyForSide(side, p) {
  // Retorna 'offensive' | 'error' | null pra o `side` (a/o).
  const other = side === 'a' ? 'o' : 'a';
  const stat = p.stat;
  const server = p.server;
  const receiver = server === 'a' ? 'o' : 'a';
  if (!stat || p.winner == null) return null; // marker ou ponto inválido

  switch (stat) {
    case 'ace':
    case 'service_winner':
      if (server === side) return 'offensive';
      return null;
    case 'double_fault':
      if (server === side) return 'error';
      return null;
    case 'return_winner':
      if (receiver === side) return 'offensive';
      return null;
    case 'return_error':
      if (receiver === side) return 'error';
      return null;
    case 'winner':
      if (p.winner === side) return 'offensive';
      return null;
    case 'forced_error':
    case 'unforced_error':
      if (p.winner === other) return 'error'; // side perdeu = errou
      return null;
    default:
      return null;
  }
}

function computeOneSide(side, pts) {
  const other = side === 'a' ? 'o' : 'a';
  // Apenas pontos fechados (winner != null) entram nas %s
  const closed = pts.filter(p => p.winner != null);
  const total = closed.length;
  if (total === 0) return { score: null, breakdown: null };

  const won = closed.filter(p => p.winner === side).length;
  const pctWon = won / total;

  let off = 0, err = 0;
  for (const p of closed) {
    const k = classifyForSide(side, p);
    if (k === 'offensive') off++;
    else if (k === 'error') err++;
  }
  const balance = (off - err) / total;

  const servingPts = closed.filter(p => p.server === side);
  const wonServing = servingPts.filter(p => p.winner === side).length;
  const pctServing = servingPts.length > 0 ? wonServing / servingPts.length : null;

  const receivingPts = closed.filter(p => p.server === other);
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
    totalPts: pts.filter(p => p.winner != null).length,
  };
}

export function attachScore(m) {
  if (!m) return m;
  m.computedScore = computeMatchScore(m);
  return m;
}
