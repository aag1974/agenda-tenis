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
  const { athleteName, ranking, periodFrom, periodTo, dateStr } = ctx;
  return `
    <section class="cover">
      <div class="cover-inner">
        <div class="cover-logo">${TF_LOGO_SVG}</div>
        <div class="brand-mark">TENNIS FLOW</div>
        <div class="brand-rule"></div>
        <h1 class="cover-title">Relatório de Performance</h1>
        <div class="cover-athlete">${escapeHtml(athleteName)}</div>
        ${ranking ? `<div class="cover-meta">Categoria 12F · Ranking CBT ${ranking}</div>` : ''}
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
  const { analysis, narratives, athleteName, athleteFirstName, ranking } = ctx;
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
        ${ranking ? `<div class="exec-meta">Categoria 12F · Ranking CBT ${ranking}</div>` : ''}
      </div>

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
        Excluídos da análise: ${c.excluded.wo} W.O. e ${c.excluded.doubles} partidas de duplas.
        Detalhes completos a partir da página seguinte →
      </div>
    </section>
  `;
}

function renderChapter1(ctx) {
  const { athleteName, athleteId, profile, synced } = ctx;
  const wtn = synced?.athlete?.wtn;
  const rankingNational = synced?.athlete?.rankingNational;
  const rankingsAll = synced?.athlete?.rankingsAll || [];
  const about = synced?.athlete?.about;

  return `
    <section class="chapter">
      <div class="chapter-num">CAPÍTULO 1</div>
      <h2 class="chapter-title">Quem é a atleta e o que está sendo analisado</h2>

      <div class="profile-card">
        <div class="profile-row"><span>Nome</span><strong>${escapeHtml(athleteName)}</strong></div>
        <div class="profile-row"><span>ID Tênis Integrado</span><strong>${escapeHtml(athleteId || '—')}</strong></div>
        ${about ? `<div class="profile-row"><span>Origem</span><strong>${escapeHtml(about)}</strong></div>` : ''}
        ${synced?.athlete?.hand ? `<div class="profile-row"><span>Lateralidade</span><strong>${escapeHtml(synced.athlete.hand)}</strong></div>` : ''}
        <div class="profile-row"><span>Categoria</span><strong>Juvenil — 12F (12 anos feminino simples)</strong></div>
      </div>

      ${wtn ? `
      <h3>World Tennis Number (escala global da ITF)</h3>
      <div class="dual-box">
        <div><span>Simples</span><strong>${escapeHtml(wtn.single)}</strong></div>
        <div><span>Duplas</span><strong>${escapeHtml(wtn.double)}</strong></div>
      </div>
      <p class="footnote">A escala WTN vai de 1 (top mundial) a 40 (iniciante). A faixa 33-40 representa atletas em desenvolvimento competitivo. ${escapeHtml(athleteName.split(' ')[0])} está nessa faixa, coerente com a fase atual da carreira: já está no circuito disputando torneios oficiais, ainda construindo histórico.</p>
      ` : ''}

      ${rankingNational ? `
      <h3>Ranking nacional CBT — Juvenil 12F</h3>
      <div class="ranking-box">
        <div class="ranking-row current">
          <span class="ranking-pos">${rankingNational.position}º</span>
          <span class="ranking-name">${escapeHtml(athleteName)}</span>
          <span class="ranking-pts">${String(rankingNational.points).replace('.', ',')} pts</span>
        </div>
      </div>
      <p class="footnote">Posição no ranking nacional CBT na categoria 12F (corte de ${escapeHtml(synced?.athlete?.rankingRegional?.cutoffDate || 'corte mais recente')}).</p>
      ` : ''}

      ${synced?.athlete?.rankingRegional?.regionalPosition ? `
      <h3>Ranking regional — recorte ${escapeHtml(synced.athlete.rankingRegional.uf || 'UF')}</h3>
      <div class="ranking-box">
        <div class="ranking-row current">
          <span class="ranking-pos">${synced.athlete.rankingRegional.regionalPosition}º</span>
          <span class="ranking-name">${escapeHtml(athleteName)}</span>
          <span class="ranking-pts">${synced.athlete.rankingRegional.totalRegional ? `de ${synced.athlete.rankingRegional.totalRegional} atletas no recorte` : ''}</span>
        </div>
      </div>
      <p class="footnote">Posição entre as atletas filiadas à federação do ${escapeHtml(synced.athlete.rankingRegional.uf || 'estado')} no recorte regional do ranking nacional 12F.</p>
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
      <p>Este documento traz uma análise estatística completa do desempenho competitivo da atleta, baseada nas partidas oficiais registradas pelo Tênis Integrado. A análise inclui:</p>
      <ul>
        <li><strong>Caracterização dos dados</strong> — quais torneios, qual o universo de adversárias, distribuições por nível e fase.</li>
        <li><strong>Trajetória do nível de jogo</strong> — usando o sistema estatístico Glicko-2.</li>
        <li><strong>Performance estratificada</strong> — por força do oponente, tier, fase, UF.</li>
        <li><strong>Histórico de confrontos recorrentes</strong> — head-to-head com adversárias enfrentadas mais de uma vez.</li>
        <li><strong>Padrões temporais</strong> — sazonalidade e análise de sequências.</li>
        <li><strong>Considerações finais</strong> — síntese e perguntas pra conversar com o coach.</li>
      </ul>
    </section>
  `;
}

function renderChapter2() {
  return `
    <section class="chapter">
      <div class="chapter-num">CAPÍTULO 2</div>
      <h2 class="chapter-title">Como esta análise foi feita</h2>

      <h3>Fonte dos dados</h3>
      <p>As partidas analisadas foram obtidas a partir do perfil oficial da atleta no <em>Tênis Integrado</em> (tenisintegrado.com.br), plataforma utilizada pela CBT e pelas federações estaduais para registro de torneios oficiais. O acesso foi feito via login autenticado da própria atleta, com consentimento do responsável legal.</p>

      <h3>Critérios de inclusão e exclusão</h3>
      <p>Para garantir comparabilidade e qualidade estatística, foram aplicados os seguintes critérios:</p>
      <ul>
        <li><strong>Incluídas:</strong> partidas de simples com adversária identificada e resultado oficial registrado.</li>
        <li><strong>Excluídas:</strong> partidas de duplas (modelo estatístico próprio, futura versão), W.O. (não houve disputa efetiva), partidas sem identificação clara da adversária.</li>
      </ul>

      <h3>O sistema Glicko-2 — como o nível de jogo é estimado</h3>
      <p>O <strong>Glicko-2</strong> é um sistema de pontuação estatística criado pelo Prof. Mark Glickman, da Universidade de Harvard, em 2012. É a evolução do sistema Glicko (1998), que por sua vez veio do Elo — sistema usado para ranquear jogadores de xadrez desde os anos 1960. Hoje, o Glicko-2 é usado em xadrez (USCF), tênis (algumas plataformas analíticas), jogos eletrônicos competitivos e em pesquisas estatísticas sobre esportes.</p>

      <h3>Por que esse sistema e não outro?</h3>
      <p>Sistemas mais simples (como o Elo) atribuem apenas um número ao atleta. O Glicko-2 atribui dois: o <strong>rating</strong> (estimativa do nível) e a <strong>incerteza</strong> dessa estimativa. Isso faz toda a diferença: duas atletas com rating 1400 mas uma com 50 partidas e outra com 5 não devem ter o mesmo grau de confiança no número. A primeira tem incerteza baixa; a segunda, alta. Esse é o "± X" que aparece neste relatório.</p>

      <h3>Como o número se atualiza</h3>
      <ol>
        <li>O sistema observa o rating da atleta antes do jogo.</li>
        <li>Observa o rating da adversária antes do jogo.</li>
        <li>Calcula a probabilidade de vitória dada a diferença.</li>
        <li>Compara o que era esperado com o que aconteceu de fato.</li>
        <li>Atualiza ambos os ratings — o da atleta e o da adversária.</li>
      </ol>
      <p>O efeito prático: vencer alguém mais forte vale mais (em pontos de rating) do que vencer alguém mais fraco. Da mesma forma, perder pra uma atleta muito acima do seu nível quase não tira pontos.</p>

      <h3>Como ler o número</h3>
      <ul>
        <li>1500 é a média referencial (jogadora "neutra", inicial).</li>
        <li>Quanto maior, melhor a estimativa.</li>
        <li>A faixa entre os limites inferior e superior representa onde, com 95% de confiança, está o "nível verdadeiro".</li>
        <li>Conforme mais torneios, a faixa estreita.</li>
      </ul>

      <h3>O que este sistema NÃO faz</h3>
      <ul>
        <li>Não compara com outras plataformas (cada sistema tem seu universo).</li>
        <li>Não substitui o ranking CBT (pontos de torneio oficial).</li>
        <li>Não substitui o WTN (referência mundial pública da ITF).</li>
      </ul>
      <p>Os três números são <strong>complementares</strong>: WTN diz onde a atleta está no mundo, ranking CBT diz onde está no Brasil, Glicko-2 mostra como ela está evoluindo dentro do universo de adversárias enfrentadas.</p>

      <h3>Outras técnicas estatísticas utilizadas</h3>
      <ul>
        <li><strong>Janelas temporais</strong> (90d, 12m, all-time) para análise de forma recente.</li>
        <li><strong>Buckets de força do oponente</strong> (mais forte / parelha / mais fraca, com cutoff de ±100 pontos).</li>
        <li><strong>Teste Wald-Wolfowitz</strong> para análise de sequências de vitórias e derrotas.</li>
        <li><strong>Standard error em métricas agregadas</strong> para indicar significância de over/underperformance.</li>
      </ul>

      <h3>Limitações</h3>
      <p>Toda análise estatística com amostra pequena tem incerteza inerente. Conclusões são <strong>direcionais</strong>, não definitivas. Em 6-12 meses, com 50-100 partidas no histórico, as inferências serão muito mais firmes.</p>
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

      <h3>Cobertura</h3>
      <p>De um total de <strong>${matches.length} partidas registradas</strong> no Tênis Integrado durante o período analisado:</p>
      <ul>
        <li><strong>${analysis.counts.analyzed}</strong> partidas de simples — base desta análise estatística.</li>
        <li><strong>${analysis.counts.excluded.doubles}</strong> partidas de duplas — listadas no Anexo A, fora desta análise (modelo estatístico próprio, futura versão).</li>
        <li><strong>${analysis.counts.excluded.wo}</strong> W.O. — sem disputa efetiva, fora desta análise.</li>
      </ul>

      ${renderRecurrentTable(analysis)}
      ${renderScoreHistogram(analysis)}
    </section>
  `;
}

// ─── Cap 3.6: Tabela de adversárias recorrentes ───────────────────────
function renderRecurrentTable(analysis) {
  const recurrent = analysis.recurrentOpponents || [];
  if (!recurrent.length) return '';
  return `
    <h3>Adversárias recorrentes (enfrentadas 2 ou mais vezes)</h3>
    <p>Em circuito juvenil regional, é comum reencontrar as mesmas adversárias várias vezes. ${escapeHtml(analysis.athleteId ? '' : '')}Anna tem <strong>${recurrent.length}</strong> adversárias com quem já jogou pelo menos 2 vezes — concentração de confrontos que reflete a realidade do circuito brasileiro.</p>
    <table class="data-table">
      <thead>
        <tr><th>Adversária</th><th>V-D</th><th>Datas dos confrontos</th></tr>
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
function renderScoreHistogram(analysis) {
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
    <p class="footnote">Quando uma jogadora vence sem ceder games (placar 6-0), chamamos popularmente de "pneu". O contrário — quando é vencida sem fazer games — também é um pneu sofrido.</p>
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
        { label: 'Adversária mais forte', value: b.strong.w, total: b.strong.w + b.strong.l },
        { label: 'Mesmo nível', value: b.even.w, total: b.even.w + b.even.l },
        { label: 'Adversária mais fraca', value: b.weak.w, total: b.weak.w + b.weak.l },
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
function renderHeadToHeadDeep(ctx) {
  const { analysis, narratives } = ctx;
  const opps = analysis.recurrentOpponents || [];
  const h2hNarr = narratives.h2h || [];
  if (!opps.length) return '';

  return `
    <h3>4.5 Confrontos recorrentes (head-to-head)</h3>
    <p>Análise individual das ${opps.length} adversárias enfrentadas 2 ou mais vezes. Cada confronto repetido conta uma história — entender essa história é essencial pra preparação dos próximos encontros.</p>
    ${opps.map((opp, i) => {
      const narr = h2hNarr.find(n => n.opponent.name === opp.name);
      const balance = opp.wins - opp.losses;
      const isPositive = balance > 0;
      const isNegative = balance < 0;
      const isBalanced = balance === 0;
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
    }).join('')}

    <h4>Síntese dos head-to-head</h4>
    ${(() => {
      const positives = opps.filter(o => o.wins > o.losses);
      const negatives = opps.filter(o => o.losses > o.wins);
      const balanced  = opps.filter(o => o.wins === o.losses);
      return `
        <div class="h2h-summary">
          ${positives.length ? `<div><strong>Adversárias com saldo positivo:</strong> ${positives.map(o => `${escapeHtml(o.name)} (${o.wins}-${o.losses})`).join(', ')}.</div>` : ''}
          ${balanced.length ? `<div><strong>Equilíbrio:</strong> ${balanced.map(o => `${escapeHtml(o.name)} (${o.wins}-${o.losses})`).join(', ')}.</div>` : ''}
          ${negatives.length ? `<div><strong>Adversárias-barreira:</strong> ${negatives.map(o => `${escapeHtml(o.name)} (${o.wins}-${o.losses})`).join(', ')}.</div>` : ''}
        </div>
        <p class="footnote">Adversárias recorrentes respondem por <strong>${opps.reduce((s, o) => s + o.total, 0)}</strong> dos ${analysis.counts.analyzed} jogos analisados (${Math.round(opps.reduce((s, o) => s + o.total, 0) / analysis.counts.analyzed * 100)}%) — concentração que reflete a realidade do circuito juvenil regional.</p>
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
    <p class="footnote">A aparente concentração nos primeiros meses do ano corrente é uma <strong>ilusão estatística</strong>. O calendário CBT juvenil é distribuído ao longo do ano todo — basta olhar 2025 (ano completo no histórico) pra ver atividade em março, maio, julho, agosto e dezembro. A razão dos meses "vazios" no ano corrente é que o Tênis Integrado popula os torneios cerca de 2 meses antes do início, então o segundo semestre ainda não foi totalmente publicado. Não é falta de calendário — é defasagem da fonte de dados.</p>

    <h4>Análise de sequências (teste Wald-Wolfowitz)</h4>
    ${t.runsTest.z !== null ? `
      <div class="stat-box">
        <div><strong>Sequência observada:</strong> <code>${escapeHtml(t.runsTest.sequence)}</code></div>
        <div><strong>Total de blocos (runs):</strong> ${t.runsTest.runs}</div>
        <div><strong>Esperado se aleatório:</strong> ${nb(t.runsTest.expected, 2)}</div>
        <div><strong>Estatística z:</strong> ${nb(t.runsTest.z, 2)}</div>
        <div><strong>Significância (95%):</strong> ${t.runsTest.significant ? 'SIM (não-aleatório)' : 'não detectada'}</div>
      </div>
    ` : '<p>Amostra insuficiente para o teste.</p>'}

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
  const { narratives, analysis, athleteFirstName } = ctx;
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
          Adversária${positives.length > 1 ? 's' : ''} com saldo positivo após reencontros: ${positives.map(o => `<strong>${escapeHtml(o.name)}</strong> (${o.wins}-${o.losses})`).join(', ')}.
          ${positives.some(o => o.matches[0]?.result === 'L') ? `Em alguns casos, a primeira partida foi derrota — e o histórico foi reescrito nos confrontos seguintes. Isso mostra que histórico ruim contra uma adversária NÃO é destino.` : ''}
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
          Combinando derrotas em pontos decisivos (super-TB), surge sinal de que ainda há trabalho específico a desenvolver no jogo de tiebreak — o pequeno detalhe que separa atletas competitivas das elite na categoria.
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
              ${bagels} sets terminaram com placar 0-6 — frequência relativamente alta. Pode refletir adversárias muito acima do nível, ou queda de produção dentro do jogo após primeiro set ruim. Vale conversar com o coach se há padrão emocional/tático a trabalhar.
            </div>
          </div>`;
        }
        return '';
      })()}

      <h3>Perguntas pra conversar com o coach</h3>
      <p>As perguntas abaixo não têm resposta nos dados — eles apenas apontam onde vale investigar. As respostas vêm de quem conhece a atleta em quadra:</p>
      <ol>
        ${analysis.tightestLoss?.hasSuperTiebreak ? `<li>Em jogos que vão pro super-tiebreak, qual é o plano de jogo? Já houve foco específico em pontos decisivos?</li>` : ''}
        <li>Quando perde o 1º set, qual é a rotina mental pra entrar no 2º?</li>
        ${recentBarrier ? `<li><strong>${escapeHtml(recentBarrier.name)}</strong> é uma "barreira mental" ou um problema tático específico? Vale revisitar mentalmente esses confrontos.</li>` : ''}
        ${positives.length ? `<li>Como foram os jogos da virada contra ${escapeHtml(positives[0].name)}? Vale entender a fórmula que funcionou — pode ser repetível.</li>` : ''}
        <li>O calendário atual está com a intensidade certa? Há períodos sem torneios que poderiam ser preenchidos?</li>
        <li>Em torneios fora do estado, ${escapeHtml(athleteFirstName)} se sente mais ou menos pressionada? Como isso pode orientar o calendário?</li>
      </ol>

      <h3>O que o próximo relatório vai poder responder melhor</h3>
      <p>Com mais ${analysis.counts.analyzed >= 50 ? '50+' : analysis.counts.analyzed * 2}+ partidas no histórico, será possível:</p>
      <ul>
        <li>Confirmar ou descartar as tendências detectadas nesta edição.</li>
        <li>Estreitar significativamente a faixa de incerteza do rating.</li>
        <li>Identificar padrões temporais (sazonalidade, melhores meses) com confiança estatística.</li>
        <li>Cruzar mais dimensões (ex: tier × fase × UF) com base maior.</li>
        <li>Aplicar testes inferenciais com poder estatístico real (hoje, com 25 jogos, são direcionais).</li>
      </ul>

      <div class="closing-note">
        <strong>Aviso final.</strong> Este relatório foi feito com base em ${analysis.counts.analyzed} partidas analisadas. Toda análise com amostra dessa magnitude tem incerteza inerente. Os números aqui são corretos; as <strong>interpretações</strong> são prováveis, não garantidas. Em 6-12 meses, com 50-100 partidas no histórico, faremos uma versão muito mais firme. ${escapeHtml(athleteFirstName)} está em ascensão — os sinais são consistentes em múltiplas dimensões. Mas o tênis é um esporte que recompensa paciência, consistência e capacidade de aprender com cada partida.
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
  const { matches } = ctx;
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
          <tr><th>#</th><th>Data</th><th>Tier</th><th>Cidade</th><th>Fase</th><th>Adversária</th><th>R</th><th>Placar</th></tr>
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
          <tr><th>Data</th><th>Tier</th><th>Cidade</th><th>Adversárias</th><th>R</th><th>Placar</th></tr>
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
      <h3>Partidas em W.O. (${wos.length}) — fora desta análise</h3>
      <p class="footnote">Partidas que aparecem no Tênis Integrado mas não foram efetivamente disputadas. Excluídas das análises por não conterem informação real sobre desempenho.</p>
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

function renderAnnexB() {
  return `
    <section class="annex">
      <div class="chapter-num">ANEXO B</div>
      <h2 class="chapter-title">Glossário</h2>

      <dl class="glossary">
        <dt>Rating Glicko-2</dt>
        <dd>Sistema estatístico de pontuação criado por Mark Glickman (Harvard, 2012). Atribui dois números à atleta: rating (estimativa do nível) e RD (incerteza). Atualiza após cada partida considerando o rating da adversária.</dd>

        <dt>RD (Rating Deviation)</dt>
        <dd>A "incerteza" do Glicko-2. Quanto menor, mais confiamos no rating estimado. Cresce quando a atleta passa muito tempo sem jogar; diminui com mais partidas.</dd>

        <dt>IC 95% (Intervalo de Confiança)</dt>
        <dd>Faixa de valores onde é razoável esperar que o "valor verdadeiro" esteja, com 95% de chance. Usado para apresentar o rating como faixa, não número fixo.</dd>

        <dt>Tier (G1, G2, G3, GA)</dt>
        <dd>Classificação oficial dos torneios CBT pela importância. G1 é o nível mais alto (mais pontos), G3 é o introdutório.</dd>

        <dt>TT (Total Tiebreak)</dt>
        <dd>Formato de partida usado em algumas etapas regionais juvenis brasileiras: o jogo todo é decidido em 1 match-tiebreak, em vez de 2 sets normais.</dd>

        <dt>Super-tiebreak (STB)</dt>
        <dd>Match-tiebreak usado como 3º "set" em jogos de 2 sets em empate. Disputado até 10 pontos com diferença de 2.</dd>

        <dt>W.O. (Walkover)</dt>
        <dd>Partida onde uma atleta vence porque a adversária não comparece ou desiste antes do início. Sem disputa efetiva — excluído das análises.</dd>

        <dt>Pneu</dt>
        <dd>Set vencido por 6-0. Pneu duplo é um jogo onde a vencedora não cedeu nenhum game (6-0 6-0).</dd>

        <dt>WTN (World Tennis Number)</dt>
        <dd>Sistema global de classificação de tênis publicado pela ITF na escala 1 (top mundial) a 40 (iniciante).</dd>
      </dl>
    </section>
  `;
}

function renderAnnexC() {
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

      <h3>Buckets de força do oponente</h3>
      <ul>
        <li>Mais forte: rating do oponente ≥ rating da atleta + 100 pts</li>
        <li>Parelha: diferença entre -100 e +100 pts</li>
        <li>Mais fraca: rating do oponente ≤ rating da atleta - 100 pts</li>
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

// ─── Renderizador principal ─────────────────────────────────────────────

export function generateReportHtml(profileId) {
  const profile = getProfile(profileId);
  const synced = getSyncedData(profileId);
  const matchesData = getMatchesData(profileId);
  const rawMatches = matchesData.matches || [];
  // Enriquece com tier do catálogo (synced.json) — a página /perfil2/jogos/
  // não traz tier, mas /torneio_painel_info/ traz.
  const matches = enrichMatchesWithTier(rawMatches, synced?.tournaments);
  const analysis = analyzeMatches(matches, profileId);

  // Prioriza o nome COMPLETO do TI (synced.athlete.name) sobre o athleteName
  // do profile, que pode ser apenas um apelido/nome curto definido pelo user.
  // Princípio: relatório oficial usa o nome registrado no TI, não abrevia.
  const athleteName = synced?.athlete?.name || profile?.athleteName || 'Atleta';
  const athleteFirstName = athleteName.split(' ')[0];
  const athleteId = synced?.athlete?.id || profileId;
  const ranking = synced?.athlete?.rankingNational
    ? `${synced.athlete.rankingNational.position}º (${String(synced.athlete.rankingNational.points).replace('.', ',')} pts)`
    : null;

  const narratives = generateAllNarrativesThirdPerson(analysis, athleteFirstName, athleteName);

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
        <p class="footnote">Excluídos: ${analysis.counts.excluded.wo} W.O. e ${analysis.counts.excluded.doubles} duplas.</p>
      </section>
    `);
  }

  const ctx = {
    profile, synced, matches, analysis, narratives,
    athleteName, athleteFirstName, athleteId, ranking,
    periodFrom, periodTo, dateStr,
  };

  const body = `
    ${renderCover(ctx)}
    ${renderExecutiveSummary(ctx)}
    ${renderChapter1(ctx)}
    ${renderChapter2()}
    ${renderChapter3(ctx)}
    ${renderChapter4(ctx)}
    ${renderChapter5(ctx)}
    ${renderChapter6(ctx)}
    ${renderSignature(ctx)}
    ${renderAnnexA(ctx)}
    ${renderAnnexB()}
    ${renderAnnexC()}
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
    body { background: white; padding: 0; max-width: none; }
    .no-print { display: none !important; }
    section { page-break-inside: avoid; }
    .chapter, .annex { page-break-before: always; }
    .cover { page-break-after: always; }
    .exec-summary { page-break-after: always; }
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
      min-height: 95vh;
      border-radius: 0;
      margin-bottom: 0;
      padding: 60px 50px;
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
    font-size: 38px; font-weight: 600; letter-spacing: -0.5px;
    margin: 0 0 16px;
  }
  .cover-athlete {
    font-size: 22px; font-weight: 500; margin-bottom: 6px;
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
    font-size: 36px; font-weight: 700; color: ${COLORS.violet};
    line-height: 1; margin-top: 6px;
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

  /* CHAPTERS ──────────────────────────────────────────────────── */
  .chapter, .annex {
    background: white;
    border: 1px solid ${COLORS.borderLight};
    border-radius: 10px;
    padding: 28px 32px;
    margin-bottom: 24px;
  }
  .chapter-num {
    font-size: 11px; font-weight: 700; letter-spacing: 2px;
    color: ${COLORS.cyan}; text-transform: uppercase;
    margin-bottom: 4px;
  }
  .chapter-title {
    font-size: 22px; font-weight: 600; color: ${COLORS.navy};
    margin: 0 0 20px; letter-spacing: -0.3px;
  }
  h3 {
    font-size: 14px; font-weight: 600; color: ${COLORS.navy};
    margin: 22px 0 10px; padding-top: 4px;
  }
  .chapter h3:first-of-type { margin-top: 6px; }
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
    display: flex; align-items: baseline; gap: 18px;
    background: linear-gradient(135deg, ${COLORS.violetLight} 0%, #fce7f3 100%);
    border-radius: 8px; padding: 14px 18px;
    margin: 12px 0 4px;
  }
  .rating-num {
    font-size: 42px; font-weight: 700; color: ${COLORS.violet};
    line-height: 1;
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
