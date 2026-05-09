// Glicko-2 implementation (Mark Glickman, 2012).
// Reference: http://www.glicko.net/glicko/glicko2.pdf
//
// Cada atleta tem 3 valores:
//   - r:   rating (Elo-scale, default 1500)
//   - RD:  rating deviation (incerteza, default 350)
//   - σ:   volatility (variabilidade no tempo, default 0.06)
//
// Internamente o algoritmo usa a "Glicko-2 scale":
//   μ = (r - 1500) / 173.7178
//   φ = RD / 173.7178
//
// Após N matches num "rating period", atualiza-se (μ, φ, σ).
// Aqui tratamos CADA match como um rating period individual — Glicko-2
// suporta isso, e simplifica muito a contabilidade quando os oponentes
// também são updates por nossa vez.

const SCALE = 173.7178;
const TAU = 0.5;        // Constraint da volatility (recomendado entre 0.3 e 1.2)
const EPSILON = 1e-6;

export const DEFAULT_R = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_SIGMA = 0.06;

export function newPlayer({ r = DEFAULT_R, rd = DEFAULT_RD, sigma = DEFAULT_SIGMA } = {}) {
  return { r, rd, sigma };
}

// Conversões entre escalas
function toGlicko2(player) {
  return {
    mu: (player.r - 1500) / SCALE,
    phi: player.rd / SCALE,
    sigma: player.sigma,
  };
}

function fromGlicko2(g2) {
  return {
    r: SCALE * g2.mu + 1500,
    rd: SCALE * g2.phi,
    sigma: g2.sigma,
  };
}

// g(φ): "weight" do oponente, depende da incerteza dele
function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

// E(μ, μ_j, φ_j): probabilidade esperada de vitória do jogador (μ) sobre o oponente (μ_j)
function expectedScore(mu, muOpp, phiOpp) {
  return 1 / (1 + Math.exp(-g(phiOpp) * (mu - muOpp)));
}

// Procedimento Illinois (binary search) pra resolver a equação volátil de σ
function computeNewSigma(sigma, phi, v, delta) {
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  // Bissecção (Illinois variant) até convergir
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

// Atualiza UM jogador dado UM ou MAIS matches no período.
// matches: [{ opponent: {r, rd, sigma}, score: 0|0.5|1 }, ...]
// score = 1 (vitória do jogador), 0 (derrota), 0.5 (empate — não usado em tênis)
//
// Retorna o player atualizado.
export function updatePlayer(player, matches) {
  // Caso especial: jogador não jogou nesse período → só aumenta a incerteza
  if (matches.length === 0) {
    const g2 = toGlicko2(player);
    const newPhi = Math.sqrt(g2.phi * g2.phi + g2.sigma * g2.sigma);
    return fromGlicko2({ mu: g2.mu, phi: newPhi, sigma: g2.sigma });
  }

  const g2 = toGlicko2(player);
  const opps = matches.map(m => toGlicko2(m.opponent));

  // v = variance estimate (incerteza derivada dos matches)
  let vSum = 0;
  for (let i = 0; i < matches.length; i++) {
    const e = expectedScore(g2.mu, opps[i].mu, opps[i].phi);
    const gj = g(opps[i].phi);
    vSum += gj * gj * e * (1 - e);
  }
  const v = 1 / vSum;

  // Δ = improvement
  let deltaSum = 0;
  for (let i = 0; i < matches.length; i++) {
    const e = expectedScore(g2.mu, opps[i].mu, opps[i].phi);
    deltaSum += g(opps[i].phi) * (matches[i].score - e);
  }
  const delta = v * deltaSum;

  // Nova volatilidade σ'
  const newSigma = computeNewSigma(g2.sigma, g2.phi, v, delta);

  // Pre-rating period φ*: incerteza inflada pela volatilidade
  const phiStar = Math.sqrt(g2.phi * g2.phi + newSigma * newSigma);

  // Novo φ e novo μ
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = g2.mu + newPhi * newPhi * deltaSum;

  return fromGlicko2({ mu: newMu, phi: newPhi, sigma: newSigma });
}

// Probabilidade de vitória do player A sobre player B (útil pra previsões e
// pra computar Expected wins). Usa a fórmula E na Glicko-2 scale.
export function winProbability(playerA, playerB) {
  const a = toGlicko2(playerA);
  const b = toGlicko2(playerB);
  // Combina as duas incertezas — phi efetivo
  const phiCombined = Math.sqrt(a.phi * a.phi + b.phi * b.phi);
  return 1 / (1 + Math.exp(-g(phiCombined) * (a.mu - b.mu)));
}

// 95% CI do rating — útil pra plot ±2σ
export function ratingInterval(player) {
  return {
    lower: player.r - 1.96 * player.rd,
    upper: player.r + 1.96 * player.rd,
  };
}
