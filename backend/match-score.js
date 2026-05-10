// Nota 0-10 da performance da atleta no match. Pura, calcula direto dos
// pontos coletados. Não compara contra histórico (isso vira ajuste do
// relatório de Performance depois) — aqui é nota absoluta do jogo.
//
// Pesos (somam 100%):
//   25% — % pts ganhos no match  · sinal macro de domínio
//   25% — saldo ofensivo         · agressividade controlada
//   25% — % pts ganhos sacando   · eficiência no saque
//   25% — % pts ganhos recebendo · pressão sobre o saque adversário
//
// Cada métrica vira 0-10 antes de ponderar.

const STAT_OFFENSIVE = new Set(['ace', 'winner', 'returnwin_a', 'oppdf']);
const STAT_ERROR     = new Set(['df', 'ue', 'fe']);

export function computeMatchScore(m) {
  const pts = (m && m.points) || [];
  if (pts.length === 0) {
    return { score: null, breakdown: null, notes: 'sem pontos ainda' };
  }

  const totalPts = pts.length;
  const ptsA = pts.filter(p => p.winner === 'a').length;
  const pctWon = ptsA / totalPts;

  // Saldo ofensivo da Anna: ganhos por mérito − erros próprios.
  // Normaliza por total de pontos → escala -1..+1.
  const offensive = pts.filter(p => p.winner === 'a' && STAT_OFFENSIVE.has(p.stat)).length;
  const errors    = pts.filter(p => p.winner === 'o' && STAT_ERROR.has(p.stat)).length;
  const balance   = (offensive - errors) / totalPts;

  // Eficiência sacando
  const servingPts = pts.filter(p => p.server === 'a');
  const wonServing = servingPts.filter(p => p.winner === 'a').length;
  const pctServing = servingPts.length > 0 ? wonServing / servingPts.length : null;

  // Pressão recebendo
  const receivingPts = pts.filter(p => p.server === 'o');
  const wonReceiving = receivingPts.filter(p => p.winner === 'a').length;
  const pctReceiving = receivingPts.length > 0 ? wonReceiving / receivingPts.length : null;

  // Normalizadores
  const pctToScore = (x) => Math.max(0, Math.min(10, x * 10));
  // Saldo: 0 → 5; +30% → 8; -30% → 2; ±50% extremos.
  const balanceToScore = (b) => Math.max(0, Math.min(10, 5 + b * 10));

  const breakdown = {
    pctWon:    { value: pctWon,                 score: pctToScore(pctWon) },
    balance:   { value: balance,                score: balanceToScore(balance) },
    serving:   { value: pctServing,             score: pctServing != null ? pctToScore(pctServing) : null },
    receiving: { value: pctReceiving,           score: pctReceiving != null ? pctToScore(pctReceiving) : null },
  };

  // Soma ponderada — usa apenas componentes com valor (peso redistribuído
  // se não tiver pontos sacando ou recebendo ainda).
  const weights = { pctWon: 25, balance: 25, serving: 25, receiving: 25 };
  let totalWeight = 0;
  let weighted = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (breakdown[k].score != null) {
      weighted += breakdown[k].score * w;
      totalWeight += w;
    }
  }
  const score = totalWeight > 0 ? weighted / totalWeight : null;
  return {
    score: score != null ? Math.round(score * 10) / 10 : null,
    breakdown,
    totalPts,
  };
}

// Anexa a nota no objeto de match (mutação simples) — chamado nos endpoints
// antes de res.json.
export function attachScore(m) {
  if (!m) return m;
  m.computedScore = computeMatchScore(m);
  return m;
}
