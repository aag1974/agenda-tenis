// Relatório técnico completo — entrega especial assinada por estatístico.
// Geração HTML otimizada pra PDF A4 (⌘+P → save as PDF).
//
// Estrutura: Capa · Resumo Executivo · 6 Capítulos · Anexos.
// Identidade visual Tennis Flow (#0e3a4d navy, #00a3e0 cyan).
// Assinado: Alexandre de Araujo Garcia · Estatístico CONRE/DF 7745.

import { analyzeMatches } from './analytics.js';
import { generateAllNarrativesThirdPerson } from './narrative.js';
import {
  getMatchesData, getProfile, getSyncedData,
} from './storage.js';
import { detectGender, detectMainCategory, categoryFullLabel, genderTerms } from './gender.js';
import { computeArchetypes } from './competitive-metrics.js';
import { radarChart, calendarHeatmap } from './charts.js';
import { radarInterpretation } from './narrative.js';
import { computeForecast } from './forecast.js';
const G_DEFAULT = genderTerms('M');

// ─── Configurações ──────────────────────────────────────────────────────
const SIGNATURE = {
  name: 'Alexandre de Araujo Garcia',
  title: 'Estatístico',
  registry: 'CONRE/DF nº 7745',
  city: 'Brasília',
  email: 'alexandre@opiniao.inf.br',
};

// Paleta Tennis Flow (alinhada com o app)
const COLORS = {
  navy: '#0e3a4d',
  cyan: '#00a3e0',
  navyLight: '#1f5b75',
  cyanLight: '#7dd3fc',
  bgLight: '#f0f9ff',
  textDark: '#0f172a',
  textMuted: '#64748b',
  borderLight: '#e2e8f0',
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  violet: '#7c3aed',
  violetLight: '#ede9fe',
};

// Logo Tennis Flow — SVG inline pra capa (mesma identidade do app)
const TF_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="120" height="120">
  <rect width="512" height="512" rx="80" fill="#0e3a4d"/>
  <text x="256" y="370" font-size="380" text-anchor="middle" font-family="'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif">🎾</text>
  <text x="40" y="440" font-size="280" font-weight="900" text-anchor="start" letter-spacing="-12" font-family="-apple-system, system-ui, 'Segoe UI', sans-serif" style="paint-order:stroke fill" stroke="#0e3a4d" stroke-width="14" stroke-linejoin="round"><tspan fill="#ffffff">T</tspan><tspan fill="#22d3ee">F</tspan></text>
</svg>`;

const MONTH_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function formatLongDate(d = new Date()) {
  return `${d.getDate()} de ${MONTH_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function md(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Formato numérico brasileiro: vírgula como separador decimal.
function nb(n, decimals = 2) {
  if (n === null || n === undefined || typeof n !== 'number' || Number.isNaN(n)) return '—';
  return n.toFixed(decimals).replace('.', ',');
}
function nbInt(n) {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toString();
}

// Enriquece matches com tier oriundo do synced.json (TI página /jogos/
// não traz tier; vem do catálogo /torneio_painel_info/). Faz lookup por
// tournamentId.
function enrichMatchesWithTier(matches, syncedTournaments) {
  if (!syncedTournaments || !syncedTournaments.length) return matches;
  const tierByTid = {};
  for (const t of syncedTournaments) {
    if (t.id && t.tier) tierByTid[t.id] = t.tier;
  }
  return matches.map(m => {
    if (m.tier) return m;  // Já tem
    const tier = tierByTid[m.tournamentId];
    return tier ? { ...m, tier } : m;
  });
}

// "26/08/2025" ou "2025-08-26" → "26/08/2025"
function brDate(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  return s;
}

// ─── Visualizações SVG ──────────────────────────────────────────────────
function ratingSparkline(history, w = 600, h = 120) {
  if (!history || history.length < 2) return '';
  const PAD = 12;
  const rs = history.map(h => h.r);
  const lower = history.map(h => h.r - 1.96 * h.rd);
  const upper = history.map(h => h.r + 1.96 * h.rd);
  const yMin = Math.min(...lower) - 30;
  const yMax = Math.max(...upper) + 30;
  const yRange = yMax - yMin || 1;
  const xStep = (w - 2 * PAD) / (history.length - 1);
  const yOf = (v) => h - PAD - ((v - yMin) / yRange) * (h - 2 * PAD);
  const xOf = (i) => PAD + i * xStep;

  let band = `M ${xOf(0)} ${yOf(upper[0])}`;
  for (let i = 1; i < history.length; i++) band += ` L ${xOf(i)} ${yOf(upper[i])}`;
  for (let i = history.length - 1; i >= 0; i--) band += ` L ${xOf(i)} ${yOf(lower[i])}`;
  band += ' Z';

  let line = `M ${xOf(0)} ${yOf(rs[0])}`;
  for (let i = 1; i < history.length; i++) line += ` L ${xOf(i)} ${yOf(rs[i])}`;

  // Linha horizontal de referência em 1500 (rating padrão)
  let refLine = '';
  if (yMin <= 1500 && yMax >= 1500) {
    refLine = `<line x1="${PAD}" y1="${yOf(1500)}" x2="${w - PAD}" y2="${yOf(1500)}" stroke="${COLORS.textMuted}" stroke-width="0.5" stroke-dasharray="4,3" opacity="0.6"/>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-height:140px;display:block;">
    ${refLine}
    <path d="${band}" fill="rgba(167,139,250,0.3)" stroke="none"/>
    <path d="${line}" fill="none" stroke="${COLORS.violet}" stroke-width="2.5"/>
    <circle cx="${xOf(history.length - 1)}" cy="${yOf(rs[rs.length - 1])}" r="5" fill="${COLORS.violet}"/>
  </svg>`;
}

function horizontalBars(rows, opts = {}) {
  // rows: [{ label, value, total, color? }]
  // Renderiza barras horizontais com label + número à direita
  return `<div style="display:flex;flex-direction:column;gap:8px;">
    ${rows.map(r => {
      const pct = r.total > 0 ? Math.round((r.value / r.total) * 100) : 0;
      const color = r.color || (pct >= 50 ? COLORS.emerald : pct >= 30 ? COLORS.amber : COLORS.rose);
      return `<div style="display:flex;align-items:center;gap:10px;font-size:12px;">
        <span style="flex:0 0 160px;color:#475569;">${escapeHtml(r.label)}</span>
        <div style="flex:1;height:18px;background:#e2e8f0;border-radius:3px;overflow:hidden;position:relative;">
          <div style="height:100%;width:${pct}%;background:${color};"></div>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;font-size:11px;color:#0f172a;font-weight:500;">
            ${r.total > 0 ? `${pct}% · ${r.value}V ${r.total - r.value}D` : 'sem dados'}
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── Renderizadores de capítulo ─────────────────────────────────────────

function renderCover(ctx) {
  const { athleteName, ranking, periodFrom, periodTo, dateStr, mainCategory } = ctx;
  // Linha de meta: categoria + ranking (se ambos existirem). Sem categoria,
  // mostra só ranking. Sem nada, omite a linha — capa fica mais limpa.
  let metaLine = '';
  if (mainCategory && ranking) metaLine = `Categoria ${escapeHtml(mainCategory)} · Ranking CBT ${ranking}`;
  else if (mainCategory) metaLine = `Categoria ${escapeHtml(mainCategory)}`;
  else if (ranking) metaLine = `Ranking CBT ${ranking}`;
  return `
    <section class="cover">
      <div class="cover-inner">
        <div class="cover-logo">${TF_LOGO_SVG}</div>
        <div class="brand-mark">TENNIS FLOW</div>
        <div class="brand-rule"></div>
        <h1 class="cover-title">Relatório de Performance</h1>
        <div class="cover-athlete">${escapeHtml(athleteName)}</div>
        ${metaLine ? `<div class="cover-meta">${metaLine}</div>` : ''}
        <div class="cover-period">Período analisado: ${escapeHtml(periodFrom)} → ${escapeHtml(periodTo)}</div>
        <div class="cover-edition">1ª edição · Gerado em ${escapeHtml(dateStr)}</div>
        <div class="cover-statement">
          "Análise estatística do desempenho competitivo, incluindo
          rating Glicko-2, evolução temporal, performance estratificada,
          análise de confrontos recorrentes, padrões temporais e
          narrativa interpretativa em linguagem acessível."
        </div>

        <div class="cover-signature">
          <div class="cover-signature-rule"></div>
          <div class="cover-signature-label">Análise técnica e parecer</div>
          <div class="cover-signature-name">${escapeHtml(SIGNATURE.name)}</div>
          <div class="cover-signature-title">${escapeHtml(SIGNATURE.title)} — ${escapeHtml(SIGNATURE.registry)}</div>
          <div class="cover-signature-email">${escapeHtml(SIGNATURE.email)}</div>
        </div>

        <div class="cover-foot">
          <div>Tennis Flow · 2026</div>
          <div>tennis-flow.com.br</div>
        </div>
      </div>
    </section>
  `;
}

function renderExecutiveSummary(ctx) {
  const { analysis, narratives, athleteName, athleteFirstName, ranking, mainCategory } = ctx;
  const c = analysis.counts;
  const f = analysis.forma;
  const r = analysis.athleteRating;
  const ou = analysis.over_under;
  const top = narratives.topPositive;

  const winRate = c.analyzed > 0 ? Math.round((c.wins / c.analyzed) * 100) : 0;
  const win90 = f && f.last90.total > 0 ? Math.round((f.last90.wins / f.last90.total) * 100) : null;
  const win365 = f && f.last365.total > 0 ? Math.round((f.last365.wins / f.last365.total) * 100) : null;

  return `
    <section class="exec-summary">
      <div class="exec-header">
        <div class="exec-eyebrow">Resumo Executivo</div>
        <div class="exec-athlete">${escapeHtml(athleteName)}</div>
        ${(() => {
          let m = '';
          if (mainCategory && ranking) m = `Categoria ${escapeHtml(mainCategory)} · Ranking CBT ${ranking}`;
          else if (mainCategory) m = `Categoria ${escapeHtml(mainCategory)}`;
          else if (ranking) m = `Ranking CBT ${ranking}`;
          return m ? `<div class="exec-meta">${m}</div>` : '';
        })()}
      </div>

      ${narratives.signature ? `
      <div class="signature-phrase">
        <div class="signature-quote-mark">“</div>
        <div class="signature-text">${escapeHtml(narratives.signature)}</div>
      </div>
      ` : ''}

      <div class="exec-headline">
        <div class="exec-headline-label">Em uma frase</div>
        <div class="exec-headline-text">${escapeHtml(narratives.headline || '—')}</div>
      </div>

      <div class="exec-grid">
        <div class="exec-col">
          <div class="exec-col-title">Números-chave</div>
          <div class="exec-row"><span>Partidas analisadas</span><strong>${c.analyzed}</strong></div>
          <div class="exec-row"><span>Vitórias</span><strong>${c.wins}</strong></div>
          <div class="exec-row"><span>Derrotas</span><strong>${c.losses}</strong></div>
          <div class="exec-row"><span>Aproveitamento total</span><strong>${winRate}%</strong></div>
          ${win365 !== null ? `<div class="exec-row"><span>Últimos 12 meses</span><strong>${win365}%</strong></div>` : ''}
          ${win90 !== null ? `<div class="exec-row"><span>Últimos 3 meses</span><strong>${win90}%</strong></div>` : ''}
        </div>
        <div class="exec-col">
          <div class="exec-col-title">Nível estimado</div>
          <div class="exec-rating">${r.r}</div>
          <div class="exec-rating-meta">faixa: ${r.ci95.lower}–${r.ci95.upper}</div>
          ${ratingSparkline(analysis.ratingHistory, 280, 80)}
        </div>
      </div>

      <div class="exec-insights">
        <div class="exec-col-title">Três coisas que os dados mostram</div>
        ${narratives.forma ? `<div class="exec-insight"><span class="bullet">↗</span><div>${md(narratives.forma)}</div></div>` : ''}
        ${narratives.bucket ? `<div class="exec-insight"><span class="bullet">⚖</span><div>${md(narratives.bucket)}</div></div>` : ''}
        ${top ? `<div class="exec-insight"><span class="bullet">★</span><div><strong>${escapeHtml(top.title)}</strong> — ${escapeHtml(top.line1)} (placar: ${escapeHtml(top.score || '—')}). ${md(top.paragraph)}</div></div>` : ''}
      </div>

      <div class="exec-warning">
        <strong>Aviso importante:</strong> esta análise considera ${c.analyzed} partidas — uma amostra ainda pequena pra cravar tendências definitivas. As leituras aqui são direcionais e vão ficar mais sólidas conforme o histórico crescer.
      </div>

      <div class="exec-foot">
        Fora da análise: ${c.excluded.doubles} partidas de duplas e ${c.excluded.wo} jogos marcados como W.O. no Tênis Integrado (na prática, parte desses W.O. costumam ser erros de cadastro, não desistências reais).
        Detalhes completos a partir da página seguinte →
      </div>
    </section>
  `;
}

// ─── DNA competitivo + Métricas proprietárias ────────────────────────
// Aparece após o Resumo Executivo. Dá identidade ao atleta (1-2 arquétipos)
// e três índices proprietários que vão além de V/D: dominância, clutch
// e resiliência. Cada métrica tem score 0-100 + breakdown.
function renderDnaAndMetrics(ctx) {
  const { archetypes, analysis, athleteFirstName, G } = ctx;
  const cdi = analysis.competitiveDominance;
  const clutch = analysis.clutchScore;
  const res = analysis.resilience;

  const archCards = (archetypes || []).map(a => `
    <div class="dna-card">
      <div class="dna-icon">${a.icon}</div>
      <div class="dna-tag">${escapeHtml(a.tag)}</div>
      <div class="dna-desc">${escapeHtml(a.desc)}</div>
    </div>
  `).join('');

  const metricCard = (title, scoreObj, sublabel, breakdownHtml) => {
    const has = scoreObj && scoreObj.score !== null && scoreObj.score !== undefined;
    const score = has ? scoreObj.score : null;
    const tone = !has ? 'neutral'
      : score >= 65 ? 'strong'
      : score >= 45 ? 'mid'
      : 'weak';
    return `
      <div class="metric-card metric-${tone}">
        <div class="metric-title">${escapeHtml(title)}</div>
        <div class="metric-score">${has ? score : '—'}<span class="metric-unit">/100</span></div>
        <div class="metric-sublabel">${sublabel}</div>
        ${has ? `<div class="metric-breakdown">${breakdownHtml}</div>` : ''}
      </div>
    `;
  };

  const cdiBreak = cdi?.components ? `
    ${cdi.components.dominantRate}% dos sets vencidos foram dominantes (≤2 games cedidos) ·
    margem média ${cdi.components.avgGameMargin} games ·
    ${cdi.components.gameWinRate}% dos games totais
  ` : '';

  const clutchBreak = clutch?.components ? [
    clutch.components.tbTotal > 0 ? `${clutch.components.tbWon}/${clutch.components.tbTotal} sets em tie-break (${clutch.components.tbRate}%)` : null,
    clutch.components.stbTotal > 0 ? `${clutch.components.stbWon}/${clutch.components.stbTotal} super-tiebreaks (${clutch.components.stbRate}%)` : null,
    clutch.components.decidingTotal > 0 ? `${clutch.components.decidingWon}/${clutch.components.decidingTotal} sets decisivos (${clutch.components.decidingRate}%)` : null,
  ].filter(Boolean).join(' · ') : 'Amostra insuficiente em pontos decisivos.';

  const resBreak = res?.components ? [
    res.components.lostFirstSetMatches > 0 ? `${res.components.lostFirstSetWon}/${res.components.lostFirstSetMatches} viradas após perder o 1º set (${res.components.lostFirstWinRate}%)` : null,
    res.components.h2hCandidates > 0 ? `${res.components.h2hComebacks}/${res.components.h2hCandidates} h2h revertidos depois de começar atrás (${res.components.h2hComebackRate}%)` : null,
  ].filter(Boolean).join(' · ') : 'Amostra insuficiente em situações adversas.';

  // Radar 5-eixos: 3 índices proprietários + 2 buckets (vs forte / vs parelho).
  // Reúne num só visual o "DNA" do atleta. Vs-fraco intencionalmente fora —
  // pra atletas competitivos, ganhar dos mais fracos é o piso, não diferencial.
  const b = analysis.bucketPerformance || {};
  const totalEven = (b.even?.w || 0) + (b.even?.l || 0);
  const totalStrong = (b.strong?.w || 0) + (b.strong?.l || 0);
  const evenPct = totalEven >= 3 ? Math.round((b.even.w / totalEven) * 100) : 0;
  const strongPct = totalStrong >= 3 ? Math.round((b.strong.w / totalStrong) * 100) : 0;
  const radarData = [
    { label: 'Dominância', value: cdi?.score || 0 },
    { label: 'Clutch', value: clutch?.score || 0 },
    { label: 'Resiliência', value: res?.score || 0 },
    { label: 'vs Parelhos', value: evenPct },
    { label: 'vs Fortes', value: strongPct },
  ];

  const radarPara = radarInterpretation({
    cdi: cdi?.score ?? null,
    clutch: clutch?.score ?? null,
    res: res?.score ?? null,
    evenPct: totalEven >= 3 ? evenPct : null,
    strongPct: totalStrong >= 3 ? strongPct : null,
    evenTotal: totalEven,
    strongTotal: totalStrong,
  }, ctx.athleteFirstName);

  // Layout player-card: header hero com nome + arquétipos como badges,
  // radar à esquerda + métricas à direita em formato compacto.
  return `
    <section class="chapter dna-section player-card">
      <div class="chapter-num">PERFIL COMPETITIVO</div>
      <h2 class="chapter-title">Como ${escapeHtml(athleteFirstName)} compete</h2>

      ${archetypes && archetypes.length ? `
      <div class="archetype-badges">
        ${archetypes.map(a => `
          <div class="archetype-badge">
            <div class="badge-icon">${a.icon}</div>
            <div class="badge-content">
              <div class="badge-tag">${escapeHtml(a.tag)}</div>
              <div class="badge-desc">${escapeHtml(a.desc)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      ` : ''}

      <div class="player-card-body">
        <div class="player-card-radar">
          ${radarChart(radarData, { width: 360, height: 320 })}
          <div class="radar-caption">Quanto mais o polígono se estende, mais ${G.ele} performa naquele eixo</div>
          <div class="radar-glossary">
            <strong>Dominância</strong>: quanto controla quando vence ·
            <strong>Clutch</strong>: como joga quando o jogo aperta ·
            <strong>Resiliência</strong>: como reage perdendo ·
            <strong>vs Parelhos</strong>: contra rivais do mesmo nível ·
            <strong>vs Fortes</strong>: contra rivais acima do nível.
          </div>
        </div>
        <div class="player-card-metrics">
          ${metricCard('Quanto controla o jogo quando vence', cdi,
            'Vitórias por margem larga ou apertada?',
            cdiBreak)}
          ${metricCard('Como joga quando o jogo aperta', clutch,
            'Tie-breaks, super-tiebreaks e sets decisivos.',
            clutchBreak)}
          ${metricCard('Como reage depois de perder um set', res,
            'Capacidade de virar quando começa atrás.',
            resBreak)}
        </div>
      </div>

      ${radarPara ? `
      <div class="radar-interpretation">
        <div class="radar-interp-label">Lendo os 5 indicadores juntos</div>
        <p>${md(radarPara)}</p>
      </div>
      ` : ''}

      <p class="footnote">Notas de 0 a 100 (forte ≥ 65 · médio 45–64 · em desenvolvimento &lt; 45).</p>
    </section>
  `;
}

function renderChapter1(ctx) {
  const { athleteName, athleteId, profile, synced, G, mainCategory, categoryLabel } = ctx;
  const wtn = synced?.athlete?.wtn;
  const rankingNational = synced?.athlete?.rankingNational;
  const rankingsAll = synced?.athlete?.rankingsAll || [];
  const about = synced?.athlete?.about;
  const catLine = categoryLabel || mainCategory || null;

  return `
    <section class="chapter">
      <div class="chapter-num">CAPÍTULO 1</div>
      <h2 class="chapter-title">Quem é ${G.atleta} e o que está sendo analisado</h2>

      <div class="profile-card">
        <div class="profile-row"><span>Nome</span><strong>${escapeHtml(athleteName)}</strong></div>
        <div class="profile-row"><span>ID Tênis Integrado</span><strong>${escapeHtml(athleteId || '—')}</strong></div>
        ${about ? `<div class="profile-row"><span>Origem</span><strong>${escapeHtml(about)}</strong></div>` : ''}
        ${synced?.athlete?.hand ? `<div class="profile-row"><span>Lateralidade</span><strong>${escapeHtml(synced.athlete.hand)}</strong></div>` : ''}
        ${catLine ? `<div class="profile-row"><span>Categoria</span><strong>${escapeHtml(catLine)}</strong></div>` : ''}
      </div>

      ${wtn ? `
      <h3>World Tennis Number (escala global da ITF)</h3>
      <div class="dual-box">
        <div><span>Simples</span><strong>${escapeHtml(wtn.single)}</strong></div>
        <div><span>Duplas</span><strong>${escapeHtml(wtn.double)}</strong></div>
      </div>
      <p class="footnote">A escala WTN vai de 1 (top mundial) a 40 (iniciante). A faixa 33-40 representa atletas em desenvolvimento. ${escapeHtml(athleteName.split(' ')[0])} está nessa faixa — já entrou no circuito oficial, agora é jogo a jogo.</p>
      ` : ''}

      ${rankingNational ? `
      <h3>Ranking nacional CBT${mainCategory ? ` — ${escapeHtml(mainCategory)}` : ''}</h3>
      <div class="ranking-box">
        <div class="ranking-row current">
          <span class="ranking-pos">${rankingNational.position}º</span>
          <span class="ranking-name">${escapeHtml(athleteName)}</span>
          <span class="ranking-pts">${String(rankingNational.points).replace('.', ',')} pts</span>
        </div>
      </div>
      <p class="footnote">Posição no ranking nacional CBT${mainCategory ? ` na categoria ${escapeHtml(mainCategory)}` : ''} (corte de ${escapeHtml(synced?.athlete?.rankingRegional?.cutoffDate || 'corte mais recente')}).</p>
      ` : ''}

      ${synced?.athlete?.rankingRegional?.regionalPosition ? `
      <h3>Ranking regional — recorte ${escapeHtml(synced.athlete.rankingRegional.uf || 'UF')}</h3>
      <div class="ranking-box">
        <div class="ranking-row current">
          <span class="ranking-pos">${synced.athlete.rankingRegional.regionalPosition}º</span>
          <span class="ranking-name">${escapeHtml(athleteName)}</span>
          <span class="ranking-pts">${synced.athlete.rankingRegional.totalRegional ? `de ${synced.athlete.rankingRegional.totalRegional} ${G.atletas_plural} no recorte` : ''}</span>
        </div>
      </div>
      <p class="footnote">Posição entre ${G.gender === 'F' ? 'as atletas' : 'os atletas'} ${G.filiadas} à federação do ${escapeHtml(synced.athlete.rankingRegional.uf || 'estado')} no recorte regional do ranking nacional${mainCategory ? ` ${escapeHtml(mainCategory)}` : ''}.</p>
      ` : ''}

      ${rankingsAll.length > 1 ? `
      <h3>Evolução histórica nos rankings</h3>
      <table class="data-table">
        <thead>
          <tr><th>Ano</th><th>Categoria</th><th>Posição</th><th>Pontos</th></tr>
        </thead>
        <tbody>
          ${rankingsAll.sort((a, b) => b.year - a.year || a.category.localeCompare(b.category)).map(r => `
            <tr>
              <td>${r.year}</td>
              <td>${escapeHtml(r.category)}</td>
              <td>${r.position}º</td>
              <td>${escapeHtml(String(r.points).replace('.', ','))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ` : ''}

      <h3>O que este relatório analisa</h3>
      <p>Este documento traz uma análise estatística completa do desempenho competitivo ${G.do_atleta}, baseada nas partidas oficiais registradas pelo Tênis Integrado. A análise inclui:</p>
      <ul>
        <li><strong>Caracterização dos dados</strong> — quais torneios, qual o universo de ${G.adversarios}, distribuições por nível e fase.</li>
        <li><strong>Trajetória do nível de jogo</strong> — usando o sistema estatístico Glicko-2.</li>
        <li><strong>Performance estratificada</strong> — por força do oponente, tier, fase, UF.</li>
        <li><strong>Histórico de confrontos recorrentes</strong> — head-to-head com ${G.adversarios} ${G.enfrentadas} mais de uma vez.</li>
        <li><strong>Padrões temporais</strong> — sazonalidade e análise de sequências.</li>
        <li><strong>Considerações finais</strong> — síntese e perguntas pra conversar com o coach.</li>
      </ul>
    </section>
  `;
}

function renderChapter2(ctx) {
  const G = ctx?.G || G_DEFAULT;
  return `
    <section class="chapter">
      <div class="chapter-num">CAPÍTULO 2</div>
      <h2 class="chapter-title">Como esta análise foi feita</h2>

      <h3>Fonte e critérios</h3>
      <p>As partidas vêm do perfil oficial ${G.do_atleta} no <em>Tênis Integrado</em>, com consentimento do responsável legal. <strong>Incluídas:</strong> singles com ${G.adversario} ${G.gender === 'F' ? 'identificada' : 'identificado'} e resultado oficial. <strong>Excluídas:</strong> duplas, jogos marcados como W.O. (frequentemente erros de cadastro do TI, não desistências reais) e partidas sem identificação ${G.gender === 'F' ? 'da adversária' : 'do adversário'}.</p>

      <h3>Quatro lentes complementares</h3>
      <p>O relatório combina:</p>
      <ul>
        <li><strong>Glicko-2</strong> — sistema de Mark Glickman (Harvard, 2012) que estima nível como rating + incerteza ("±X"). Vencer alguém mais forte vale mais; perder pra alguém muito acima quase não tira pontos. 1500 é a média neutra.</li>
        <li><strong>Forma temporal</strong> — janelas 90d / 12m / all-time pra detectar tendência recente.</li>
        <li><strong>Performance estratificada</strong> — leitura por força do adversário (mais ${G.gender === 'F' ? 'forte / parelha / mais fraca' : 'forte / parelho / mais fraco'}, com diferença mínima de ±100 pontos Glicko).</li>
        <li><strong>Métricas proprietárias Tennis Flow</strong> — Dominância (CDI), Clutch e Resiliência, derivadas de placares (não só V/D).</li>
      </ul>

      <h3>O que este relatório NÃO substitui</h3>
      <p>Glicko-2 é uma <strong>terceira lente</strong>, não substitui ranking CBT (pontos oficiais) nem WTN (referência mundial). Os três são complementares — WTN diz onde ${G.atleta} está no mundo, CBT no Brasil, Glicko-2 dentro do universo de ${G.adversarios} ${G.enfrentadas}.</p>

      <h3>Cuidado com a leitura</h3>
      <p>Com pouca amostra, qualquer conclusão é <strong>direção</strong>, não certeza. A faixa do Glicko ("± X") mostra esse tamanho de erro. Em 6 a 12 meses, com mais jogos no histórico, dá pra falar com mais firmeza.</p>

      <p class="footnote">Quem quiser entender exatamente como cada conta é feita, o Anexo C tem o detalhe técnico.</p>
    </section>
  `;
}

function renderChapter3(ctx) {
  const { matches, analysis } = ctx;
  // Tabela cronológica completa de partidas analisadas
  const sortedMatches = [...matches].sort((a, b) => {
    const ka = (a.endDate || '').split('/').reverse().join('');
    const kb = (b.endDate || '').split('/').reverse().join('');
    return ka.localeCompare(kb);
  });

  const tournaments = [];
  const tournamentMap = new Map();
  for (const m of sortedMatches) {
    const k = m.tournamentId;
    if (!tournamentMap.has(k)) {
      tournamentMap.set(k, {
        id: k,
        name: m.tournamentName,
        tier: m.tier,
        city: m.city,
        state: m.state,
        endDate: m.endDate,
        wins: 0,
        losses: 0,
      });
      tournaments.push(tournamentMap.get(k));
    }
    const t = tournamentMap.get(k);
    if (m.result === 'W') t.wins++;
    else if (m.result === 'L') t.losses++;
  }

  // Distribuição por tier (singles)
  const byTier = {};
  for (const m of sortedMatches) {
    if (m.isDoubles || m.wo || m.result == null) continue;
    const t = m.tier || 'Sem tier';
    if (!byTier[t]) byTier[t] = { w: 0, l: 0 };
    if (m.result === 'W') byTier[t].w++;
    else byTier[t].l++;
  }

  const byState = {};
  for (const m of sortedMatches) {
    if (m.isDoubles || m.wo || m.result == null) continue;
    const s = m.state || '?';
    if (!byState[s]) byState[s] = { w: 0, l: 0 };
    if (m.result === 'W') byState[s].w++;
    else byState[s].l++;
  }

  return `
    <section class="chapter">
      <div class="chapter-num">CAPÍTULO 3</div>
      <h2 class="chapter-title">O que foi disputado neste período</h2>

      <h3>Cronograma de torneios (${tournaments.length} torneios)</h3>
      <table class="data-table">
        <thead>
          <tr><th>Data fim</th><th>Tier</th><th>Cidade</th><th>Torneio</th><th>V-D</th></tr>
        </thead>
        <tbody>
          ${tournaments.map(t => `
            <tr>
              <td>${escapeHtml(t.endDate || '—')}</td>
              <td>${escapeHtml(t.tier || '—')}</td>
              <td>${escapeHtml(t.city ? `${t.city}/${t.state || '?'}` : '—')}</td>
              <td>${escapeHtml((t.name || '—').slice(0, 50))}</td>
              <td>${t.wins}-${t.losses}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p class="footnote">Tier "—" indica torneios em formato de equipes ou competições onde o sistema CBT não publica o tier oficial.</p>

      <h3>Distribuição por nível de torneio</h3>
      ${horizontalBars(
        Object.entries(byTier).sort().map(([k, v]) => ({
          label: k,
          value: v.w,
          total: v.w + v.l,
        }))
      )}

      <h3>Distribuição por estado</h3>
      ${horizontalBars(
        Object.entries(byState).sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l)).map(([k, v]) => ({
          label: k,
          value: v.w,
          total: v.w + v.l,
        }))
      )}

      <div class="keep-together">
        <h3>Calendário de atividade — aproveitamento por mês</h3>
        <div class="calendar-heatmap-wrap">
          ${calendarHeatmap(matches.filter(m => !m.isDoubles && !m.wo && (m.result === 'W' || m.result === 'L')))}
        </div>
      </div>

      <h3>Cobertura</h3>
      <p>De um total de <strong>${matches.length} partidas registradas</strong> no Tênis Integrado durante o período analisado:</p>
      <ul>
        <li><strong>${analysis.counts.analyzed}</strong> partidas de simples — base desta análise estatística.</li>
        <li><strong>${analysis.counts.excluded.doubles}</strong> partidas de duplas — listadas no Anexo A, fora desta análise (modelo estatístico próprio, futura versão).</li>
        <li><strong>${analysis.counts.excluded.wo}</strong> jogos marcados como W.O. — fora da análise. Vale lembrar que parte significativa dos W.O. registrados no Tênis Integrado são erros de cadastro, não desistências reais.</li>
      </ul>

      ${renderRecurrentTable(analysis, ctx)}
      ${renderScoreHistogram(analysis, ctx)}
    </section>
  `;
}

// ─── Cap 3.6: Tabela de adversárias/adversários recorrentes ───────────
function renderRecurrentTable(analysis, ctx) {
  const recurrent = analysis.recurrentOpponents || [];
  if (!recurrent.length) return '';
  const G = ctx?.G || G_DEFAULT;
  const firstName = ctx?.athleteFirstName ? escapeHtml(ctx.athleteFirstName) : G.Atleta;
  return `
    <h3>${G.Adversarios} recorrentes (${G.enfrentadas} 2 ou mais vezes)</h3>
    <p>Em circuito juvenil regional, é comum reencontrar ${G.gender === 'F' ? 'as mesmas adversárias' : 'os mesmos adversários'} várias vezes. ${firstName} tem <strong>${recurrent.length}</strong> ${G.adversarios} com quem já jogou pelo menos 2 vezes — concentração de confrontos que reflete a realidade do circuito brasileiro.</p>
    <table class="data-table">
      <thead>
        <tr><th>${G.Adversario}</th><th>V-D</th><th>Datas dos confrontos</th></tr>
      </thead>
      <tbody>
        ${recurrent.map(opp => {
          const dates = opp.matches.map(m => `${escapeHtml(m.endDate)} (${m.result === 'W' ? 'V' : 'D'} ${escapeHtml(m.scoreRaw || '—')})`).join(' · ');
          const balance = opp.wins - opp.losses;
          const cls = balance > 0 ? 'positive-saldo' : balance < 0 ? 'negative-saldo' : '';
          return `<tr class="${cls}">
            <td><strong>${escapeHtml(opp.name)}</strong></td>
            <td>${opp.wins}-${opp.losses}</td>
            <td class="dates-cell">${dates}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ─── Cap 3.7: Distribuição de placares (histograma) ───────────────────
function renderScoreHistogram(analysis, ctx) {
  const G = ctx?.G || G_DEFAULT;
  const hist = analysis.scoreHistogram || {};
  if (!Object.keys(hist).length) return '';

  // Ordena por frequência
  const entries = Object.entries(hist).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...entries.map(e => e[1]));
  const total = entries.reduce((s, [, c]) => s + c, 0);

  return `
    <h3>Distribuição de placares (todos os sets disputados)</h3>
    <p>Em ${total} sets registrados, os placares mais frequentes foram:</p>
    <div class="score-hist">
      ${entries.map(([score, count]) => {
        const pct = (count / maxCount) * 100;
        const isWinning = parseInt(score.split('-')[0]) > parseInt(score.split('-')[1]);
        const color = isWinning ? COLORS.emerald : COLORS.rose;
        const isBagel = score === '0-6';
        return `<div class="score-row">
          <span class="score-label">${escapeHtml(score)}${isBagel ? ' <em>(pneu)</em>' : ''}</span>
          <div class="score-bar"><div style="width:${pct}%;background:${color};"></div></div>
          <span class="score-count">${count}</span>
        </div>`;
      }).join('')}
    </div>
    <p class="footnote">Quando ${G && G.gender === 'F' ? 'uma jogadora vence' : 'um jogador vence'} sem ceder games (placar 6-0), chamamos popularmente de "pneu". O contrário — ${G && G.gender === 'F' ? 'quando é vencida' : 'quando é vencido'} sem fazer games — também é um pneu sofrido.</p>
  `;
}

function renderChapter4(ctx) {
  const { analysis, narratives } = ctx;
  const f = analysis.forma;
  const b = analysis.bucketPerformance;

  return `
    <section class="chapter">
      <div class="chapter-num">CAPÍTULO 4</div>
      <h2 class="chapter-title">O que os dados revelam</h2>

      <h3>4.1 Trajetória do nível de jogo</h3>
      <div class="rating-display">
        <div class="rating-num">${analysis.athleteRating.r}</div>
        <div class="rating-info">
          <div>± ${analysis.athleteRating.rd} pontos</div>
          <div>faixa: ${analysis.athleteRating.ci95.lower} – ${analysis.athleteRating.ci95.upper}</div>
        </div>
      </div>
      ${ratingSparkline(analysis.ratingHistory, 600, 130)}
      <p class="caption">Linha violeta: rating Glicko-2 atualizado partida a partida. Banda sombreada: faixa de 95% de confiança. Linha pontilhada (1500): rating de referência inicial.</p>
      ${narratives.rating ? `<p>${md(narratives.rating)}</p>` : ''}

      <h3>4.2 Forma recente × histórica</h3>
      ${horizontalBars([
        { label: 'Últimos 3 meses', value: f.last90.wins, total: f.last90.total },
        { label: 'Últimos 12 meses', value: f.last365.wins, total: f.last365.total },
        { label: 'Histórico todo', value: f.allTime.wins, total: f.allTime.total },
      ])}
      ${narratives.forma ? `<p style="margin-top:14px;">${md(narratives.forma)}</p>` : ''}

      <h3>4.3 Performance por força do oponente</h3>
      ${horizontalBars([
        { label: ctx.G.adversaria_mais_forte[0].toUpperCase() + ctx.G.adversaria_mais_forte.slice(1), value: b.strong.w, total: b.strong.w + b.strong.l },
        { label: 'Mesmo nível', value: b.even.w, total: b.even.w + b.even.l },
        { label: ctx.G.adversaria_mais_fraca[0].toUpperCase() + ctx.G.adversaria_mais_fraca.slice(1), value: b.weak.w, total: b.weak.w + b.weak.l },
      ])}
      ${narratives.bucket ? `<p style="margin-top:14px;">${md(narratives.bucket)}</p>` : ''}

      <h3>4.4 Esperado vs realizado</h3>
      <div class="ev-display">
        <div class="ev-num ${analysis.over_under.delta >= 0 ? 'positive' : 'negative'}">
          ${analysis.over_under.delta > 0 ? '+' : ''}${nb(analysis.over_under.delta, 1)} vitória${Math.abs(analysis.over_under.delta) === 1 ? '' : 's'}
        </div>
        <div class="ev-info">Esperado ${nb(analysis.expected.wins, 1)} ± ${nb(analysis.expected.stdError, 1)} · Real ${analysis.realized.wins}</div>
      </div>
      ${narratives.expectedRealized ? `<p>${md(narratives.expectedRealized)}</p>` : ''}

      ${renderHeadToHeadDeep(ctx)}

      ${renderTemporalSection(ctx)}
    </section>
  `;
}

// ─── 4.5 Análise de confrontos recorrentes (deep dive) ───────────────
// Filosofia editorial: corpo principal só com rivais relevantes pro
// próximo passo do atleta. Filtro: jogos recentes (≤365 dias) OU saldo
// negativo OU 3+ encontros. Demais ficam no Anexo D pra histórico
// completo. Pra Rafael (17 rivais), reduz pra ~7-10 cards visíveis.
function rankH2hRelevance(opp) {
  // Score combinando: recência (último jogo), volume, e sinal (rivais que
  // não vencemos pesam mais). Quanto maior, mais relevante pra entrar no
  // corpo principal.
  if (!opp || !opp.matches?.length) return 0;
  const last = opp.matches[opp.matches.length - 1];
  let score = 0;
  if (last?.endDate) {
    const [d, m, y] = last.endDate.split('/').map(Number);
    const days = (new Date() - new Date(y, m - 1, d)) / (1000 * 60 * 60 * 24);
    if (days <= 90) score += 50;
    else if (days <= 180) score += 30;
    else if (days <= 365) score += 15;
  }
  score += Math.min(opp.total, 10) * 3; // mais encontros = mais relevante
  if (opp.losses > opp.wins) score += 25; // rivais não vencidos pesam mais
  if (opp.wins === 0 && opp.losses >= 2) score += 15; // barreiras absolutas
  return score;
}

function renderHeadToHeadDeep(ctx) {
  const { analysis, narratives, G } = ctx;
  const opps = analysis.recurrentOpponents || [];
  const h2hNarr = narratives.h2h || [];
  if (!opps.length) return '';

  // Particiona em "principais" (corpo) e "demais" (anexo)
  const ranked = [...opps]
    .map(o => ({ opp: o, relevance: rankH2hRelevance(o) }))
    .sort((a, b) => b.relevance - a.relevance);
  // Se tem ≤ 6 rivais, mostra todos. Se mais, só os top 8.
  const cutoff = opps.length <= 6 ? opps.length : Math.min(8, opps.length);
  const main = ranked.slice(0, cutoff).map(x => x.opp);
  const remaining = ranked.slice(cutoff).map(x => x.opp);

  const renderCard = (opp) => {
    const narr = h2hNarr.find(n => n.opponent.name === opp.name);
    const balance = opp.wins - opp.losses;
    const isPositive = balance > 0;
    const isNegative = balance < 0;
    const titleSymbol = isPositive ? '★' : isNegative ? '⚠' : '⚖';
    const cardClass = isPositive ? 'positive' : isNegative ? 'negative' : 'balanced';
    return `
      <div class="h2h-card ${cardClass}">
        <div class="h2h-header">
          <span class="h2h-symbol">${titleSymbol}</span>
          <span class="h2h-name">${escapeHtml(opp.name)}</span>
          <span class="h2h-record">${opp.wins} V × ${opp.losses} D</span>
        </div>
        <table class="data-table small h2h-table">
          <thead>
            <tr><th>Data</th><th>Tier</th><th>Torneio</th><th>Fase</th><th>R</th><th>Placar</th></tr>
          </thead>
          <tbody>
            ${opp.matches.map(m => `
              <tr>
                <td>${escapeHtml(m.endDate)}</td>
                <td>${escapeHtml(m.tier || '—')}</td>
                <td>${escapeHtml((m.tournamentName || '').slice(0, 35))}</td>
                <td>${escapeHtml(m.round || '—')}</td>
                <td class="${m.result === 'W' ? 'win' : 'loss'}">${m.result === 'W' ? 'V' : 'D'}</td>
                <td>${escapeHtml(m.scoreRaw || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${narr?.paragraph ? `<p class="h2h-narrative">${md(narr.paragraph)}</p>` : ''}
      </div>
    `;
  };

  // Stash dos restantes pro Anexo D (consumido em renderAnnexH2hRest)
  ctx._h2hRest = remaining;

  return `
    <h3>4.5 Confrontos recorrentes (head-to-head)</h3>
    <p>${main.length === opps.length
      ? `Análise individual ${G.gender === 'F' ? 'das' : 'dos'} ${opps.length} ${G.adversarios} ${G.enfrentadas} 2 ou mais vezes.`
      : `Análise dos ${main.length} confrontos mais relevantes — recentes ou em aberto. Os outros ${remaining.length} estão listados no Anexo D.`}
      Cada confronto repetido conta uma história — entender essa história é essencial pra preparação dos próximos encontros.</p>
    ${main.map(renderCard).join('')}

    <h4>Síntese dos head-to-head</h4>
    ${(() => {
      const positives = opps.filter(o => o.wins > o.losses);
      const negatives = opps.filter(o => o.losses > o.wins);
      const balanced  = opps.filter(o => o.wins === o.losses);
      return `
        <div class="h2h-summary">
          ${positives.length ? `<div><strong>${G.Adversarios} com saldo positivo:</strong> ${positives.map(o => `${escapeHtml(o.name)} (${o.wins}-${o.losses})`).join(', ')}.</div>` : ''}
          ${balanced.length ? `<div><strong>Equilíbrio:</strong> ${balanced.map(o => `${escapeHtml(o.name)} (${o.wins}-${o.losses})`).join(', ')}.</div>` : ''}
          ${negatives.length ? `<div><strong>${G.Adversarios}-barreira:</strong> ${negatives.map(o => `${escapeHtml(o.name)} (${o.wins}-${o.losses})`).join(', ')}.</div>` : ''}
        </div>
        <p class="footnote">${G.Adversarios} recorrentes respondem por <strong>${opps.reduce((s, o) => s + o.total, 0)}</strong> dos ${analysis.counts.analyzed} jogos analisados (${Math.round(opps.reduce((s, o) => s + o.total, 0) / analysis.counts.analyzed * 100)}%) — concentração que reflete a realidade do circuito juvenil regional.</p>
      `;
    })()}
  `;
}

// ─── 4.6 Padrões temporais ───────────────────────────────────────────
function renderTemporalSection(ctx) {
  const { analysis, narratives } = ctx;
  const t = analysis.temporal;
  if (!t) return '';

  // Tabela de atividade por mês
  const monthly = t.monthlyMatches || {};
  const monthKeys = Object.keys(monthly).sort();
  const years = [...new Set(monthKeys.map(k => k.split('-')[0]))].sort();
  const monthLabels = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  return `
    <h3>4.6 Padrões temporais</h3>

    <h4>Distribuição de partidas ao longo do tempo</h4>
    <table class="data-table">
      <thead>
        <tr><th>Mês</th>${years.map(y => `<th>${y}</th>`).join('')}<th>Total</th></tr>
      </thead>
      <tbody>
        ${monthLabels.map((label, i) => {
          const mNum = String(i + 1).padStart(2, '0');
          let total = 0;
          const cells = years.map(y => {
            const data = monthly[`${y}-${mNum}`];
            if (!data) return '<td>—</td>';
            const sum = data.wins + data.losses;
            total += sum;
            return `<td>${sum} <span class="cell-meta">(${data.wins}V ${data.losses}D)</span></td>`;
          }).join('');
          return `<tr><td><strong>${label}</strong></td>${cells}<td><strong>${total || '—'}</strong></td></tr>`;
        }).join('')}
      </tbody>
    </table>
    <p class="footnote">Os meses "vazios" do ano em curso não significam que não haverá torneios — o calendário CBT cobre o ano todo. A explicação é simples: o Tênis Integrado costuma publicar os torneios cerca de 2 meses antes da disputa, então a parte da frente do ano ainda não está completa por aqui.</p>

    <h4>Maiores sequências registradas</h4>
    <ul>
      <li>Maior sequência de vitórias: <strong>${t.streaks.maxW}</strong> partidas consecutivas</li>
      <li>Maior sequência de derrotas: <strong>${t.streaks.maxL}</strong> partidas consecutivas</li>
    </ul>

    ${t.rhythm.medianIntervalDays !== null ? `
    <h4>Ritmo entre torneios</h4>
    <ul>
      <li>Mediana de intervalo: <strong>${t.rhythm.medianIntervalDays} dias</strong></li>
      <li>Menor intervalo: <strong>${t.rhythm.minIntervalDays} dias</strong></li>
      <li>Maior intervalo: <strong>${t.rhythm.maxIntervalDays} dias</strong></li>
      <li>Total de torneios disputados: <strong>${t.rhythm.tournamentCount}</strong></li>
    </ul>
    ` : ''}

    ${narratives.temporal ? `<p style="margin-top: 14px;">${md(narratives.temporal)}</p>` : ''}
  `;
}

function renderChapter5(ctx) {
  const { narratives } = ctx;
  const t = narratives.topPositive;
  const f = narratives.topNegative;
  const tightLoss = narratives.tightestLoss;
  if (!t && !f && !tightLoss) return '';

  const renderMoment = (m, kind) => `
    <div class="moment-card ${kind}">
      <div class="moment-title">${kind === 'positive' ? '★' : kind === 'tight' ? '◆' : '✗'} ${escapeHtml(m.title)}</div>
      <div class="moment-line">${escapeHtml(m.line1)}</div>
      <div class="moment-score">Placar: ${escapeHtml(m.score || '—')}</div>
      <p class="moment-paragraph">${md(m.paragraph)}</p>
    </div>
  `;

  return `
    <section class="chapter">
      <div class="chapter-num">CAPÍTULO 5</div>
      <h2 class="chapter-title">Os momentos que se destacaram</h2>
      <p>Em ${ctx.analysis.counts.analyzed} partidas analisadas, três se destacam estatisticamente pelo que entregaram acima ou abaixo do esperado, ou pela proximidade do desfecho.</p>

      ${t ? renderMoment(t, 'positive') : ''}
      ${f ? renderMoment(f, 'negative') : ''}
      ${tightLoss ? renderMoment(tightLoss, 'tight') : ''}
    </section>
  `;
}

function renderChapter6(ctx) {
  const { narratives, analysis, athleteFirstName, G } = ctx;
  const opps = analysis.recurrentOpponents || [];
  const positives = opps.filter(o => o.wins > o.losses);
  const negatives = opps.filter(o => o.losses > o.wins);
  const recentBarrier = negatives.find(o => {
    if (!o.lastDate) return false;
    const [d, mo, y] = o.lastDate.split('/').map(Number);
    const days = (new Date() - new Date(y, mo - 1, d)) / (1000 * 60 * 60 * 24);
    return days <= 90;
  });

  return `
    <section class="chapter">
      <div class="chapter-num">CAPÍTULO 6</div>
      <h2 class="chapter-title">O que aprendemos e o que observar</h2>

      <h3>Síntese geral</h3>
      <p>Em ${analysis.counts.analyzed} partidas de simples disputadas em ${analysis.temporal?.rhythm?.tournamentCount || '?'} torneios, ${escapeHtml(athleteFirstName)} construiu uma trajetória que começa com adaptação difícil, passa por uma fase de estabilização e chega ao período recente num momento claro de ascensão.</p>
      ${narratives.forma ? `<p>${md(narratives.forma)}</p>` : ''}

      <h3>As forças que os dados mostram</h3>

      <div class="insight-block positive">
        <div class="insight-symbol">↗</div>
        <div class="insight-content">
          <strong>Evolução real no período recente.</strong>
          ${narratives.headline ? md(narratives.headline) : ''}
        </div>
      </div>

      <div class="insight-block positive">
        <div class="insight-symbol">⚖</div>
        <div class="insight-content">
          <strong>Desempenho em jogos parelhos.</strong>
          ${narratives.bucket ? md(narratives.bucket) : ''}
        </div>
      </div>

      ${positives.length ? `
      <div class="insight-block positive">
        <div class="insight-symbol">↻</div>
        <div class="insight-content">
          <strong>Capacidade de virar histórico desfavorável.</strong>
          ${G.Adversario}${positives.length > 1 ? 's' : ''} com saldo positivo após reencontros: ${positives.map(o => `<strong>${escapeHtml(o.name)}</strong> (${o.wins}-${o.losses})`).join(', ')}.
          ${positives.some(o => o.matches[0]?.result === 'L') ? `Em alguns casos, a primeira partida foi derrota — e o histórico foi reescrito nos confrontos seguintes. Isso mostra que histórico ruim contra ${G.adversario === 'adversária' ? 'uma adversária' : 'um adversário'} NÃO é destino.` : ''}
        </div>
      </div>
      ` : ''}

      <h3>As áreas que valem observação</h3>

      ${recentBarrier ? `
      <div class="insight-block warning">
        <div class="insight-symbol">⚠</div>
        <div class="insight-content">
          <strong>Barreira atual: ${escapeHtml(recentBarrier.name)}.</strong>
          ${recentBarrier.wins} vitória${recentBarrier.wins === 1 ? '' : 's'} em ${recentBarrier.total} encontros, todos nos últimos 90 dias. Vale plano específico baseado nos detalhes dos confrontos anteriores no próximo encontro.
        </div>
      </div>
      ` : ''}

      ${analysis.tightestLoss?.hasSuperTiebreak ? `
      <div class="insight-block warning">
        <div class="insight-symbol">⚠</div>
        <div class="insight-content">
          <strong>Fechamento em tiebreak / super-tiebreak.</strong>
          Combinando derrotas em pontos decisivos (super-TB), surge sinal de que ainda há trabalho específico a desenvolver no jogo de tiebreak — o pequeno detalhe que separa ${G.gender === 'F' ? 'atletas competitivas das elite' : 'atletas competitivos da elite'} na categoria.
        </div>
      </div>
      ` : ''}

      ${(() => {
        const hist = analysis.scoreHistogram || {};
        const bagels = hist['0-6'] || 0;
        if (bagels >= 5) {
          return `
          <div class="insight-block warning">
            <div class="insight-symbol">⚠</div>
            <div class="insight-content">
              <strong>Frequência de pneus (0-6) nos sets perdidos.</strong>
              ${bagels} sets terminaram com placar 0-6 — frequência relativamente alta. Pode refletir ${G.adversarios} muito acima do nível, ou queda de produção dentro do jogo após primeiro set ruim. Vale conversar com o coach se há padrão emocional/tático a trabalhar.
            </div>
          </div>`;
        }
        return '';
      })()}

      <h3>Perguntas pra conversar com o coach</h3>
      <p>As perguntas abaixo não têm resposta nos dados — eles apenas apontam onde vale investigar. As respostas vêm de quem ${G.gender === 'F' ? 'conhece a atleta' : 'conhece o atleta'} em quadra:</p>
      <ol>
        ${analysis.tightestLoss?.hasSuperTiebreak ? `<li>Em jogos que vão pro super-tiebreak, qual é o plano de jogo? Já houve foco específico em pontos decisivos?</li>` : ''}
        <li>Quando perde o 1º set, qual é a rotina mental pra entrar no 2º?</li>
        ${recentBarrier ? `<li><strong>${escapeHtml(recentBarrier.name)}</strong> é uma "barreira mental" ou um problema tático específico? Vale revisitar mentalmente esses confrontos.</li>` : ''}
        ${positives.length ? `<li>Como foram os jogos da virada contra ${escapeHtml(positives[0].name)}? Vale entender a fórmula que funcionou — pode ser repetível.</li>` : ''}
        <li>O calendário atual está com a intensidade certa? Há períodos sem torneios que poderiam ser preenchidos?</li>
        <li>Em torneios fora do estado, ${escapeHtml(athleteFirstName)} se sente mais ou menos ${G.gender === 'F' ? 'pressionada' : 'pressionado'}? Como isso pode orientar o calendário?</li>
      </ol>

      <h3>O que o próximo relatório vai conseguir responder melhor</h3>
      <p>Quando o histórico chegar perto de ${analysis.counts.analyzed >= 50 ? '100' : analysis.counts.analyzed * 2}+ partidas, vai dar pra:</p>
      <ul>
        <li>Confirmar ou descartar as tendências que apareceram aqui.</li>
        <li>Apertar a faixa de incerteza do nível estimado.</li>
        <li>Ver com mais clareza os meses fortes e os meses difíceis.</li>
        <li>Cruzar mais detalhes — tipo: como vai contra G2 fora de casa, ou em fases finais.</li>
        <li>Falar com mais firmeza onde hoje a gente fala "tendência" — vira "característica".</li>
      </ul>

      <div class="closing-note">
        <strong>Pra fechar.</strong> Este relatório olhou ${analysis.counts.analyzed} partidas. Os números são exatos; as leituras são <strong>prováveis</strong>, não certezas. Daqui 6 a 12 meses, com mais histórico, vamos conseguir cravar mais. Por enquanto, ${escapeHtml(athleteFirstName)} está dando sinais bons em várias frentes. Tênis é jogo de paciência — o que se constrói agora aparece lá na frente.
      </div>
    </section>
  `;
}

// Capítulo 7 — "Onde queremos chegar". Metas SMART pros próximos 6 e 12
// meses + lista do que já está forte e deve ser mantido.
function renderChapter7Forecast(ctx) {
  const { forecast, athleteFirstName, G } = ctx;
  if (!forecast || (!forecast.targets.length && !forecast.strengths.length)) return '';

  const strengthsBlock = forecast.strengths.length ? `
    <h3>Mantém o que já está forte</h3>
    <p class="forecast-intro">Esses pontos já estão no padrão de elite. Nas próximas edições, o objetivo é <strong>não perder o que foi conquistado</strong>.</p>
    <div class="strengths-grid">
      ${forecast.strengths.map(s => `
        <div class="strength-card">
          <div class="strength-icon">${s.icon}</div>
          <div class="strength-body">
            <div class="strength-label">${escapeHtml(s.label)}</div>
            <div class="strength-value">${escapeHtml(s.value)}</div>
            <div class="strength-msg">${escapeHtml(s.message)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : '';

  const targetsBlock = forecast.targets.length ? `
    <h3>Trabalha os pontos de salto</h3>
    <p class="forecast-intro">Cada uma dessas metas é <strong>direção</strong>, não previsão. São alvos razoáveis se o trabalho for consistente nos próximos meses.</p>
    <table class="forecast-table">
      <thead>
        <tr>
          <th>Onde mexer</th>
          <th class="num">Hoje</th>
          <th class="num target">Meta 6 meses</th>
          <th class="num target">Meta 12 meses</th>
        </tr>
      </thead>
      <tbody>
        ${forecast.targets.map(t => `
          <tr>
            <td>
              <div class="target-row-icon">${t.icon}</div>
              <div class="target-row-label"><strong>${escapeHtml(t.label)}</strong></div>
            </td>
            <td class="num">${escapeHtml(t.current)}</td>
            <td class="num target">${escapeHtml(t.target6m)}</td>
            <td class="num target">${escapeHtml(t.target12m)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <h3>Como vamos medir</h3>
    ${forecast.targets.map(t => `
      <div class="target-detail keep-together">
        <div class="target-detail-header">
          <span class="target-detail-icon">${t.icon}</span>
          <span class="target-detail-title">${escapeHtml(t.shortLabel)}: <strong>${escapeHtml(t.current)}</strong> → <strong>${escapeHtml(t.target6m)}</strong> em 6 meses</span>
        </div>
        <p>${escapeHtml(t.rationale)}</p>
        <p class="target-detail-meta"><strong>Como medimos:</strong> ${escapeHtml(t.measurement)}</p>
        ${t.trainingHint ? `<p class="target-detail-meta"><strong>Pista pro treino:</strong> ${escapeHtml(t.trainingHint)}</p>` : ''}
      </div>
    `).join('')}
  ` : '';

  return `
    <section class="chapter forecast-section">
      <div class="chapter-num">CAPÍTULO 7</div>
      <h2 class="chapter-title">Onde queremos chegar</h2>
      <p class="forecast-lead">Os números abaixo não são previsão — são <strong>alvos razoáveis</strong> pros próximos 6 e 12 meses, focados nos pontos que dão mais retorno. Cada um vai ser medido na próxima edição do relatório, então a régua fica clara desde já.</p>

      ${strengthsBlock}
      ${targetsBlock}

      <div class="forecast-contract">
        <div class="forecast-contract-label">O contrato</div>
        <p>A próxima edição deste relatório (idealmente em <strong>6 meses</strong>) vai trazer uma tabela igual a esta com a coluna "Hoje" atualizada. Cada meta batida é validação do trabalho. Cada meta não batida é matéria pra conversa com o coach — pode ser fase, pode ser que o caminho seja outro.</p>
      </div>
    </section>
  `;
}

function renderSignature(ctx) {
  return `
    <section class="signature">
      <div class="signature-rule"></div>
      <div class="signature-block">
        <div class="signature-label">Análise técnica e parecer:</div>
        <div class="signature-name">${escapeHtml(SIGNATURE.name)}</div>
        <div class="signature-title">${escapeHtml(SIGNATURE.title)} — ${escapeHtml(SIGNATURE.registry)}</div>
        <div class="signature-place">${escapeHtml(SIGNATURE.city)}, ${escapeHtml(ctx.dateStr)}</div>
      </div>
    </section>
  `;
}

function renderAnnexA(ctx) {
  const { matches, G } = ctx;
  const singles = matches.filter(m => !m.isDoubles && !m.wo)
    .sort((a, b) => (a.endDate || '').split('/').reverse().join('').localeCompare((b.endDate || '').split('/').reverse().join('')));
  const doubles = matches.filter(m => m.isDoubles && !m.wo);
  const wos = matches.filter(m => m.wo);

  return `
    <section class="annex">
      <div class="chapter-num">ANEXO A</div>
      <h2 class="chapter-title">Lista completa das partidas</h2>

      <h3>Partidas de simples analisadas (${singles.length})</h3>
      <table class="data-table small">
        <thead>
          <tr><th>#</th><th>Data</th><th>Tier</th><th>Cidade</th><th>Fase</th><th>${G.Adversario}</th><th>R</th><th>Placar</th></tr>
        </thead>
        <tbody>
          ${singles.map((m, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(m.endDate || '')}</td>
              <td>${escapeHtml(m.tier || '—')}</td>
              <td>${escapeHtml(m.city || '—')}</td>
              <td>${escapeHtml(m.round || '—')}</td>
              <td>${escapeHtml((m.opponentName || '').slice(0, 28))}</td>
              <td class="${m.result === 'W' ? 'win' : 'loss'}">${m.result === 'W' ? 'V' : 'D'}</td>
              <td>${escapeHtml(m.scoreRaw || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${doubles.length ? `
      <h3>Partidas de duplas (${doubles.length}) — fora desta análise</h3>
      <table class="data-table small">
        <thead>
          <tr><th>Data</th><th>Tier</th><th>Cidade</th><th>${G.Adversarios}</th><th>R</th><th>Placar</th></tr>
        </thead>
        <tbody>
          ${doubles.map(m => `
            <tr>
              <td>${escapeHtml(m.endDate || '')}</td>
              <td>${escapeHtml(m.tier || '—')}</td>
              <td>${escapeHtml(m.city || '—')}</td>
              <td>${escapeHtml((m.opponentName || '').slice(0, 40))}</td>
              <td class="${m.result === 'W' ? 'win' : 'loss'}">${m.result === 'W' ? 'V' : 'D'}</td>
              <td>${escapeHtml(m.scoreRaw || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ` : ''}

      ${wos.length ? `
      <h3>Jogos marcados como W.O. (${wos.length}) — fora da análise</h3>
      <p class="footnote">Aparecem como W.O. no Tênis Integrado mas, na prática, parte significativa desses registros são erros de cadastro (jogos que aconteceram normalmente foram marcados como walkover). Por não termos como separar W.O. real de erro de cadastro, o critério aqui é excluir todos.</p>
      <table class="data-table small">
        <thead><tr><th>Data</th><th>Torneio</th></tr></thead>
        <tbody>
          ${wos.map(m => `<tr><td>${escapeHtml(m.endDate || '')}</td><td>${escapeHtml((m.tournamentName || '').slice(0, 60))}</td></tr>`).join('')}
        </tbody>
      </table>
      ` : ''}
    </section>
  `;
}

function renderAnnexB(ctx) {
  const G = ctx?.G || G_DEFAULT;
  return `
    <section class="annex">
      <div class="chapter-num">ANEXO B</div>
      <h2 class="chapter-title">Glossário</h2>

      <dl class="glossary">
        <dt>Rating Glicko-2</dt>
        <dd>Sistema estatístico de pontuação criado por Mark Glickman (Harvard, 2012). Atribui dois números ${G.do_atleta}: rating (estimativa do nível) e RD (incerteza). Atualiza após cada partida considerando o rating ${G.gender === 'F' ? 'da adversária' : 'do adversário'}.</dd>

        <dt>RD (Rating Deviation)</dt>
        <dd>A "incerteza" do Glicko-2. Quanto menor, mais confiamos no rating estimado. Cresce quando ${G.atleta} passa muito tempo sem jogar; diminui com mais partidas.</dd>

        <dt>IC 95% (Intervalo de Confiança)</dt>
        <dd>Faixa de valores onde é razoável esperar que o "valor verdadeiro" esteja, com 95% de chance. Usado para apresentar o rating como faixa, não número fixo.</dd>

        <dt>Tier (G1, G2, G3, GA)</dt>
        <dd>Classificação oficial dos torneios CBT pela importância. G1 é o nível mais alto (mais pontos), G3 é o introdutório.</dd>

        <dt>TT (Total Tiebreak)</dt>
        <dd>Formato de partida usado em algumas etapas regionais juvenis brasileiras: o jogo todo é decidido em 1 match-tiebreak, em vez de 2 sets normais.</dd>

        <dt>Super-tiebreak (STB)</dt>
        <dd>Match-tiebreak usado como 3º "set" em jogos de 2 sets em empate. Disputado até 10 pontos com diferença de 2.</dd>

        <dt>W.O. (Walkover)</dt>
        <dd>Tecnicamente: partida onde ${G.gender === 'F' ? 'uma atleta vence porque a adversária não comparece' : 'um atleta vence porque o adversário não comparece'} ou desiste antes do início. Sem disputa efetiva — excluído das análises. <strong>Importante</strong>: no Tênis Integrado, parte significativa dos jogos marcados como W.O. são erros de cadastro (a partida aconteceu, mas foi registrada errada). Como não temos como separar W.O. real de erro, o critério é excluir todos.</dd>

        <dt>Pneu</dt>
        <dd>Set vencido por 6-0. Pneu duplo é um jogo onde ${G.gender === 'F' ? 'a vencedora' : 'o vencedor'} não cedeu nenhum game (6-0 6-0).</dd>

        <dt>WTN (World Tennis Number)</dt>
        <dd>Sistema global de classificação de tênis publicado pela ITF na escala 1 (top mundial) a 40 (iniciante).</dd>
      </dl>
    </section>
  `;
}

function renderAnnexC(ctx) {
  const G = ctx?.G || G_DEFAULT;
  return `
    <section class="annex">
      <div class="chapter-num">ANEXO C</div>
      <h2 class="chapter-title">Notas técnicas</h2>

      <h3>Parâmetros do Glicko-2</h3>
      <ul>
        <li>Rating inicial: 1500</li>
        <li>Rating Deviation inicial: 350 (default Glickman 2012)</li>
        <li>Volatilidade σ inicial: 0,06</li>
        <li>τ (constraint): 0,5</li>
        <li>Cada partida é tratada como rating period individual</li>
        <li>Updates em ordem cronológica</li>
      </ul>

      <h3>Faixas de força do oponente</h3>
      <ul>
        <li>Mais ${G.gender === 'F' ? 'forte' : 'forte'}: rating do oponente ≥ rating ${G.do_atleta} + 100 pts</li>
        <li>${G.gender === 'F' ? 'Parelha' : 'Parelho'}: diferença entre -100 e +100 pts</li>
        <li>Mais ${G.gender === 'F' ? 'fraca' : 'fraco'}: rating do oponente ≤ rating ${G.do_atleta} - 100 pts</li>
        <li>Comparação calculada no momento exato de cada partida (rating dinâmico)</li>
      </ul>

      <h3>Janelas temporais</h3>
      <ul>
        <li>Histórico todo: todas as partidas do dataset</li>
        <li>Últimos 12 meses: data ≥ hoje - 365 dias</li>
        <li>Últimos 90 dias: data ≥ hoje - 90 dias</li>
      </ul>

      <h3>Software</h3>
      <ul>
        <li>Tennis Flow v1.0 — backend Node.js</li>
        <li>Implementação Glicko-2 própria, validada contra exemplo canônico de Glickman 2012</li>
        <li>Visualizações: SVG renderizado server-side</li>
        <li>Layout: HTML/CSS otimizado para impressão A4</li>
      </ul>
    </section>
  `;
}

// ─── Anexo D: H2H restantes (rivais menos recentes/relevantes) ─────────
function renderAnnexH2hRest(ctx) {
  const rest = ctx._h2hRest || [];
  if (!rest.length) return '';
  return `
    <section class="annex">
      <div class="chapter-num">ANEXO D</div>
      <h2 class="chapter-title">Demais confrontos recorrentes</h2>
      <p>Adversários enfrentados 2+ vezes que não entraram no corpo principal por serem menos recentes ou menos críticos pra preparação imediata. Histórico completo abaixo.</p>
      <table class="data-table small">
        <thead>
          <tr><th>${ctx.G.Adversario}</th><th>Saldo</th><th>Último encontro</th><th>Datas</th></tr>
        </thead>
        <tbody>
          ${rest.map(opp => {
            const dates = opp.matches
              .map(m => `${escapeHtml(m.endDate)} (${m.result === 'W' ? 'V' : 'D'} ${escapeHtml(m.scoreRaw || '—')})`)
              .join(' · ');
            const lastDate = opp.matches[opp.matches.length - 1]?.endDate || '—';
            return `
              <tr>
                <td><strong>${escapeHtml(opp.name)}</strong></td>
                <td>${opp.wins}V × ${opp.losses}D</td>
                <td>${escapeHtml(lastDate)}</td>
                <td style="font-size:10px;">${dates}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </section>
  `;
}

// ─── Renderizador principal ─────────────────────────────────────────────

export function generateReportHtml(profileId) {
  const profile = getProfile(profileId);
  const synced = getSyncedData(profileId);
  const matchesData = getMatchesData(profileId);
  return generateReportHtmlFromData({
    profile, synced, matches: matchesData.matches || [], profileId,
  });
}

// Versão stateless: recebe os dados já carregados em vez de ler do storage.
// Útil pra rodar localmente a partir de um zip exportado, ou pra tests.
export function generateReportHtmlFromData({ profile, synced, matches: rawMatches, profileId }) {
  const matches = enrichMatchesWithTier(rawMatches || [], synced?.tournaments);
  const analysis = analyzeMatches(matches, profileId || profile?.id);

  // Prioriza o nome COMPLETO do TI (synced.athlete.name) sobre o athleteName
  // do profile, que pode ser apenas um apelido/nome curto definido pelo user.
  // Princípio: relatório oficial usa o nome registrado no TI, não abrevia.
  const athleteName = synced?.athlete?.name || profile?.athleteName || 'Atleta';
  const athleteFirstName = athleteName.split(' ')[0];
  const athleteId = synced?.athlete?.id || profileId;
  const ranking = synced?.athlete?.rankingNational
    ? `${synced.athlete.rankingNational.position}º (${String(synced.athlete.rankingNational.points).replace('.', ',')} pts)`
    : null;

  const gender = detectGender(synced, matches);
  const G = genderTerms(gender);
  const mainCategory = detectMainCategory(synced, matches);
  const categoryLabel = mainCategory ? categoryFullLabel(mainCategory, gender) : null;

  const narratives = generateAllNarrativesThirdPerson(analysis, athleteFirstName, athleteName, G);

  const today = new Date();
  const dateStr = formatLongDate(today);

  // Período coberto
  const sortedMatches = [...matches].sort((a, b) => {
    const ka = (a.endDate || '').split('/').reverse().join('');
    const kb = (b.endDate || '').split('/').reverse().join('');
    return ka.localeCompare(kb);
  });
  const periodFrom = sortedMatches[0]?.endDate || '—';
  const periodTo = sortedMatches[sortedMatches.length - 1]?.endDate || '—';

  // Não há dados suficientes
  if (analysis.counts.analyzed < 5) {
    return baseHtmlShell(athleteName, dateStr, `
      <section class="chapter">
        <h2 class="chapter-title">Histórico ainda em construção</h2>
        <p>Foram analisadas apenas <strong>${analysis.counts.analyzed}</strong> partidas — precisamos de pelo menos 5 para um relatório útil. Continue jogando e este relatório fica mais rico a cada torneio.</p>
        <p class="footnote">Fora da análise: ${analysis.counts.excluded.doubles} duplas e ${analysis.counts.excluded.wo} registros marcados como W.O. (parte costuma ser erro de cadastro do TI, não desistência real).</p>
      </section>
    `);
  }

  const archetypes = computeArchetypes(analysis, gender);
  const forecast = computeForecast(analysis);

  const ctx = {
    profile, synced, matches, analysis, narratives,
    athleteName, athleteFirstName, athleteId, ranking,
    periodFrom, periodTo, dateStr,
    gender, G, mainCategory, categoryLabel,
    archetypes, forecast,
  };

  const body = `
    ${renderCover(ctx)}
    ${renderExecutiveSummary(ctx)}
    ${renderDnaAndMetrics(ctx)}
    ${renderChapter1(ctx)}
    ${renderChapter2(ctx)}
    ${renderChapter3(ctx)}
    ${renderChapter4(ctx)}
    ${renderChapter5(ctx)}
    ${renderChapter6(ctx)}
    ${renderChapter7Forecast(ctx)}
    ${renderSignature(ctx)}
    ${renderAnnexA(ctx)}
    ${renderAnnexB(ctx)}
    ${renderAnnexC(ctx)}
    ${renderAnnexH2hRest(ctx)}
  `;

  return baseHtmlShell(athleteName, dateStr, body);
}

// ─── Shell HTML com CSS print A4 ────────────────────────────────────────

function baseHtmlShell(athleteName, dateStr, body) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Relatório de Performance — ${escapeHtml(athleteName)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
    color: ${COLORS.textDark};
    background: #f8fafc;
    line-height: 1.55;
    margin: 0;
    padding: 24px;
    max-width: 820px;
    margin-left: auto;
    margin-right: auto;
    font-size: 13px;
  }
  @media print {
    body {
      background: white; padding: 0; max-width: none;
      /* Evita quebra com 1-2 linhas órfãs/viúvas em parágrafos */
      orphans: 3; widows: 3;
    }
    .no-print { display: none !important; }

    /* Capítulos/anexos começam em nova página, mas SEM forçar break-inside.
       Antes: section { page-break-inside: avoid } gerava páginas em branco
       quando o conteúdo era grande demais pra caber numa folha A4.

       Cover: break-after garante exec-summary começar em nova página.
       Exec-summary NÃO tem break-after — o próximo bloco (.chapter) já
       força break-before, e duas forças seguidas geram página em branco
       entre elas. */
    .chapter, .annex { page-break-before: always; break-before: page; }
    .cover { page-break-after: always; break-after: page; }

    /* Cabeçalho NUNCA fica órfão no fim da página — sempre acompanha o
       primeiro parágrafo do bloco. */
    h2, h3, h4, .chapter-title, .chapter-num {
      page-break-after: avoid; break-after: avoid;
      page-break-inside: avoid; break-inside: avoid;
    }

    /* Blocos visuais menores não quebram no meio — só inteiros ou
       começam em nova página. Critério: blocos curtos o suficiente
       pra caber sempre em uma folha. */
    .signature-phrase, .archetype-badge, .insight-block, .metric-card,
    .h2h-card, .ranking-box, .dual-box, .profile-card, .closing-note,
    .exec-headline, .exec-warning, .stat-box, .rating-display,
    .ev-display, .radar-interpretation, .player-card-radar {
      page-break-inside: avoid; break-inside: avoid;
    }

    /* Tabelas: cabeçalho repete em quebra, linhas não quebram no meio. */
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }

    /* Imagens/SVGs (sparkline, radar, heatmap, histograma) inteiros. */
    svg { page-break-inside: avoid; break-inside: avoid; }

    /* Parágrafos: evita 1 linha solta no fim/início da página. */
    p { page-break-inside: avoid; break-inside: avoid; }

    /* Blocos "keep-together": agrupa h3 + chart/tabela pra que título
       e visualização não fiquem em páginas diferentes. break-inside:
       avoid mantém o conjunto unido — se não couber, vai inteiro pra
       próxima página. */
    .keep-together,
    .calendar-heatmap-wrap,
    .player-card-body,
    .dna-radar-wrap {
      page-break-inside: avoid; break-inside: avoid;
    }

    /* Heatmap não deve scrollar em print — força largura natural */
    .calendar-heatmap-wrap { overflow: visible; }
  }

  .no-print {
    background: ${COLORS.bgLight};
    border: 1px solid ${COLORS.cyanLight};
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 24px;
    font-size: 13px;
    color: ${COLORS.navy};
  }

  /* COVER ─────────────────────────────────────────────────────── */
  .cover {
    min-height: calc(100vh - 60px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 30px;
    background: linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.navyLight} 100%);
    color: white;
    border-radius: 12px;
    margin-bottom: 24px;
    page-break-after: always;
  }
  @media print {
    .cover {
      /* Em print, vh pode mapear pra viewport da tela em vez da página A4
         (depende do browser e zoom). Usar mm absoluto evita estouro pra
         página seguinte. A4 útil = 297 - 36 = 261mm; deixamos 240 pra
         garantir centralização do conteúdo sem overflow. */
      min-height: 240mm;
      border-radius: 0;
      margin-bottom: 0;
      padding: 50px 40px;
    }
  }
  .cover-inner { text-align: center; max-width: 600px; }
  .cover-logo {
    margin-bottom: 18px;
    display: flex; justify-content: center;
  }
  .cover-logo svg {
    width: 96px; height: 96px;
    border-radius: 18px;
    background: rgba(255,255,255,0.06);
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
  }
  .brand-mark {
    font-size: 14px; font-weight: 700; letter-spacing: 4px;
    color: ${COLORS.cyanLight}; margin-bottom: 8px;
  }
  .brand-rule {
    width: 60px; height: 2px; background: ${COLORS.cyanLight};
    margin: 0 auto 32px;
  }
  .cover-title {
    font-size: 48px; font-weight: 700; letter-spacing: -1px;
    margin: 0 0 20px;
  }
  .cover-athlete {
    font-size: 26px; font-weight: 500; margin-bottom: 8px;
  }
  .cover-meta {
    font-size: 14px; opacity: 0.85; margin-bottom: 4px;
  }
  .cover-period {
    font-size: 13px; opacity: 0.75; margin-bottom: 4px;
  }
  .cover-edition {
    font-size: 12px; opacity: 0.6; margin-bottom: 32px;
  }
  .cover-statement {
    font-style: italic; font-size: 13px; line-height: 1.7;
    opacity: 0.85; max-width: 500px; margin: 0 auto 32px;
    padding: 16px; border-left: 2px solid ${COLORS.cyanLight};
    text-align: left;
  }
  .cover-foot {
    display: flex; justify-content: space-between;
    font-size: 11px; opacity: 0.6; margin-top: 24px;
  }

  /* EXECUTIVE SUMMARY ─────────────────────────────────────────── */
  .exec-summary {
    background: white;
    border: 1px solid ${COLORS.borderLight};
    border-radius: 10px;
    padding: 28px 32px;
    margin-bottom: 24px;
  }
  .exec-eyebrow {
    font-size: 11px; font-weight: 700; letter-spacing: 2px;
    color: ${COLORS.cyan}; text-transform: uppercase;
  }
  .exec-athlete {
    font-size: 22px; font-weight: 600; color: ${COLORS.navy};
    margin: 4px 0 2px;
  }
  .exec-meta { font-size: 12px; color: ${COLORS.textMuted}; margin-bottom: 18px; }
  .exec-headline {
    background: ${COLORS.bgLight};
    border-left: 3px solid ${COLORS.cyan};
    padding: 14px 18px;
    border-radius: 4px;
    margin-bottom: 22px;
  }
  .exec-headline-label {
    font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
    color: ${COLORS.cyan}; text-transform: uppercase; margin-bottom: 4px;
  }
  .exec-headline-text {
    font-size: 14px; line-height: 1.6; color: ${COLORS.textDark};
  }
  .exec-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
    margin-bottom: 20px;
  }
  .exec-col-title {
    font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
    color: ${COLORS.textMuted}; text-transform: uppercase; margin-bottom: 8px;
  }
  .exec-row {
    display: flex; justify-content: space-between;
    padding: 4px 0; font-size: 12px;
    border-bottom: 1px dashed ${COLORS.borderLight};
  }
  .exec-row:last-child { border-bottom: none; }
  .exec-row strong { font-weight: 600; }
  .exec-rating {
    font-size: 56px; font-weight: 800; color: ${COLORS.violet};
    line-height: 1; margin-top: 6px; letter-spacing: -1.5px;
  }
  .exec-rating-meta {
    font-size: 11px; color: ${COLORS.textMuted}; margin-bottom: 4px;
  }
  .exec-insights {
    margin: 18px 0;
  }
  .exec-insight {
    display: flex; gap: 12px; margin-bottom: 10px;
    padding: 12px; background: #f8fafc; border-radius: 6px;
    font-size: 12px; line-height: 1.6;
  }
  .exec-insight .bullet {
    flex: 0 0 24px; font-size: 18px; color: ${COLORS.cyan};
    text-align: center;
  }
  .exec-warning {
    background: #fef3c7; border-left: 3px solid ${COLORS.amber};
    padding: 12px 16px; border-radius: 4px;
    font-size: 12px; line-height: 1.5; margin: 18px 0 0;
    color: #78350f;
  }
  .exec-foot {
    margin-top: 16px; padding-top: 12px;
    border-top: 1px solid ${COLORS.borderLight};
    font-size: 11px; color: ${COLORS.textMuted};
  }

  /* CAPÍTULO 7 — Onde queremos chegar (forecast) ───────────────── */
  .forecast-section .forecast-lead {
    font-size: 13px; color: ${COLORS.textDark};
    line-height: 1.6; margin-bottom: 16px;
  }
  .forecast-intro {
    font-size: 12px; color: ${COLORS.textMuted};
    margin: 6px 0 14px;
  }
  .strengths-grid {
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;
    margin-bottom: 22px;
  }
  .strength-card {
    background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
    border: 1px solid #a7f3d0; border-radius: 10px;
    padding: 14px 16px;
    display: flex; align-items: flex-start; gap: 12px;
  }
  .strength-icon { font-size: 28px; line-height: 1; }
  .strength-body { flex: 1; }
  .strength-label {
    font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
    color: #047857; text-transform: uppercase; margin-bottom: 2px;
  }
  .strength-value {
    font-size: 18px; font-weight: 800; color: ${COLORS.emerald};
    line-height: 1.1;
  }
  .strength-msg {
    font-size: 11px; color: #065f46; margin-top: 4px;
  }
  .forecast-table {
    width: 100%; border-collapse: collapse;
    margin: 8px 0 22px; font-size: 12px;
  }
  .forecast-table thead th {
    background: ${COLORS.navy}; color: white;
    padding: 10px 12px; text-align: left;
    font-size: 11px; letter-spacing: 0.5px;
    font-weight: 700;
  }
  .forecast-table thead th.num { text-align: right; }
  .forecast-table thead th.target { color: ${COLORS.cyanLight}; }
  .forecast-table tbody td {
    padding: 12px; border-bottom: 1px solid ${COLORS.borderLight};
    vertical-align: middle;
  }
  .forecast-table tbody td.num {
    text-align: right; font-weight: 700; color: ${COLORS.navy};
    font-size: 14px; white-space: nowrap;
  }
  .forecast-table tbody td.num.target {
    color: ${COLORS.violet}; font-size: 16px;
  }
  .target-row-icon {
    display: inline-block; font-size: 18px; margin-right: 8px;
    vertical-align: middle;
  }
  .target-row-label {
    display: inline-block; vertical-align: middle;
  }
  .target-detail {
    background: ${COLORS.bgLight};
    border-left: 4px solid ${COLORS.cyan};
    border-radius: 8px; padding: 14px 18px; margin-bottom: 12px;
  }
  .target-detail-header {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 6px;
  }
  .target-detail-icon { font-size: 22px; line-height: 1; }
  .target-detail-title {
    font-size: 13px; color: ${COLORS.navy}; font-weight: 600;
  }
  .target-detail p {
    font-size: 12px; line-height: 1.55; margin: 6px 0;
    color: ${COLORS.textDark};
  }
  .target-detail-meta {
    font-size: 11.5px; color: ${COLORS.textMuted};
  }
  .target-detail-meta strong { color: ${COLORS.navy}; }
  .forecast-contract {
    background: linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.navyLight} 100%);
    color: white; padding: 22px 26px; border-radius: 12px;
    margin-top: 24px;
    box-shadow: 0 4px 12px rgba(14,58,77,0.18);
  }
  .forecast-contract-label {
    font-size: 11px; font-weight: 800; letter-spacing: 1.6px;
    color: ${COLORS.cyanLight}; text-transform: uppercase;
    margin-bottom: 8px;
  }
  .forecast-contract p {
    font-size: 13px; line-height: 1.6; margin: 0;
    color: rgba(255,255,255,0.92);
  }

  /* FRASE DO ATLETA — assinatura editorial ───────────────────── */
  .signature-phrase {
    background: linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.navyLight} 100%);
    color: white; padding: 30px 34px 30px 44px; margin: 18px 0;
    border-radius: 14px; position: relative;
    page-break-inside: avoid;
    box-shadow: 0 6px 20px rgba(14,58,77,0.18);
  }
  .signature-quote-mark {
    position: absolute; top: -4px; left: 18px;
    font-size: 88px; line-height: 1; color: ${COLORS.cyan};
    font-weight: 800;
  }
  .signature-text {
    font-size: 20px; line-height: 1.4; font-weight: 500;
    color: white; padding-left: 10px;
    letter-spacing: -0.2px;
  }

  /* PERFIL COMPETITIVO — Player card layout ──────────────────── */
  .player-card .archetype-badges {
    display: flex; gap: 12px; margin-bottom: 22px; flex-wrap: wrap;
  }
  .archetype-badge {
    flex: 1; min-width: 260px;
    background: linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.navyLight} 100%);
    color: white; padding: 24px 26px; border-radius: 14px;
    display: flex; align-items: flex-start; gap: 18px;
    box-shadow: 0 6px 18px rgba(14,58,77,0.2);
  }
  .badge-icon {
    font-size: 44px; line-height: 1;
  }
  .badge-content { flex: 1; }
  .badge-tag {
    font-size: 22px; font-weight: 800; letter-spacing: -0.4px;
    color: ${COLORS.cyanLight}; margin-bottom: 6px;
    line-height: 1.1;
  }
  .badge-desc {
    font-size: 13px; line-height: 1.5; color: rgba(255,255,255,0.92);
  }
  .player-card-body {
    display: grid; grid-template-columns: 380px 1fr; gap: 28px;
    align-items: start; margin: 10px 0 14px;
  }
  .player-card-radar {
    display: flex; flex-direction: column; align-items: center;
    background: ${COLORS.bgLight};
    padding: 18px; border-radius: 12px;
    border: 1px solid ${COLORS.borderLight};
  }
  .radar-caption {
    font-size: 11px; color: ${COLORS.textMuted};
    text-align: center; margin-top: 8px; padding: 0 8px;
    line-height: 1.4;
  }
  .radar-glossary {
    font-size: 10.5px; color: ${COLORS.textMuted};
    text-align: left; margin-top: 12px; padding: 10px 12px;
    background: white; border-radius: 8px;
    border: 1px solid ${COLORS.borderLight};
    line-height: 1.55;
  }
  .radar-glossary strong { color: ${COLORS.navy}; font-weight: 700; }
  .radar-interpretation {
    margin: 18px 0 8px; padding: 16px 20px;
    background: ${COLORS.bgLight};
    border-left: 4px solid ${COLORS.cyan};
    border-radius: 8px;
  }
  .radar-interp-label {
    font-size: 10px; font-weight: 800; letter-spacing: 1.5px;
    color: ${COLORS.cyan}; text-transform: uppercase;
    margin-bottom: 6px;
  }
  .radar-interpretation p {
    font-size: 12.5px; line-height: 1.6; color: ${COLORS.textDark};
    margin: 0;
  }
  .player-card-metrics {
    display: flex; flex-direction: column; gap: 12px;
  }
  .player-card-metrics .metric-card {
    padding: 16px 18px;
  }
  .player-card-metrics .metric-card .metric-title {
    font-size: 13px; letter-spacing: -0.1px; text-transform: none;
    font-weight: 700; color: ${COLORS.navy};
  }
  .player-card-metrics .metric-card .metric-score {
    font-size: 42px; margin-top: 4px; font-weight: 800;
    letter-spacing: -1px; line-height: 1;
  }
  .player-card-metrics .metric-card .metric-unit {
    font-size: 16px;
  }
  .player-card-metrics .metric-card .metric-sublabel {
    font-size: 11px;
  }
  .player-card-metrics .metric-card .metric-breakdown {
    font-size: 11px;
  }
  .metric-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
    margin-bottom: 12px;
  }
  .metric-card {
    border: 1px solid ${COLORS.borderLight};
    border-radius: 8px; padding: 14px;
    page-break-inside: avoid;
  }
  .metric-card .metric-title {
    font-size: 10px; font-weight: 700; letter-spacing: 1.4px;
    color: ${COLORS.textMuted}; text-transform: uppercase;
  }
  .metric-card .metric-score {
    font-size: 32px; font-weight: 800; line-height: 1; margin-top: 4px;
    color: ${COLORS.navy};
  }
  .metric-card .metric-unit {
    font-size: 14px; font-weight: 500; color: ${COLORS.textMuted};
    margin-left: 2px;
  }
  .metric-card .metric-sublabel {
    font-size: 11px; color: ${COLORS.textMuted}; margin-top: 4px;
  }
  .metric-card .metric-breakdown {
    font-size: 10.5px; color: ${COLORS.textDark}; margin-top: 8px;
    padding-top: 8px; border-top: 1px dashed ${COLORS.borderLight};
    line-height: 1.5;
  }
  .metric-card.metric-strong { background: #ecfdf5; border-color: #a7f3d0; }
  .metric-card.metric-strong .metric-score { color: ${COLORS.emerald}; }
  .metric-card.metric-mid    { background: #fffbeb; border-color: #fde68a; }
  .metric-card.metric-mid    .metric-score { color: ${COLORS.amber}; }
  .metric-card.metric-weak   { background: #fef2f2; border-color: #fecaca; }
  .metric-card.metric-weak   .metric-score { color: ${COLORS.rose}; }
  .metric-card.metric-neutral { background: ${COLORS.bgLight}; }
  .dna-radar-wrap {
    display: flex; justify-content: center; margin: 16px 0 4px;
  }
  .dna-radar-caption {
    text-align: center; margin-top: -4px;
  }
  .calendar-heatmap-wrap {
    display: flex; justify-content: center; margin: 14px 0 2px;
    overflow-x: auto;
  }

  /* CHAPTERS ──────────────────────────────────────────────────── */
  .chapter, .annex {
    background: white;
    border: 1px solid ${COLORS.borderLight};
    border-radius: 12px;
    padding: 36px 40px;
    margin-bottom: 28px;
  }
  .chapter-num {
    font-size: 11px; font-weight: 800; letter-spacing: 2.4px;
    color: ${COLORS.cyan}; text-transform: uppercase;
    margin-bottom: 8px;
  }
  .chapter-title {
    font-size: 28px; font-weight: 700; color: ${COLORS.navy};
    margin: 0 0 24px; letter-spacing: -0.5px;
    line-height: 1.2;
  }
  h3 {
    font-size: 15px; font-weight: 700; color: ${COLORS.navy};
    margin: 26px 0 12px; padding-top: 4px;
    letter-spacing: -0.1px;
  }
  .chapter h3:first-of-type { margin-top: 8px; }
  p { margin: 8px 0; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { margin-bottom: 4px; }
  .footnote {
    font-size: 11px; color: ${COLORS.textMuted}; font-style: italic;
    margin: 8px 0; line-height: 1.5;
  }
  .caption {
    font-size: 11px; color: ${COLORS.textMuted}; font-style: italic;
    text-align: center; margin: 4px 0 12px;
  }

  /* TABLES ────────────────────────────────────────────────────── */
  .data-table {
    width: 100%; border-collapse: collapse; font-size: 12px;
    margin: 12px 0;
  }
  .data-table.small { font-size: 11px; }
  .data-table th {
    background: ${COLORS.navy}; color: white;
    text-align: left; padding: 6px 8px;
    font-size: 11px; font-weight: 600;
    letter-spacing: 0.3px;
  }
  .data-table td {
    padding: 5px 8px; border-bottom: 1px solid ${COLORS.borderLight};
  }
  .data-table tr:nth-child(even) td { background: #f8fafc; }
  .data-table .win { color: ${COLORS.emerald}; font-weight: 600; }
  .data-table .loss { color: ${COLORS.rose}; font-weight: 600; }

  /* PROFILE / RANKING / RATING DISPLAY ────────────────────────── */
  .profile-card {
    background: ${COLORS.bgLight};
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 16px;
  }
  .profile-row {
    display: flex; justify-content: space-between;
    padding: 4px 0; font-size: 12px;
    border-bottom: 1px dashed ${COLORS.borderLight};
  }
  .profile-row:last-child { border-bottom: none; }

  .dual-box {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    margin: 8px 0 6px;
  }
  .dual-box > div {
    background: ${COLORS.bgLight};
    border-radius: 6px;
    padding: 10px 14px;
    display: flex; justify-content: space-between; align-items: baseline;
  }
  .dual-box span { font-size: 11px; color: ${COLORS.textMuted}; text-transform: uppercase; letter-spacing: 0.5px; }
  .dual-box strong { font-size: 22px; color: ${COLORS.navy}; }

  .ranking-box {
    background: ${COLORS.bgLight}; border-radius: 8px;
    padding: 12px 16px;
  }
  .ranking-row {
    display: flex; align-items: center; gap: 14px;
    padding: 8px 0; font-size: 13px;
  }
  .ranking-row.current {
    background: white; border-left: 3px solid ${COLORS.cyan};
    border-radius: 4px;
    padding: 10px 14px;
    font-weight: 600;
  }
  .ranking-pos { flex: 0 0 50px; color: ${COLORS.cyan}; }
  .ranking-name { flex: 1; }
  .ranking-pts { font-variant-numeric: tabular-nums; color: ${COLORS.textMuted}; font-weight: normal; font-size: 12px; }

  .rating-display {
    display: flex; align-items: baseline; gap: 22px;
    background: linear-gradient(135deg, ${COLORS.violetLight} 0%, #fce7f3 100%);
    border-radius: 12px; padding: 22px 26px;
    margin: 14px 0 6px;
  }
  .rating-num {
    font-size: 68px; font-weight: 800; color: ${COLORS.violet};
    line-height: 1; letter-spacing: -2px;
  }
  .rating-info { font-size: 12px; color: #6b21a8; }
  .rating-info > div:first-child { font-weight: 600; }

  .ev-display {
    display: flex; align-items: baseline; gap: 14px;
    border-radius: 8px; padding: 12px 18px;
    margin: 12px 0;
  }
  .ev-num {
    font-size: 26px; font-weight: 700; line-height: 1;
  }
  .ev-num.positive { color: ${COLORS.emerald}; }
  .ev-num.negative { color: ${COLORS.rose}; }
  .ev-info { font-size: 12px; color: ${COLORS.textMuted}; }

  /* MOMENTS ────────────────────────────────────────────────────── */
  .moment-card {
    border-radius: 8px; padding: 14px 18px; margin: 14px 0;
  }
  .moment-card.positive {
    background: #ecfdf5; border-left: 3px solid ${COLORS.emerald};
  }
  .moment-card.negative {
    background: #fff1f2; border-left: 3px solid ${COLORS.rose};
  }
  .moment-title { font-size: 12px; font-weight: 700; letter-spacing: 0.5px; }
  .moment-card.positive .moment-title { color: #047857; }
  .moment-card.negative .moment-title { color: #b91c1c; }
  .moment-line { font-size: 13px; margin-top: 4px; color: ${COLORS.textDark}; }
  .moment-score { font-size: 12px; color: ${COLORS.textMuted}; margin-top: 2px; }
  .moment-paragraph { font-size: 12px; line-height: 1.6; margin-top: 10px; }

  /* GLOSSARY ────────────────────────────────────────────────── */
  .glossary { font-size: 12px; }
  .glossary dt {
    font-weight: 600; color: ${COLORS.navy};
    margin-top: 12px;
  }
  .glossary dd {
    margin-left: 0; margin-bottom: 6px; line-height: 1.55;
    color: ${COLORS.textDark};
  }

  /* CLOSING NOTE ───────────────────────────────────────────── */
  .closing-note {
    background: ${COLORS.bgLight};
    border-left: 3px solid ${COLORS.cyan};
    padding: 14px 18px; border-radius: 4px;
    font-size: 12px; line-height: 1.6;
    margin: 24px 0 6px;
  }

  /* COVER SIGNATURE ─────────────────────────────────────────── */
  .cover-signature {
    margin: 28px auto;
    text-align: center;
    color: white;
  }
  .cover-signature-rule {
    width: 220px; height: 1px; background: ${COLORS.cyanLight};
    opacity: 0.7;
    margin: 0 auto 12px;
  }
  .cover-signature-label {
    font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
    opacity: 0.7; margin-bottom: 8px;
  }
  .cover-signature-name {
    font-size: 16px; font-weight: 600; color: white;
  }
  .cover-signature-title {
    font-size: 13px; opacity: 0.85; margin-top: 4px;
  }
  .cover-signature-email {
    font-size: 12px; opacity: 0.7; margin-top: 4px;
    font-family: monospace;
  }

  /* H2H CARDS ─────────────────────────────────────────── */
  .h2h-card {
    border: 1px solid ${COLORS.borderLight};
    border-left: 4px solid ${COLORS.borderLight};
    border-radius: 6px;
    padding: 14px 18px;
    margin: 16px 0;
    background: white;
  }
  .h2h-card.positive { border-left-color: ${COLORS.emerald}; background: #f0fdf4; }
  .h2h-card.negative { border-left-color: ${COLORS.rose}; background: #fff1f2; }
  .h2h-card.balanced { border-left-color: ${COLORS.amber}; background: #fffbeb; }
  .h2h-header {
    display: flex; align-items: baseline; gap: 12px;
    padding-bottom: 8px; border-bottom: 1px solid ${COLORS.borderLight};
    margin-bottom: 8px;
  }
  .h2h-symbol {
    font-size: 18px; flex: 0 0 24px;
  }
  .h2h-card.positive .h2h-symbol { color: ${COLORS.emerald}; }
  .h2h-card.negative .h2h-symbol { color: ${COLORS.rose}; }
  .h2h-card.balanced .h2h-symbol { color: ${COLORS.amber}; }
  .h2h-name {
    flex: 1; font-size: 14px; font-weight: 600; color: ${COLORS.navy};
  }
  .h2h-record {
    font-size: 13px; font-weight: 600; color: ${COLORS.textMuted};
  }
  .h2h-card.positive .h2h-record { color: ${COLORS.emerald}; }
  .h2h-card.negative .h2h-record { color: ${COLORS.rose}; }
  .h2h-table { font-size: 11px; margin: 8px 0; }
  .h2h-narrative {
    margin-top: 10px; padding: 10px 12px;
    background: rgba(255,255,255,0.6); border-radius: 4px;
    font-size: 12px; line-height: 1.55;
  }
  .h2h-summary {
    background: ${COLORS.bgLight};
    border-radius: 6px;
    padding: 14px 18px;
    font-size: 12px;
    line-height: 1.7;
  }
  .h2h-summary > div { margin-bottom: 6px; }

  .data-table tr.positive-saldo td:nth-child(2) { color: ${COLORS.emerald}; font-weight: 600; }
  .data-table tr.negative-saldo td:nth-child(2) { color: ${COLORS.rose}; font-weight: 600; }
  .dates-cell { font-size: 11px; line-height: 1.5; }

  /* SCORE HISTOGRAM ─────────────────────────────────────── */
  .score-hist { margin: 12px 0; }
  .score-row {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 4px; font-size: 12px;
  }
  .score-label {
    flex: 0 0 80px; font-family: monospace; font-weight: 600;
    color: ${COLORS.navy};
  }
  .score-label em { color: ${COLORS.textMuted}; font-style: italic; font-weight: normal; }
  .score-bar { flex: 1; height: 14px; background: #f1f5f9; border-radius: 2px; }
  .score-bar > div { height: 100%; border-radius: 2px; }
  .score-count {
    flex: 0 0 28px; text-align: right; font-weight: 600;
    color: ${COLORS.textMuted};
  }

  /* TEMPORAL TABLE ───────────────────────────────────── */
  .cell-meta {
    font-size: 10px; color: ${COLORS.textMuted};
    display: block;
  }

  /* STAT BOX ───────────────────────────────────────────── */
  .stat-box {
    background: ${COLORS.bgLight};
    border: 1px solid ${COLORS.cyanLight};
    border-radius: 6px;
    padding: 12px 16px;
    font-size: 12px;
    line-height: 1.7;
    margin: 10px 0;
  }
  .stat-box code {
    background: ${COLORS.navy}; color: white;
    padding: 2px 4px; border-radius: 2px;
    font-size: 11px; word-break: break-all;
  }

  /* INSIGHT BLOCKS ─────────────────────────────────────── */
  .insight-block {
    display: flex; gap: 14px;
    background: white; border-radius: 6px;
    padding: 14px 18px;
    margin: 12px 0;
    border-left: 3px solid ${COLORS.borderLight};
    font-size: 12.5px; line-height: 1.6;
  }
  .insight-block.positive {
    background: #ecfdf5; border-left-color: ${COLORS.emerald};
  }
  .insight-block.warning {
    background: #fef3c7; border-left-color: ${COLORS.amber};
  }
  .insight-symbol {
    font-size: 22px; flex: 0 0 28px;
    color: inherit;
    line-height: 1.2;
  }
  .insight-block.positive .insight-symbol { color: ${COLORS.emerald}; }
  .insight-block.warning .insight-symbol { color: #b45309; }
  .insight-content { flex: 1; }
  .insight-content strong:first-child { display: block; margin-bottom: 4px; color: ${COLORS.navy}; }

  /* MOMENT CARD: TIGHT (closer loss) ─────────────────── */
  .moment-card.tight {
    background: #fffbeb; border-left: 3px solid ${COLORS.amber};
  }
  .moment-card.tight .moment-title { color: #b45309; }

  /* SIGNATURE (final, no PDF) ─────────────────────────────── */
  .signature {
    margin: 36px 0 24px;
  }
  .signature-rule {
    height: 1px; background: ${COLORS.navy};
    width: 280px; margin: 0 auto 8px;
  }
  .signature-block {
    text-align: center;
    color: ${COLORS.textDark};
  }
  .signature-label {
    font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
    color: ${COLORS.textMuted}; margin-bottom: 8px;
  }
  .signature-name {
    font-size: 16px; font-weight: 600; color: ${COLORS.navy};
  }
  .signature-title {
    font-size: 12px; margin-top: 2px;
  }
  .signature-place {
    font-size: 11px; color: ${COLORS.textMuted}; margin-top: 6px;
    font-style: italic;
  }
</style>
</head>
<body>
<div class="no-print">📄 Use ⌘+P (Mac) ou Ctrl+P (Win) para salvar este relatório como PDF. O PDF preserva o layout e a identidade visual.</div>
${body}
</body>
</html>`;
}
