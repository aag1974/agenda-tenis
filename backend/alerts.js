// Avalia regras de alerta contra mudanças entre dois snapshots de sync.
// Retorna eventos prontos pra serem persistidos via storage.addAlertEvents.
//
// Tipos de regra:
//   - new_tournament_location  params: { ufs?: string[], cities?: string[] }
//   - new_tournament_tier      params: { tiers: string[] }   (G1, GA, GA+, etc)
//   - ranking_change           params: { scope: 'national' | 'df' }

// Normaliza pra comparação tolerante: minúsculas + remove diacríticos.
// "Uberlândia" e "Uberlandia" precisam bater — TI às vezes exporta sem acento,
// usuário cadastra com acento (ou vice-versa).
const norm = (s) => (s || '').toString().trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

function tournamentLocationLabel(t) {
  const parts = [t.city, t.state].filter(Boolean);
  return parts.join('/') || '—';
}

function tiersOf(t) {
  if (Array.isArray(t.tiers) && t.tiers.length) return t.tiers;
  return t.tier ? [t.tier] : [];
}

function evaluateLocationRule(rule, newTournaments) {
  const ufs = (rule.params?.ufs || []).map(s => s.toUpperCase());
  const cities = (rule.params?.cities || []).map(norm);
  if (!ufs.length && !cities.length) return [];
  const out = [];
  for (const t of newTournaments) {
    const ufHit = ufs.length && t.state && ufs.includes(t.state.toUpperCase());
    const cityHit = cities.length && t.city && cities.includes(norm(t.city));
    if (!ufHit && !cityHit) continue;
    const where = tournamentLocationLabel(t);
    out.push({
      ruleId: rule.id,
      ruleType: rule.type,
      tournamentId: t.id,
      message: `🆕 Novo torneio em ${where}: ${t.name}` + (t.startDate ? ` (${t.startDate})` : ''),
      dedupeKey: `loc:${rule.id}:${t.id}`,
    });
  }
  return out;
}

function evaluateTierRule(rule, newTournaments) {
  const tiers = (rule.params?.tiers || []).map(t => t.toUpperCase());
  if (!tiers.length) return [];
  const out = [];
  for (const t of newTournaments) {
    const tt = tiersOf(t).map(x => x.toUpperCase());
    if (!tt.some(x => tiers.includes(x))) continue;
    const matched = tt.filter(x => tiers.includes(x))[0];
    out.push({
      ruleId: rule.id,
      ruleType: rule.type,
      tournamentId: t.id,
      message: `🏆 Novo torneio chave ${matched}: ${t.name}` + (t.startDate ? ` (${t.startDate})` : ''),
      dedupeKey: `tier:${rule.id}:${t.id}`,
    });
  }
  return out;
}

function evaluateRankingRule(rule, prevAthlete, currAthlete) {
  if (!prevAthlete || !currAthlete) return [];
  const scope = rule.params?.scope || 'national';
  const prevPos = scope === 'df' ? prevAthlete.rankingRegional?.regionalPosition : prevAthlete.rankingNational?.position;
  const currPos = scope === 'df' ? currAthlete.rankingRegional?.regionalPosition : currAthlete.rankingNational?.position;
  if (prevPos == null || currPos == null) return [];
  if (prevPos === currPos) return [];
  const direction = currPos < prevPos ? 'subiu' : 'caiu';
  const arrow = currPos < prevPos ? '⬆️' : '⬇️';
  const label = scope === 'df' ? 'ranking DF' : 'ranking nacional';
  // Dedupe por dia — um único alerta de ranking por dia mesmo que faça sync repetido
  const day = new Date().toISOString().slice(0, 10);
  return [{
    ruleId: rule.id,
    ruleType: rule.type,
    message: `${arrow} Ranking mudou: ${label} ${direction} (${prevPos}º → ${currPos}º)`,
    dedupeKey: `rank:${rule.id}:${scope}:${prevPos}->${currPos}:${day}`,
  }];
}

export function evaluateRules({ rules, prevTournaments, currTournaments, prevAthlete, currAthlete }) {
  if (!rules?.length) return [];
  const prevIds = new Set((prevTournaments || []).map(t => t.id));
  const newTournaments = (currTournaments || []).filter(t => !prevIds.has(t.id));
  const events = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.type === 'new_tournament_location') events.push(...evaluateLocationRule(rule, newTournaments));
    else if (rule.type === 'new_tournament_tier') events.push(...evaluateTierRule(rule, newTournaments));
    else if (rule.type === 'ranking_change') events.push(...evaluateRankingRule(rule, prevAthlete, currAthlete));
  }
  return events;
}
