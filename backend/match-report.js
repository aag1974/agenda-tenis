// Gerador de HTML estático do relatório do match. Snapshot congelado no
// momento da geração — não muda mais. Vive pra sempre no /match-report/<id>.

import { computeMatchScore } from './match-score.js';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Stats consolidados padrão iOnCourt (mesma lógica do frontend, replicada server-side)
function computeStats(m) {
  const init = () => ({
    aces: 0, doubleFaults: 0, serviceWinners: 0,
    returnWinners: 0, returnErrors: 0, returnsInPlay: 0,
    winners: 0, forcedErrors: 0, unforcedErrors: 0,
    pointsWon: 0,
    firstServeIn: 0, firstServeAttempted: 0,
    pointsWonOn1stServe: 0, pointsPlayedOn1stServe: 0,
    pointsWonOn2ndServe: 0, pointsPlayedOn2ndServe: 0,
  });
  const s = { a: init(), o: init() };
  let cur = { firstServeIn: true, server: null };
  for (const p of (m.points || [])) {
    if (cur.server == null) cur.server = p.server;
    if (p.winner == null) {
      if (p.stat === 'serve_fault') cur.firstServeIn = false;
      continue;
    }
    s[p.winner].pointsWon++;
    const server = cur.server || p.server;
    const receiver = server === 'a' ? 'o' : 'a';
    s[server].firstServeAttempted++;
    if (cur.firstServeIn) s[server].firstServeIn++;
    if (cur.firstServeIn) {
      s[server].pointsPlayedOn1stServe++;
      if (p.winner === server) s[server].pointsWonOn1stServe++;
    } else {
      s[server].pointsPlayedOn2ndServe++;
      if (p.winner === server) s[server].pointsWonOn2ndServe++;
    }
    switch (p.stat) {
      case 'ace':            s[server].aces++; break;
      case 'service_winner': s[server].serviceWinners++; break;
      case 'double_fault':   s[server].doubleFaults++; break;
      case 'return_winner':  s[receiver].returnWinners++; break;
      case 'return_error':   s[receiver].returnErrors++; break;
      case 'winner':         s[p.winner].winners++; break;
      case 'forced_error': {
        const loser = p.winner === 'a' ? 'o' : 'a';
        s[loser].forcedErrors++;
        break;
      }
      case 'unforced_error': {
        const loser = p.winner === 'a' ? 'o' : 'a';
        s[loser].unforcedErrors++;
        break;
      }
    }
    cur = { firstServeIn: true, server: null };
  }
  for (const p of (m.points || [])) {
    if (p.stat === 'return_in_play') {
      const receiver = p.server === 'a' ? 'o' : 'a';
      s[receiver].returnsInPlay++;
    }
  }
  return s;
}

function pctText(won, total) {
  if (!total) return '—';
  return `${won}/${total} (${Math.round(100 * won / total)}%)`;
}

function renderScoreTable(m) {
  const sets = (m.setsHistory || []).map((s, i) => ({
    n: i + 1,
    a: s.a, o: s.o,
    tb: s.tiebreak ? `${s.tiebreak.a}-${s.tiebreak.o}` : null,
  }));
  const aWon = sets.filter(s => s.a > s.o).length;
  const oWon = sets.filter(s => s.o > s.a).length;
  const annaWin = m.winner === 'a';
  const oppWin  = m.winner === 'o';

  const cell = (val, current) => `<td style="padding:8px 10px; text-align:center; font-size:18px; font-weight:bold; ${current ? 'color:#facc15' : ''}">${val}</td>`;

  return `
    <table style="width:100%; border-collapse:collapse; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; overflow:hidden; margin: 16px 0;">
      <thead>
        <tr style="background:rgba(255,255,255,0.05);">
          <th style="text-align:left; padding:8px 12px; font-size:10px; text-transform:uppercase; color:rgba(255,255,255,0.5); font-weight:bold;">Atleta</th>
          ${sets.map(s => `<th style="text-align:center; padding:8px; font-size:10px; color:rgba(255,255,255,0.5); font-weight:bold;">${s.n}</th>`).join('')}
          <th style="text-align:center; padding:8px; font-size:10px; color:rgba(255,255,255,0.5); font-weight:bold;">Sets</th>
        </tr>
      </thead>
      <tbody>
        <tr style="${oppWin ? 'opacity:0.5;' : ''}">
          <td style="padding:10px 12px; font-weight:${annaWin ? '900' : '600'};">
            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#0891b2; margin-right:6px;"></span>
            ${escapeHtml(m.athleteName)}${annaWin ? ' 🏆' : ''}
          </td>
          ${sets.map(s => cell(s.a)).join('')}
          <td style="padding:8px; text-align:center; font-size:20px; font-weight:900;">${aWon}</td>
        </tr>
        <tr style="${annaWin ? 'opacity:0.5;' : ''}">
          <td style="padding:10px 12px; font-weight:${oppWin ? '900' : '600'};">
            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#e11d48; margin-right:6px;"></span>
            ${escapeHtml(m.opponentName)}${oppWin ? ' 🏆' : ''}
          </td>
          ${sets.map(s => cell(s.o)).join('')}
          <td style="padding:8px; text-align:center; font-size:20px; font-weight:900;">${oWon}</td>
        </tr>
      </tbody>
    </table>`;
}

function renderStatsTable(m) {
  const stats = computeStats(m);
  const sa = stats.a, so = stats.o;
  const cs = computeMatchScore(m);
  const rows = [];
  if (cs.a.score != null || cs.o.score != null) {
    rows.push({
      label: 'Nota técnica · 0-10',
      a: cs.a.score != null ? cs.a.score.toFixed(1) : '—',
      o: cs.o.score != null ? cs.o.score.toFixed(1) : '—',
      highlight: true,
    });
  }
  rows.push(
    { label: 'Aces', a: sa.aces, o: so.aces },
    { label: 'Double Faults', a: sa.doubleFaults, o: so.doubleFaults },
    { label: 'Service Winners', a: sa.serviceWinners, o: so.serviceWinners },
    { label: '1st Serve %', a: pctText(sa.firstServeIn, sa.firstServeAttempted), o: pctText(so.firstServeIn, so.firstServeAttempted) },
    { label: '1st Serve Pts Won', a: pctText(sa.pointsWonOn1stServe, sa.pointsPlayedOn1stServe), o: pctText(so.pointsWonOn1stServe, so.pointsPlayedOn1stServe) },
    { label: '2nd Serve Pts Won', a: pctText(sa.pointsWonOn2ndServe, sa.pointsPlayedOn2ndServe), o: pctText(so.pointsWonOn2ndServe, so.pointsPlayedOn2ndServe) },
    { label: 'Return Winners', a: sa.returnWinners, o: so.returnWinners },
    { label: 'Return Errors', a: sa.returnErrors, o: so.returnErrors },
    { label: 'Winners (rally)', a: sa.winners, o: so.winners },
    { label: 'Forced Errors', a: sa.forcedErrors, o: so.forcedErrors },
    { label: 'Unforced Errors', a: sa.unforcedErrors, o: so.unforcedErrors },
    { label: 'Total Pts Won', a: sa.pointsWon, o: so.pointsWon },
  );
  return `
    <table style="width:100%; border-collapse:collapse; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; overflow:hidden; font-size:13px;">
      <thead>
        <tr style="background:rgba(255,255,255,0.05);">
          <th style="text-align:center; padding:8px; font-size:11px; font-weight:bold; color:#67e8f9;">Anna</th>
          <th style="text-align:center; padding:8px; font-size:10px; text-transform:uppercase; color:rgba(255,255,255,0.5);">Métrica</th>
          <th style="text-align:center; padding:8px; font-size:11px; font-weight:bold; color:#fda4af;">Opponent</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr style="border-top:1px solid rgba(255,255,255,0.08); ${r.highlight ? 'background:rgba(255,255,255,0.04);' : ''}">
            <td style="text-align:center; padding:6px 8px; font-weight:${r.highlight ? '900' : '600'}; color:${r.highlight ? '#67e8f9' : 'white'}; ${r.highlight ? 'font-size:18px;' : ''}">${r.a}</td>
            <td style="text-align:center; padding:6px 8px; color:rgba(255,255,255,0.7); ${r.highlight ? 'font-size:10px; text-transform:uppercase; letter-spacing:0.05em; font-weight:bold;' : ''}">${r.label}</td>
            <td style="text-align:center; padding:6px 8px; font-weight:${r.highlight ? '900' : '600'}; color:${r.highlight ? '#fda4af' : 'white'}; ${r.highlight ? 'font-size:18px;' : ''}">${r.o}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderMomentum(m) {
  // Cada ponto fechado vira barra ±1 (azul cima = Anna, rosa baixo = adv)
  const closed = (m.points || []).filter(p => p.winner != null);
  if (closed.length === 0) return '';
  const w = Math.max(600, closed.length * 14);
  const bars = closed.map((p, i) => {
    const x = 10 + i * 14;
    const top = p.winner === 'a' ? 15 : 65;
    const color = p.winner === 'a' ? '#0891b2' : '#e11d48';
    return `<line x1="${x}" y1="40" x2="${x}" y2="${top}" stroke="${color}" stroke-width="3" />`;
  }).join('');
  return `
    <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:12px; margin:16px 0; overflow-x:auto;">
      <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:rgba(165,243,252,0.8); font-weight:bold; margin-bottom:8px;">Momentum · cada barra = 1 ponto</div>
      <svg viewBox="0 0 ${w} 80" style="width:${w}px; height:80px; display:block;" preserveAspectRatio="xMinYMid meet">
        <line x1="0" y1="40" x2="${w}" y2="40" stroke="rgba(255,255,255,0.35)" stroke-width="1" />
        ${bars}
      </svg>
    </div>`;
}

function renderNotes(m) {
  const notes = (m.notes || []);
  if (notes.length === 0) return '';
  const tagMeta = {
    tecnico: { label: 'Técnico', color: '#0e7490' },
    tatico: { label: 'Tático', color: '#7c3aed' },
    fisico: { label: 'Físico', color: '#ea580c' },
    emocional: { label: 'Emocional', color: '#be123c' },
  };
  return `
    <div style="margin:16px 0;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:rgba(165,243,252,0.8); font-weight:bold; margin-bottom:8px;">📝 Notas de performance</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${notes.map(n => {
          const meta = n.tag && tagMeta[n.tag];
          const scoreText = n.score ? [
            (n.score.sets || []).map(s => `${s.a}-${s.o}`).join(' · '),
            n.score.currentSetGames ? `${n.score.currentSetGames.a}-${n.score.currentSetGames.o}` : '',
            n.score.currentGame || '',
          ].filter(Boolean).join(' · ') : '';
          return `
            <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:12px;">
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:4px;">
                <span style="font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:0.05em; color:#67e8f9;">${escapeHtml(scoreText)}</span>
                ${meta ? `<span style="font-size:10px; font-weight:bold; color:white; background:${meta.color}; padding:2px 8px; border-radius:9999px;">${meta.label}</span>` : ''}
              </div>
              <div style="font-size:14px; color:rgba(255,255,255,0.9);">${escapeHtml(n.text)}</div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

export function generateMatchReportHtml(m) {
  const finalScore = (m.setsHistory || []).map(s => {
    let txt = `${s.a}-${s.o}`;
    if (s.tiebreak) txt += `(${Math.min(s.tiebreak.a, s.tiebreak.o)})`;
    return txt;
  }).join(' · ');
  const winnerName = m.winner === 'a' ? m.athleteName : (m.winner === 'o' ? m.opponentName : null);
  const subtitleParts = [m.tournamentName, m.round, m.category].filter(Boolean);
  const generatedAt = fmtDate(new Date().toISOString());

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório do match — ${escapeHtml(m.athleteName)} vs ${escapeHtml(m.opponentName)}</title>
  <style>
    html { background: #0a2530; }
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(135deg, #0a2530 0%, #0e3a4d 100%); color: white; overflow-x: hidden; min-height: 100vh; }
    .container { max-width: 720px; margin: 0 auto; padding: 24px 16px; box-sizing: border-box; }
    .header { display:flex; align-items:center; gap:12px; margin-bottom:16px; padding-bottom:16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    h1 { font-size: 18px; margin: 0; }
    .subtitle { font-size: 12px; color: rgba(165,243,252,0.8); margin-top: 4px; }
    .footer { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); text-align: center; }
    table { table-layout: auto; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="font-size:28px;">🎾</div>
      <div>
        <h1>${escapeHtml(m.athleteName)} <span style="opacity:0.5;">vs</span> ${escapeHtml(m.opponentName)}</h1>
        ${subtitleParts.length > 0 ? `<div class="subtitle">${escapeHtml(subtitleParts.join(' · '))}</div>` : ''}
        ${winnerName ? `<div style="font-size:13px; color:#facc15; font-weight:600; margin-top:4px;">🏆 ${escapeHtml(winnerName)} venceu · ${escapeHtml(finalScore)}</div>` : ''}
      </div>
    </div>

    ${renderScoreTable(m)}
    ${renderStatsTable(m)}
    ${renderMomentum(m)}
    ${renderNotes(m)}

    <div class="footer">
      Gerado em ${generatedAt} pelo Tennis Flow · Snapshot permanente do match.
    </div>
  </div>
</body>
</html>`;
}
