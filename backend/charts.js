// SVG charts inline pro relatório PDF — sem dependência de runtime.
// Princípio: tudo fica num atributo SVG estático, renderizável pelo
// motor do browser quando o usuário faz Cmd+P (print). Sem Canvas, sem
// chart.js, sem chamadas externas.

const COLORS = {
  navy: '#0e3a4d',
  cyan: '#00a3e0',
  cyanLight: '#7dd3fc',
  violet: '#7c3aed',
  violetLight: '#ede9fe',
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  textDark: '#0f172a',
  textMuted: '#64748b',
  borderLight: '#e2e8f0',
  bgLight: '#f8fafc',
};

// ─── Radar chart (5 eixos) ──────────────────────────────────────────────
// data: [{ label, value, max=100 }]
// Renderiza polígono violeta semi-transparente sobre grid de pentágonos
// concêntricos. Usado pra DNA visual.
export function radarChart(data, opts = {}) {
  const { width = 380, height = 320, padding = 60 } = opts;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - padding;
  const n = data.length;
  if (n < 3) return '';

  // Pontos do polígono — começa no topo (12h)
  const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const point = (i, r) => ({
    x: cx + r * Math.cos(angle(i)),
    y: cy + r * Math.sin(angle(i)),
  });

  // Grid: círculos concêntricos a 25/50/75/100%
  const gridLevels = [0.25, 0.5, 0.75, 1];
  const gridPolys = gridLevels.map(level => {
    const pts = data.map((_, i) => point(i, radius * level));
    return `M ${pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} Z`;
  });

  // Eixos radiais (linhas saindo do centro)
  const axes = data.map((_, i) => {
    const p = point(i, radius);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${COLORS.borderLight}" stroke-width="1"/>`;
  }).join('');

  // Polígono dos valores
  const dataPoints = data.map((d, i) => {
    const v = Math.max(0, Math.min(d.value || 0, d.max || 100));
    const ratio = v / (d.max || 100);
    return point(i, radius * ratio);
  });
  const dataPath = `M ${dataPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} Z`;
  const dataDots = dataPoints.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${COLORS.violet}"/>`).join('');

  // Labels nos vértices
  const labels = data.map((d, i) => {
    const p = point(i, radius + 22);
    const anchor = Math.abs(p.x - cx) < 5 ? 'middle' : (p.x > cx ? 'start' : 'end');
    const dy = Math.abs(p.y - cy) < 5 ? 0 : (p.y > cy ? 12 : 0);
    return `
      <text x="${p.x.toFixed(1)}" y="${(p.y + dy).toFixed(1)}" text-anchor="${anchor}" font-size="10" font-weight="600" fill="${COLORS.navy}">
        ${escapeSvg(d.label)}
      </text>
      <text x="${p.x.toFixed(1)}" y="${(p.y + dy + 12).toFixed(1)}" text-anchor="${anchor}" font-size="11" font-weight="700" fill="${COLORS.violet}">
        ${Math.round(d.value || 0)}
      </text>
    `;
  }).join('');

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridPolys.map((d, i) => `<path d="${d}" fill="none" stroke="${COLORS.borderLight}" stroke-width="${i === gridLevels.length - 1 ? 1.2 : 0.8}" stroke-dasharray="${i === gridLevels.length - 1 ? '' : '2 2'}"/>`).join('')}
      ${axes}
      <path d="${dataPath}" fill="${COLORS.violet}" fill-opacity="0.2" stroke="${COLORS.violet}" stroke-width="2" stroke-linejoin="round"/>
      ${dataDots}
      ${labels}
    </svg>
  `;
}

// ─── Heatmap calendário (mês × ano) ─────────────────────────────────────
// data: array de matches com m.year (number) e m.endDate (DD/MM/YYYY) e
// m.result ('W'/'L'). Renderiza grid 12 col × N anos com cor pelo
// aproveitamento do mês. Quem tem zero jogos no mês fica em cinza neutro.
export function calendarHeatmap(matches, opts = {}) {
  const { width = 720, cellSize = 38 } = opts;
  if (!matches?.length) return '';

  // Agrega por (year, month-1)
  const buckets = new Map(); // "y-m" → {w, l}
  let minYear = Infinity, maxYear = -Infinity;
  for (const m of matches) {
    if (!m.endDate) continue;
    const [, mm, yyyy] = m.endDate.split('/').map(Number);
    if (!yyyy || !mm) continue;
    minYear = Math.min(minYear, yyyy);
    maxYear = Math.max(maxYear, yyyy);
    const key = `${yyyy}-${mm}`;
    if (!buckets.has(key)) buckets.set(key, { w: 0, l: 0 });
    const b = buckets.get(key);
    if (m.result === 'W') b.w++;
    else if (m.result === 'L') b.l++;
  }
  if (minYear === Infinity) return '';

  const years = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);
  const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const labelWidth = 44;
  const headerH = 24;
  const totalCellW = (width - labelWidth) / 12;
  const cw = Math.min(totalCellW, cellSize);
  const ch = cellSize;
  const gridW = labelWidth + 12 * cw;
  const gridH = headerH + years.length * ch + 8;

  // Mapeia win-rate → cor: <30 vermelho, 30-50 amber, 50-70 amber claro, 70+ verde
  const cellColor = (b) => {
    if (!b || (b.w + b.l) === 0) return '#f1f5f9';
    const total = b.w + b.l;
    if (total < 1) return '#f1f5f9';
    const wr = b.w / total;
    if (wr >= 0.75) return '#10b981';
    if (wr >= 0.55) return '#86efac';
    if (wr >= 0.40) return '#fcd34d';
    if (wr >= 0.20) return '#fb923c';
    return '#f43f5e';
  };

  // Cabeçalho de meses
  const header = monthLabels.map((m, i) => `
    <text x="${labelWidth + i * cw + cw / 2}" y="${headerH - 8}" text-anchor="middle" font-size="10" fill="${COLORS.textMuted}" font-weight="600">${m}</text>
  `).join('');

  // Linhas (uma por ano)
  const rows = years.map((y, rowIdx) => {
    const rowY = headerH + rowIdx * ch;
    const yearLabel = `<text x="${labelWidth - 8}" y="${rowY + ch / 2 + 4}" text-anchor="end" font-size="10" fill="${COLORS.navy}" font-weight="600">${y}</text>`;
    const cells = monthLabels.map((_, mi) => {
      const key = `${y}-${mi + 1}`;
      const b = buckets.get(key);
      const color = cellColor(b);
      const total = b ? b.w + b.l : 0;
      const x = labelWidth + mi * cw;
      const cell = `<rect x="${x + 1}" y="${rowY + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${color}" stroke="white" stroke-width="0.5"/>`;
      const label = total > 0
        ? `<text x="${x + cw / 2}" y="${rowY + ch / 2 + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="${(b.w + b.l > 0 && b.w / (b.w + b.l) >= 0.55) ? COLORS.navy : '#fff'}">${b.w}-${b.l}</text>`
        : '';
      return cell + label;
    }).join('');
    return yearLabel + cells;
  }).join('');

  // Legenda
  const legendY = gridH - 8;
  const legend = `
    <text x="${labelWidth}" y="${legendY}" font-size="9" fill="${COLORS.textMuted}">
      Cor por aproveitamento do mês: vermelho ≤20%, laranja 20–40%, amarelo 40–55%, verde claro 55–75%, verde 75%+. Texto: V-D.
    </text>
  `;

  return `
    <svg width="${gridW}" height="${gridH + 14}" viewBox="0 0 ${gridW} ${gridH + 14}" xmlns="http://www.w3.org/2000/svg">
      ${header}
      ${rows}
      ${legend}
    </svg>
  `;
}

function escapeSvg(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
