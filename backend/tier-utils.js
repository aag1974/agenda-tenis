// Detecção de tier de torneio (G1, G2, G3, GA, com sufixo + opcional).
// FONTE ÚNICA usada tanto pelo scraper de torneios (scraper.js) quanto pelo
// scraper de partidas (match-scraper.js). Mudanças aqui afetam todo o app.
//
// O sistema CBT usa os seguintes tiers em ordem decrescente de pontuação:
//   GA+   → grau aberto premium (mais alto)
//   GA    → grau aberto
//   G1+   → grau 1 plus
//   G1    → grau 1
//   G2+   → grau 2 plus  (raro)
//   G2    → grau 2
//   G3+   → grau 3 plus  (raro)
//   G3    → grau 3 (mais comum no juvenil iniciante)
//
// Os "+" significam categorias que somam pontos extras dentro do tier.
// Detectar G1+ vs G1 importa porque a pontuação difere significativamente.

// Padrões válidos canônicos
export const VALID_TIERS = ['GA+', 'GA', 'G1+', 'G1', 'G2+', 'G2', 'G3+', 'G3'];

// Ordem de prioridade de busca (decisão do user 2026-05-08): GA+ primeiro,
// depois GA, depois G1+, G1, G2+, G2, G3+, G3. Retorna o PRIMEIRO match.
//
// Justificativa: digitação manual no TI pode falhar; se a pessoa
// explicitamente digitou "GA+" no nome do torneio, esse é o sinal mais
// forte que temos — mais forte que o que o catálogo TI armazena
// (que pode estar errado por outras razões).
const TIER_SEARCH_ORDER = ['GA+', 'GA', 'G1+', 'G1', 'G2+', 'G2', 'G3+', 'G3'];

// Detecta o tier do torneio procurando em qualquer texto fornecido (nome,
// observações, header de página). Retorna string canônica ou null.
//
// PRINCÍPIO CONSERVADOR: retorna tier apenas quando EXPLICITAMENTE declarado.
// Não usa sinônimos vagos.
//
// ORDEM DE PRIORIDADE (TIER_SEARCH_ORDER):
//   1. GA+   2. GA   3. G1+   4. G1   5. G2+   6. G2   7. G3+   8. G3
// Para cada tier nessa ordem, procura nos textos. Retorna primeiro encontrado.
//
// Resultado:
//   "GA/GA+ Brasileirão"        → "GA+" (mais alto encontrado)
//   "Etapa - 12FD-G1+"          → "G1+"
//   "Etapa G1 e G3 mistos"      → "G1"  (G1+ não está, G1 sim)
//   "Open Internacional GA+"    → "GA+"
//
// Para LISTA de todos os tiers (ex: kanban mostrando "G1 e G1+"), use
// extractAllTiers (plural).
//
// CASE SENSITIVE: regex sem flag 'i'. Tiers SEMPRE em CAIXA ALTA.
// '\b' do JS quebra com '+' (não-word char), então lookahead pra
// não-letra/dígito.
export function extractTier(...texts) {
  const corpus = texts
    .filter(t => typeof t === 'string' && t.length > 0)
    .join(' ◆ ');
  if (!corpus) return null;

  for (const tier of TIER_SEARCH_ORDER) {
    if (containsTier(corpus, tier)) return tier;
  }
  return null;
}

// Verifica se um tier específico aparece no texto, com boundaries adequados.
function containsTier(corpus, tier) {
  // Escape do '+' pra regex
  const escaped = tier.replace('+', '\\+');
  // Lookahead final: se o tier tem '+', requer não-letra/dígito depois
  // Se o tier NÃO tem '+', requer não-letra/dígito E não-'+' depois
  // (pra não casar G1 dentro de G1+)
  const trailing = tier.endsWith('+')
    ? '[^A-Za-z0-9]'
    : '[^A-Za-z0-9+]';
  const re = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?=$|${trailing})`);
  return re.test(corpus);
}

// Helper: ordena tiers do mais alto pro mais baixo (útil pra UI).
const TIER_ORDER = { 'GA+': 0, 'GA': 1, 'G1+': 2, 'G1': 3, 'G2+': 4, 'G2': 5, 'G3+': 6, 'G3': 7 };
export function compareTiers(a, b) {
  const oa = TIER_ORDER[a] ?? 99;
  const ob = TIER_ORDER[b] ?? 99;
  return oa - ob;
}

// Detecta TODOS os tiers presentes no(s) texto(s). Diferente de extractTier
// que retorna 1 tier (mais específico), extractAllTiers retorna um array com
// todos os tiers distintos detectados — útil pro QUADRO (kanban) onde um
// mesmo torneio pode ter várias categorias com tiers diferentes (ex: 12F-G1+
// e 14F-G1 no mesmo evento).
//
// Resultado é ordenado do mais alto pro mais baixo.
//
// Exemplo:
//   extractAllTiers('Etapa G1', 'Categoria G1+ premium') → ['G1+', 'G1']
//   extractAllTiers('Etapa G3 - 12F') → ['G3']
//   extractAllTiers('Brasileirão sem tier explícito') → []
export function extractAllTiers(...texts) {
  const corpus = texts
    .filter(t => typeof t === 'string' && t.length > 0)
    .join(' ◆ ');
  if (!corpus) return [];

  const found = new Set();

  // Procura tiers com '+'
  for (const t of ['GA\\+', 'G1\\+', 'G2\\+', 'G3\\+']) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${t}(?=$|[^A-Za-z0-9])`, 'g');
    if (re.test(corpus)) found.add(t.replace('\\', ''));
  }

  // Procura tiers sem '+' — lookahead pra não casar G1+ como G1
  for (const t of ['GA', 'G1', 'G2', 'G3']) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${t}(?=$|[^A-Za-z0-9+])`, 'g');
    if (re.test(corpus)) found.add(t);
  }

  return [...found].sort(compareTiers);
}

// Helper: tier é "alto" (G1+, G1, GA+, GA)? Útil pra recomendações estratégicas.
export function isTopTier(tier) {
  return ['GA+', 'GA', 'G1+', 'G1'].includes(tier);
}
