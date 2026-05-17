// Tennis Flow — vanilla JS SPA, no build step

const $ = (id) => document.getElementById(id);
const el = (tag, attrs, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
};

function fmtValueNoCents(s) {
  return s ? String(s).replace(/[.,]\d{2}(?!\d)/, '') : '';
}

// Parses a Brazilian currency value robustly. Handles the TI quirk
// where the decimal separator is sometimes "." and sometimes ",".
//   "R$ 217,00"   → 217
//   "R$ 297.00"   → 297
//   "R$ 1.200,50" → 1200.5
//   "R$ 1,234.56" → 1234.56  (rare)
function parseBrCurrency(s) {
  if (!s) return 0;
  const cleaned = String(s).replace(/[^\d,.]/g, '');
  if (!cleaned) return 0;
  // The last separator (comma or dot) before exactly 2 trailing digits is the decimal
  const m = cleaned.match(/^(.*)([.,])(\d{2})$/);
  if (m) {
    const intPart = m[1].replace(/[.,]/g, '');
    return parseFloat(intPart + '.' + m[3]);
  }
  // No decimals — treat all separators as thousand separators
  return parseFloat(cleaned.replace(/[.,]/g, '')) || 0;
}

function brToDate(s) {
  if (!s) return null;
  const [d, m, y] = s.split('/').map(Number);
  return new Date(y, m - 1, d);
}

// ===== Calendar reminder for pending payment =====
function buildPaymentReminder(t) {
  const pp = t.pendingPayment;
  if (!pp?.dueDate) return null;
  const due = brToDate(pp.dueDate);
  if (!due) return null;
  const start = new Date(due);
  start.setDate(start.getDate() - 1);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const title = `💰 Pagar inscrição: ${t.name || 'torneio'}`;
  const lines = [
    pp.category && `Categoria: ${pp.category}`,
    pp.value && `Valor: ${pp.value}`,
    `Vence: ${pp.dueDate} (até 16h, horário de Brasília)`,
    '',
    `Pagar em: ${t.url || 'https://www.tenisintegrado.com.br'}`,
  ].filter(Boolean);
  return { title, description: lines.join('\n'), start, end };
}

function fmtIcsDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function downloadIcs(reminder, filename = 'lembrete.ics') {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TennisFlow//PT-BR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:tennis-flow-${Date.now()}-${Math.random().toString(36).slice(2)}@local`,
    `DTSTAMP:${fmtIcsDate(new Date())}`,
    `DTSTART:${fmtIcsDate(reminder.start)}`,
    `DTEND:${fmtIcsDate(reminder.end)}`,
    `SUMMARY:${reminder.title}`,
    `DESCRIPTION:${reminder.description.replace(/\n/g, '\\n').replace(/,/g, '\\,')}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Pagar inscrição',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function googleCalendarUrl(reminder) {
  const fmt = (d) => fmtIcsDate(d);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: reminder.title,
    dates: `${fmt(reminder.start)}/${fmt(reminder.end)}`,
    details: reminder.description,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
function brToIso(s) {
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length < 3) return null;
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length !== 4) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}
function startYearOf(t) {
  const iso = brToIso(t.startDate);
  return iso ? Number(iso.slice(0, 4)) : null;
}
function formatCardDate(t) {
  if (!t.startDate) return '';
  const y = startYearOf(t);
  const currentYear = new Date().getFullYear();
  return y && y !== currentYear ? t.startDate : t.startDate.slice(0, 5);
}
const STATUS_LABELS = {
  upcoming: 'Futuro',
  ongoing: 'Em andamento',
  past: 'Passado',
  unknown: 'Sem data',
};
const STATUS_BADGE = {
  upcoming: 'bg-emerald-100 text-emerald-800',
  ongoing: 'bg-amber-100 text-amber-800',
  past: 'bg-slate-200 text-slate-600',
  unknown: 'bg-slate-100 text-slate-500',
};

const TIER_ORDER = ['GA+', 'GA', 'G1+', 'G1', 'G2', 'G3'];
const state = {
  user: null,
  hasUsers: false,
  profiles: [],
  activeProfileId: localStorage.getItem('activeProfileId') || null,
  data: null,
  syncStatus: null,
  unseenAlertsCount: 0,
  alertOnLoadShown: false,
  filterUFs: (() => {
    const raw = localStorage.getItem('filterUFs');
    try { const v = JSON.parse(raw); if (Array.isArray(v)) return v; } catch {}
    const old = localStorage.getItem('filterUF');
    if (old && old !== 'all') return [old];
    return [];
  })(),
  filterTiers: (() => {
    const raw = localStorage.getItem('filterTiers');
    try { const v = JSON.parse(raw); if (Array.isArray(v)) return v; } catch {}
    // migrate old single-value localStorage 'filterTier'
    const old = localStorage.getItem('filterTier');
    if (old && old !== 'all') return [old];
    return [];
  })(),
  filterYears: (() => {
    try { const v = JSON.parse(localStorage.getItem('filterYears') || '[]'); return Array.isArray(v) ? v.map(Number) : []; }
    catch { return []; }
  })(),
  columnSort: (() => {
    try { return JSON.parse(localStorage.getItem('columnSort') || '{}'); }
    catch { return {}; }
  })(),
  columnOrder: (() => {
    try {
      const v = JSON.parse(localStorage.getItem('columnOrder') || 'null');
      return Array.isArray(v) ? v : null;
    } catch { return null; }
  })(),
  columnLabels: (() => {
    try {
      const v = JSON.parse(localStorage.getItem('columnLabels') || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
  })(),
  hiddenColumns: (() => {
    try {
      const v = JSON.parse(localStorage.getItem('hiddenColumns') || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  })(),
};

const api = {
  async me() { return (await fetch('/api/auth/me')).json(); },
  async version() { return (await fetch('/api/version')).json(); },
  async getBoardConfig() { return (await fetch('/api/household/board-config')).json(); },
  async updateBoardConfig(patch) {
    const r = await fetch('/api/household/board-config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async listInvites() { return (await fetch('/api/household/invites')).json(); },
  async createInvite({ label, role }) {
    const r = await fetch('/api/household/invites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, role }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async revokeInvite(token) {
    return fetch('/api/household/invites/' + token, { method: 'DELETE' });
  },
  async removeMember(userId) {
    const r = await fetch('/api/household/members/' + userId, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async setMemberRole(userId, role) {
    const r = await fetch(`/api/household/members/${userId}/role`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async getInvite(token) {
    const r = await fetch('/api/invite/' + token);
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async acceptInvite(token) {
    const r = await fetch('/api/invite/' + token + '/accept', { method: 'POST' });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async signup({ email, password, firstName, lastName }) {
    const r = await fetch('/api/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, firstName, lastName }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async completeProfile({ firstName, lastName }) {
    const r = await fetch('/api/auth/complete-profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async login(email, password) {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async logout() { return fetch('/api/auth/logout', { method: 'POST' }); },
  async listProfiles() { return (await fetch('/api/profiles')).json(); },
  async createProfile(body) {
    const r = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async updateProfile(id, body) {
    const r = await fetch(`/api/profiles/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  },
  async deleteProfile(id) { await fetch(`/api/profiles/${id}`, { method: 'DELETE' }); },
  async getTournaments(id) { return (await fetch(`/api/profiles/${id}/tournaments`)).json(); },
  async sync(id) {
    const r = await fetch(`/api/profiles/${id}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    return r.json();
  },
  async syncAll() {
    const r = await fetch('/api/sync-all', { method: 'POST' });
    return r.json();
  },
  async syncStatus(id) { return (await fetch(`/api/profiles/${id}/sync-status`)).json(); },
  async updateNotes(profileId, tid, body) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/notes`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  },
  async flightUrl(profileId, tid) { return (await fetch(`/api/profiles/${profileId}/tournaments/${tid}/flight-url`)).json(); },
  async tournamentDetails(tid, profileId = null) {
    const q = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
    return (await fetch(`/api/tournament-details/${tid}${q}`)).json();
  },
  async listLabels(profileId) { return (await fetch(`/api/profiles/${profileId}/labels`)).json(); },
  async createLabel(profileId, body) {
    const r = await fetch(`/api/profiles/${profileId}/labels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async updateLabel(profileId, lid, body) {
    const r = await fetch(`/api/profiles/${profileId}/labels/${lid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async deleteLabel(profileId, lid) { return fetch(`/api/profiles/${profileId}/labels/${lid}`, { method: 'DELETE' }); },
  async getLabelColors() { return (await fetch('/api/label-colors')).json(); },
  async clearCardOrder(profileId, tids) {
    const r = await fetch(`/api/profiles/${profileId}/cards/clear-order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tids }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async moveCard(profileId, tid, column, order, siblings, sourceColumn, sourceSiblings) {
    const body = JSON.stringify({ column, order, siblings, sourceColumn, sourceSiblings });
    const url = `/api/profiles/${profileId}/tournaments/${tid}/column`;
    const opts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body };
    let r = await fetch(url, opts);
    // 502/503/504: servidor reiniciando (deploy do Render). Auto-retry uma vez.
    if (r.status >= 502 && r.status <= 504) {
      await new Promise(res => setTimeout(res, 1500));
      r = await fetch(url, opts);
    }
    if (!r.ok) {
      if (r.status >= 500) throw new Error('Servidor indisponível (tente em alguns segundos).');
      const text = await r.text().catch(() => '');
      let msg = `HTTP ${r.status}`;
      try { msg = JSON.parse(text).error || msg; } catch {}
      throw new Error(msg);
    }
    return r.json();
  },
  async getCardActivity(profileId, tid) { return (await fetch(`/api/profiles/${profileId}/tournaments/${tid}/activity`)).json(); },
  async addComment(profileId, tid, text) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async editComment(profileId, tid, cid, text) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/comments/${cid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async deleteComment(profileId, tid, cid) {
    return fetch(`/api/profiles/${profileId}/tournaments/${tid}/comments/${cid}`, { method: 'DELETE' });
  },
  async listReceipts(profileId, tid) { return (await fetch(`/api/profiles/${profileId}/tournaments/${tid}/receipts`)).json(); },
  async uploadReceipt(profileId, tid, body) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/receipts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async updateReceiptCategory(profileId, tid, rid, category) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/receipts/${rid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async deleteReceipt(profileId, tid, rid) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/receipts/${rid}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 204) throw new Error((await r.json()).error || 'Erro');
  },
  async getQuota(profileId) { return (await fetch(`/api/profiles/${profileId}/quota`)).json(); },
  async listAlertRules(profileId) { return (await fetch(`/api/profiles/${profileId}/alert-rules`)).json(); },
  async createAlertRule(profileId, body) {
    const r = await fetch(`/api/profiles/${profileId}/alert-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async updateAlertRule(profileId, ruleId, body) {
    const r = await fetch(`/api/profiles/${profileId}/alert-rules/${ruleId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    return r.json();
  },
  async deleteAlertRule(profileId, ruleId) {
    await fetch(`/api/profiles/${profileId}/alert-rules/${ruleId}`, { method: 'DELETE' });
  },
  async listAlerts(profileId, { unseen = false } = {}) {
    const q = unseen ? '?unseen=1' : '';
    return (await fetch(`/api/profiles/${profileId}/alerts${q}`)).json();
  },
  async markAlertsSeen(profileId, ids) {
    const r = await fetch(`/api/profiles/${profileId}/alerts/seen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    return r.json();
  },
  async markAllAlertsSeen(profileId) {
    const r = await fetch(`/api/profiles/${profileId}/alerts/seen-all`, { method: 'POST' });
    return r.json();
  },
  async deleteAlertEvent(profileId, eventId) {
    await fetch(`/api/profiles/${profileId}/alerts/${eventId}`, { method: 'DELETE' });
  },
  async pushInfo() {
    const r = await fetch('/api/push/info');
    if (!r.ok) return null;
    return r.json();
  },
  async pushSubscribe(subscription) {
    const r = await fetch('/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro ao registrar');
    return r.json();
  },
  async pushUnsubscribe(endpoint) {
    await fetch('/api/push/subscribe', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  },
  async pushTest() {
    const r = await fetch('/api/push/test', { method: 'POST' });
    if (!r.ok) throw new Error('Erro');
    return r.json();
  },
  async getAnnouncement() {
    const r = await fetch('/api/announcement');
    if (!r.ok) return null;
    return r.json();
  },
  async postAnnouncement(message, url, cta) {
    const r = await fetch('/api/admin/announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, url, cta }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro');
    return r.json();
  },
  async deleteAnnouncement() {
    await fetch('/api/admin/announcement', { method: 'DELETE' });
  },
  async createShareLink(profileId, tid) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/share`, { method: 'POST' });
    if (!r.ok) throw new Error('Erro ao gerar link');
    return r.json();
  },
  async resetBoardOverrides(profileId) {
    const r = await fetch(`/api/profiles/${profileId}/reset-board-overrides`, { method: 'POST' });
    if (!r.ok) throw new Error('Erro ao resetar');
    return r.json();
  },
  async resetAll(profileId) {
    const r = await fetch(`/api/profiles/${profileId}/reset-all`, { method: 'POST' });
    if (!r.ok) throw new Error('Erro ao resetar tudo');
    return r.json();
  },
  async reevaluateAlerts(profileId) {
    const r = await fetch(`/api/profiles/${profileId}/alerts/reevaluate`, { method: 'POST' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao re-avaliar');
    return r.json();
  },
  async listAdminProfiles() {
    const r = await fetch('/api/admin/profiles');
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao listar');
    return r.json();
  },
  async listReportRequests() {
    const r = await fetch('/api/admin/report-requests');
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao listar pedidos');
    return r.json();
  },
  async updateReportRequestStatus(profileId, requestId, status) {
    const r = await fetch(`/api/admin/report-requests/${profileId}/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao atualizar status');
    return r.json();
  },
  async listProfileReports(profileId) {
    const r = await fetch(`/api/profiles/${profileId}/reports`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao listar relatórios');
    return r.json();
  },
  async deliverReport(profileId, requestId, html, asEmail) {
    const url = asEmail
      ? `/api/admin/report-requests/${profileId}/${requestId}/deliver?as=${encodeURIComponent(asEmail)}`
      : `/api/admin/report-requests/${profileId}/${requestId}/deliver`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao entregar relatório');
    return r.json();
  },
  async listLiveMatches(profileId) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao listar matches');
    return r.json();
  },
  async createLiveMatch(profileId, body) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao criar match');
    return r.json();
  },
  async getLiveMatch(profileId, matchId) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao buscar match');
    return r.json();
  },
  async addLivePoint(profileId, matchId, winner, stat) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner, stat }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao registrar ponto');
    return r.json();
  },
  async undoLivePoint(profileId, matchId) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/points/last`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao desfazer');
    return r.json();
  },
  async addLiveNote(profileId, matchId, text, tag) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tag }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao adicionar nota');
    return r.json();
  },
  async abandonLiveMatch(profileId, matchId, abandonedBy, abandonReason) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'abandon', abandonedBy, abandonReason }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao encerrar');
    return r.json();
  },
  async gameManualLiveMatch(profileId, matchId, winner) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao registrar game manual');
    return r.json();
  },
  async finalizeLiveMatch(profileId, matchId, sets) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sets }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao finalizar match');
    return r.json();
  },
  async deleteLiveMatch(profileId, matchId) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao deletar');
    return r.json();
  },
  async getLiveMatchTokens(profileId, matchId) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/tokens`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao buscar tokens');
    return r.json();
  },
  async generateMatchReport(profileId, matchId) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/generate-report`, { method: 'POST' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao gerar relatório');
    return r.json();
  },
  // Endpoints públicos via token (sem login)
  async publicGetMatch(kind, token) {
    const r = await fetch(`/api/${kind}/${token}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro');
    return r.json();
  },
  async publicAddPoint(token, winner, stat) {
    const r = await fetch(`/api/scout/${token}/points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner, stat }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao registrar ponto');
    return r.json();
  },
  async publicUndoPoint(token) {
    const r = await fetch(`/api/scout/${token}/points/last`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao desfazer');
    return r.json();
  },
  async addLiveMarker(profileId, matchId, stat) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/markers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stat }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao registrar marker');
    return r.json();
  },
  async publicAddMarker(token, stat) {
    const r = await fetch(`/api/scout/${token}/markers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stat }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao registrar marker');
    return r.json();
  },
  async publicAddNote(token, text, tag) {
    const r = await fetch(`/api/scout/${token}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tag }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao adicionar nota');
    return r.json();
  },
  // Viewer (coach) adiciona nota — funciona AO VIVO e PÓS-JOGO (análise).
  async publicLiveAddNote(token, text, tag) {
    const r = await fetch(`/api/live/${token}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tag }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao adicionar nota');
    return r.json();
  },
  async publicAbandonMatch(token, side, reason) {
    const r = await fetch(`/api/scout/${token}/abandon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side, reason }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao encerrar');
    return r.json();
  },
  async publicGameManual(token, winner) {
    const r = await fetch(`/api/scout/${token}/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao registrar game manual');
    return r.json();
  },
  async deleteLiveNote(profileId, matchId, noteId) {
    const r = await fetch(`/api/profiles/${profileId}/live-matches/${matchId}/notes/${noteId}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao excluir nota');
    return r.json();
  },
  async seedAndDeliverReport(profileId, html, asEmail) {
    const r = await fetch(`/api/admin/profiles/${profileId}/seed-deliver?as=${encodeURIComponent(asEmail)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro na entrega retroativa');
    return r.json();
  },
};

// ===== Init =====
async function init() {
  // Páginas públicas de Scout ao Vivo: /scout/:token (marcar) e /live/:token
  // (espectador). Bypass total do login — token autoriza, render direto.
  const publicMatch = window.location.pathname.match(/^\/(scout|live)\/([a-f0-9]{32})$/);
  if (publicMatch) {
    openPublicLiveMatch(publicMatch[1], publicMatch[2]);
    return;
  }

  // Captura token de convite na URL (compartilhado por WhatsApp/email)
  const urlInviteToken = new URLSearchParams(window.location.search).get('invite');

  // Versão do app — fetch em paralelo com /api/auth/me, falha silenciosa.
  api.version().then(v => { state.version = v; }).catch(() => {});

  const me = await api.me();
  state.user = me.userId ? {
    id: me.userId, email: me.email,
    firstName: me.firstName || null,
    lastName: me.lastName || null,
    name: me.firstName && me.lastName ? `${me.firstName} ${me.lastName}` : null,
    householdId: me.householdId, members: me.members || [],
    plan: me.plan || null,
    role: me.role || 'editor',
    isFounder: !!me.isFounder,
    isAdmin: !!me.isAdmin,
    needsProfile: !!me.needsProfile,
  } : null;
  state.hasUsers = !!me.hasUsers;

  if (urlInviteToken) {
    state.pendingInviteToken = urlInviteToken;
    let info = null;
    try { info = await api.getInvite(urlInviteToken); }
    catch (e) { state.pendingInviteError = e.message; }
    state.pendingInviteInfo = info;

    if (!state.user) {
      renderAuth();
      return;
    }

    // Logado: três casos
    if (info) {
      // Sempre mostra a tela de escolha — mesmo quando já é membro,
      // pra dar opção de trocar de conta (útil pra testar).
      renderInviteChoice(info);
      return;
    } else if (state.pendingInviteError) {
      alert('Convite inválido: ' + state.pendingInviteError);
      window.history.replaceState({}, '', '/');
      state.pendingInviteToken = null;
    }
  }

  if (!state.user) {
    renderAuth();
    return;
  }

  state.profiles = await api.listProfiles();
  if (!state.profiles.length) {
    state.activeProfileId = null;
  } else if (!state.activeProfileId || !state.profiles.find(p => p.id === state.activeProfileId)) {
    state.activeProfileId = state.profiles[0].id;
    localStorage.setItem('activeProfileId', state.activeProfileId);
  }
  await loadBoardConfig();
  await refreshActive();
  render();
  pollSyncStatus();
  maybeOpenAlertsFromUrl();
  if (state.user?.needsProfile) {
    openCompleteProfileModal();
  }
  api.getAnnouncement().then(ann => { if (ann) showAnnouncementBanner(ann); }).catch(() => {});
}

function openCompleteProfileModal() {
  const root = $('modal-root');
  root.innerHTML = '';
  // Modal não pode ser fechado sem preencher — overlay sem onClick
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[70]' });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[71] w-[calc(100%-2rem)] max-w-sm bg-white text-slate-900 rounded-2xl shadow-2xl p-5 space-y-4',
    style: 'padding-top: max(1.25rem, env(safe-area-inset-top)); padding-bottom: max(1.25rem, env(safe-area-inset-bottom));',
  });
  const fnInp = el('input', { type: 'text', placeholder: 'Nome', class: 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400' });
  const lnInp = el('input', { type: 'text', placeholder: 'Sobrenome', class: 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400' });
  const errBox = el('div', { class: 'text-sm text-rose-700', style: 'display:none' });
  const submitBtn = el('button', {
    class: 'w-full rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-semibold text-sm px-4 py-2.5 transition-colors disabled:opacity-60',
    onClick: async () => {
      errBox.style.display = 'none';
      const firstName = fnInp.value.trim();
      const lastName = lnInp.value.trim();
      if (!firstName || !lastName) {
        errBox.textContent = 'Nome e sobrenome são obrigatórios.';
        errBox.style.display = 'block';
        return;
      }
      submitBtn.disabled = true; submitBtn.textContent = 'Salvando…';
      try {
        await api.completeProfile({ firstName, lastName });
        state.user.firstName = firstName;
        state.user.lastName = lastName;
        state.user.name = `${firstName} ${lastName}`;
        state.user.needsProfile = false;
        overlay.remove(); card.remove();
        renderHeader();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Salvar';
      }
    },
  }, 'Salvar');

  card.append(
    el('div', null,
      el('h3', { class: 'text-base font-semibold text-slate-900' }, 'Complete seu cadastro'),
      el('p', { class: 'text-xs text-slate-600 mt-1' },
        'Pra personalizar a experiência, precisamos do seu nome completo. Aparece no avatar e na lista de membros da família.'),
    ),
    el('label', { class: 'block' },
      el('span', { class: 'block text-xs text-slate-700 mb-1 font-medium' }, 'Nome'), fnInp),
    el('label', { class: 'block' },
      el('span', { class: 'block text-xs text-slate-700 mb-1 font-medium' }, 'Sobrenome'), lnInp),
    errBox,
    submitBtn,
  );
  fnInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') lnInp.focus(); });
  lnInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitBtn.click(); });

  root.appendChild(overlay);
  root.appendChild(card);
  setTimeout(() => fnInp.focus(), 0);
}

// Configuração do board (labels + ordem de colunas) é compartilhada na household.
// Carrega do servidor; se localStorage tiver valores antigos e o servidor estiver
// vazio, faz upload uma vez e limpa o localStorage.
async function loadBoardConfig() {
  try {
    const remote = await api.getBoardConfig();
    const localOrder = localStorage.getItem('columnOrder');
    const localLabels = localStorage.getItem('columnLabels');
    const remoteEmpty = (!remote.columnOrder || remote.columnOrder.length === 0)
      && (!remote.columnLabels || Object.keys(remote.columnLabels).length === 0);
    if (remoteEmpty && (localOrder || localLabels)) {
      // Migra localStorage pro servidor
      const patch = {};
      try { const v = JSON.parse(localOrder || 'null'); if (Array.isArray(v) && v.length) patch.columnOrder = v; } catch {}
      try { const v = JSON.parse(localLabels || '{}'); if (v && typeof v === 'object' && Object.keys(v).length) patch.columnLabels = v; } catch {}
      if (Object.keys(patch).length) {
        const saved = await api.updateBoardConfig(patch);
        state.columnOrder = saved.columnOrder;
        state.columnLabels = saved.columnLabels || {};
      } else {
        state.columnOrder = remote.columnOrder;
        state.columnLabels = remote.columnLabels || {};
      }
      localStorage.removeItem('columnOrder');
      localStorage.removeItem('columnLabels');
    } else {
      state.columnOrder = remote.columnOrder;
      state.columnLabels = remote.columnLabels || {};
      // Se o servidor tem config, descarta localStorage antigo
      if (!remoteEmpty) {
        localStorage.removeItem('columnOrder');
        localStorage.removeItem('columnLabels');
      }
    }
  } catch (e) {
    console.warn('[board-config] fallback pra defaults', e);
  }
}

function renderAuth() {
  document.body.classList.remove('kanban-mode');
  document.body.classList.add('auth-mode');
  const root = $('app');
  root.innerHTML = '';

  const isFirstUser = !state.hasUsers;
  // Convite pendente — default pra signup (suposição: convidado é novo no app)
  const hasInvite = !!state.pendingInviteInfo;
  let mode = (isFirstUser || hasInvite) ? 'signup' : 'login';

  const draw = () => {
    root.innerHTML = '';
    const inputs = {};
    const field = (key, label, type, placeholder, icon) => {
      const inp = el('input', {
        type, placeholder,
        class: 'w-full bg-white/95 border border-white/30 text-slate-900 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder:text-slate-400',
      });
      inputs[key] = inp;
      return el('label', { class: 'block' },
        el('div', { class: 'block text-xs text-white/80 mb-1.5 font-medium' }, label),
        el('div', { class: 'relative' },
          el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-base text-slate-400 pointer-events-none' }, icon),
          inp,
        ),
      );
    };
    const errorBox = el('div', { class: 'text-sm text-red-200 bg-red-900/40 border border-red-400/30 rounded px-3 py-2', style: 'display:none' });
    const showError = (msg) => { errorBox.textContent = msg; errorBox.style.display = 'block'; };

    const submit = async () => {
      errorBox.style.display = 'none';
      const email = inputs.email.value.trim();
      const password = inputs.password.value;
      if (!email || !password) { showError('Email e senha são obrigatórios'); return; }
      if (mode === 'signup') {
        const firstName = inputs.firstName?.value.trim();
        const lastName = inputs.lastName?.value.trim();
        if (!firstName || !lastName) { showError('Nome e sobrenome são obrigatórios'); return; }
      }
      submitBtn.disabled = true;
      submitBtn.textContent = mode === 'signup' ? 'Criando…' : 'Entrando…';
      try {
        if (mode === 'signup') {
          await api.signup({
            email, password,
            firstName: inputs.firstName.value.trim(),
            lastName: inputs.lastName.value.trim(),
          });
        } else {
          await api.login(email, password);
        }
        await init();
      } catch (e) {
        showError(e.message);
        submitBtn.disabled = false;
        submitBtn.textContent = mode === 'signup' ? 'Criar conta' : 'Entrar';
      }
    };

    const submitBtn = el('button', {
      class: 'w-full rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-sm px-4 py-2.5 transition-colors disabled:opacity-60',
      onClick: submit,
    }, mode === 'signup' ? 'Criar conta' : 'Entrar');

    // Enter no input dispara submit
    const onEnter = (e) => { if (e.key === 'Enter') submit(); };

    const inviteBanner = state.pendingInviteInfo && el('div', { class: 'rounded-lg bg-cyan-500/15 border border-cyan-300/40 px-3 py-2.5 text-sm text-white' },
      el('div', { class: 'font-medium mb-0.5' }, '🎾 Você foi convidado'),
      el('div', { class: 'text-xs text-white/80' },
        state.pendingInviteInfo.inviterEmail
          ? `${state.pendingInviteInfo.inviterEmail} compartilhou os atletas com você. `
          : 'Aceite o convite pra ver os atletas compartilhados. ',
        mode === 'signup' ? 'Crie sua conta pra aceitar.' : 'Entre na sua conta pra aceitar.',
      ),
    );

    const card = el('div', { class: 'w-full max-w-sm bg-slate-900/40 backdrop-blur-md border border-white/15 rounded-2xl shadow-2xl p-7 space-y-5' },
      el('div', { class: 'space-y-1' },
        el('h2', { class: 'text-xl font-semibold text-white' }, mode === 'signup' ? 'Criar conta' : 'Entrar'),
        el('p', { class: 'text-xs text-white/60' },
          isFirstUser && mode === 'signup'
            ? 'Primeira instalação — esta conta vira a "dona" do app.'
            : (mode === 'signup' ? 'Crie sua conta pra começar.' : 'Bem-vindo de volta.'),
        ),
      ),
      inviteBanner,

      mode === 'signup' && el('div', { class: 'grid grid-cols-2 gap-2' },
        field('firstName', 'Nome', 'text', 'Maria', '👤'),
        field('lastName', 'Sobrenome', 'text', 'Silva', '👤'),
      ),
      field('email', 'Email', 'email', 'voce@email.com', '✉'),
      field('password', mode === 'signup' ? 'Senha (mín. 6 caracteres)' : 'Senha', 'password', '••••••••', '🔒'),

      errorBox,

      submitBtn,

      !isFirstUser && el('div', { class: 'text-center text-xs text-white/70' },
        mode === 'signup' ? 'Já tem conta? ' : 'Ainda não tem conta? ',
        el('button', {
          class: 'text-cyan-300 hover:text-cyan-200 underline-offset-2 hover:underline font-medium',
          onClick: () => { mode = mode === 'signup' ? 'login' : 'signup'; draw(); },
        }, mode === 'signup' ? 'Entrar' : 'Criar conta'),
      ),

      el('div', { class: 'text-center text-[11px] text-white/35' },
        el('a', {
          href: '/privacidade',
          target: '_blank',
          class: 'hover:text-white/60 underline-offset-2 hover:underline transition-colors',
        }, 'Privacidade & Segurança · LGPD'),
      ),
    );

    inputs.email.addEventListener('keydown', onEnter);
    inputs.password.addEventListener('keydown', onEnter);

    root.appendChild(el('div', { class: 'min-h-screen flex flex-col items-center justify-center px-4 py-8' },
      // Logo + tagline
      el('div', { class: 'mb-8 text-center select-none' },
        el('div', { class: 'inline-flex items-center gap-3 mb-2' },
          el('span', { class: 'text-4xl' }, '🎾'),
          el('span', { class: 'text-3xl font-bold tracking-tight' },
            el('span', { class: 'text-white' }, 'Tennis'),
            el('span', { class: 'text-cyan-300 ml-1' }, 'Flow'),
          ),
        ),
        el('p', { class: 'text-sm text-white/70 mt-1' },
          'Organize a agenda de torneios da família atleta',
        ),
      ),
      card,
      el('div', { class: 'mt-6 text-[11px] text-white/50 text-center max-w-sm space-y-1' },
        el('p', null, 'Desenvolvido por Alexandre Garcia · ',
          el('a', { href: 'mailto:alexopiniao@gmail.com', class: 'text-white/70 hover:text-white underline-offset-2 hover:underline' }, 'alexopiniao@gmail.com'),
        ),
        el('p', null, 'Sem vínculo com o Tênis Integrado. Sugestões são bem-vindas.'),
      ),
    ));

    inputs.email.focus();
  };
  draw();
}

function renderInviteChoice(info) {
  document.body.classList.remove('kanban-mode');
  document.body.classList.add('auth-mode');
  const root = $('app');
  root.innerHTML = '';

  const isAlreadyMember = !!info.alreadyMember;

  const continueAsCurrent = async () => {
    window.history.replaceState({}, '', '/');
    state.pendingInviteToken = null;
    state.pendingInviteInfo = null;
    await init();
  };

  const accept = async () => {
    try {
      await api.acceptInvite(info.token);
      const refreshed = await api.me();
      state.user.householdId = refreshed.householdId;
      state.user.members = refreshed.members || [];
      window.history.replaceState({}, '', '/');
      state.pendingInviteToken = null;
      state.pendingInviteInfo = null;
      await init();
    } catch (err) { alert('Erro: ' + err.message); }
  };

  const switchAccount = async () => {
    await api.logout();
    state.user = null;
    state.profiles = [];
    state.activeProfileId = null;
    state.data = null;
    localStorage.removeItem('activeProfileId');
    init();
  };

  const headerTitle = isAlreadyMember
    ? 'Esse é o link da sua família'
    : '🎾 Convite recebido';
  const subtitle = isAlreadyMember
    ? `Você já está na família ${info.inviterEmail ? `do ${info.inviterEmail}` : ''}. Pode seguir como ${state.user.email} ou sair pra entrar com outra conta.`
    : (info.inviterEmail
        ? `${info.inviterEmail} compartilhou os atletas com você.`
        : 'Você foi convidado a entrar numa família.');
  const primaryLabel = isAlreadyMember
    ? `Continuar como ${state.user.email}`
    : 'Aceitar com esta conta';
  const primaryAction = isAlreadyMember ? continueAsCurrent : accept;

  const card = el('div', { class: 'w-full max-w-md bg-slate-900/40 backdrop-blur-md border border-white/15 rounded-2xl shadow-2xl p-7 space-y-5 text-white' },
    el('div', null,
      el('h2', { class: 'text-xl font-semibold mb-1' }, headerTitle),
      el('p', { class: 'text-sm text-white/70' }, subtitle),
    ),
    !isAlreadyMember && el('div', { class: 'rounded-lg bg-white/5 border border-white/10 p-3 text-sm' },
      el('div', { class: 'text-xs uppercase tracking-wide text-white/50 mb-1' }, 'Você está logado como'),
      el('div', { class: 'font-medium' }, state.user.email),
    ),
    el('div', { class: 'flex flex-col gap-2' },
      el('button', {
        class: 'w-full rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-sm px-4 py-2.5 truncate',
        onClick: primaryAction,
      }, primaryLabel),
      el('button', {
        class: 'w-full rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm px-4 py-2.5 border border-white/20',
        onClick: switchAccount,
      }, 'Sair e usar outra conta'),
    ),
    !isAlreadyMember && el('p', { class: 'text-[11px] text-white/50 text-center' },
      'Ao aceitar, seus atletas atuais (se houver) também passam a ser vistos pelos outros membros.',
    ),
  );

  root.appendChild(el('div', { class: 'min-h-screen flex items-center justify-center px-4 py-8' }, card));
}

async function openInviteModal() {
  const root = $('modal-root');
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden',
  });
  const header = el('div', { class: 'shrink-0 bg-[#0e3a4d] text-white px-5 py-3 flex items-center justify-between' },
    el('h3', { class: 'font-medium' }, '👥 Convidar membro'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  );
  const body = el('div', { class: 'flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4' });
  card.appendChild(header);
  card.appendChild(body);
  root.appendChild(overlay);
  root.appendChild(card);

  // Estado do form persistido fora de renderBody pra não resetar quando
  // a lista de membros/convites é re-renderizada.
  let selectedRole = 'editor';
  let savedLabel = '';

  const renderBody = async () => {
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'text-sm text-slate-600' },
      'Convide membros da família como Editor (mexe em tudo) ou Leitor (só visualiza). Mande o link por WhatsApp, email ou SMS.'));

    // Form pra criar novo convite — apelido + role
    const labelInput = el('input', {
      type: 'text', placeholder: 'Apelido (opcional, ex: "Maria")',
      value: savedLabel,
      class: 'w-full text-sm rounded border border-slate-300 px-2 py-1.5 outline-none focus:border-cyan-400',
    });
    labelInput.oninput = (e) => { savedLabel = e.target.value; };

    const editorBtn = el('button', { type: 'button', class: '' },
      el('div', { class: 'text-xs font-semibold' }, 'Editor'),
      el('div', { class: 'text-[11px] text-slate-500 mt-0.5' }, 'Adiciona, edita e exclui'),
    );
    const viewerBtn = el('button', { type: 'button', class: '' },
      el('div', { class: 'text-xs font-semibold' }, 'Leitor'),
      el('div', { class: 'text-[11px] text-slate-500 mt-0.5' }, 'Só visualiza, não altera'),
    );
    const applyRoleStyles = () => {
      const base = 'flex-1 text-sm rounded border px-3 py-2 text-left transition-colors';
      const sel = 'border-cyan-600 bg-cyan-50';
      const unsel = 'border-slate-300 hover:bg-slate-50';
      editorBtn.className = `${base} ${selectedRole === 'editor' ? sel : unsel}`;
      viewerBtn.className = `${base} ${selectedRole === 'viewer' ? sel : unsel}`;
      editorBtn.querySelector('div').className = `text-xs font-semibold ${selectedRole === 'editor' ? 'text-cyan-700' : 'text-slate-700'}`;
      viewerBtn.querySelector('div').className = `text-xs font-semibold ${selectedRole === 'viewer' ? 'text-cyan-700' : 'text-slate-700'}`;
    };
    applyRoleStyles();
    editorBtn.onclick = (e) => { e.preventDefault(); selectedRole = 'editor'; applyRoleStyles(); };
    viewerBtn.onclick = (e) => { e.preventDefault(); selectedRole = 'viewer'; applyRoleStyles(); };

    const createBtn = el('button', {
      type: 'button',
      class: 'w-full text-sm rounded bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-3 py-2',
      onClick: async () => {
        createBtn.disabled = true; createBtn.textContent = 'Gerando…';
        try {
          await api.createInvite({ label: labelInput.value.trim() || null, role: selectedRole });
          savedLabel = ''; // limpa apelido após gerar
          await renderBody();
        } catch (err) {
          alert('Erro: ' + err.message);
          createBtn.disabled = false; createBtn.textContent = 'Gerar link';
        }
      },
    }, 'Gerar link');
    body.appendChild(el('div', { class: 'space-y-2' },
      labelInput,
      el('div', { class: 'flex gap-2' }, editorBtn, viewerBtn),
      createBtn,
    ));

    // Membros atuais
    const meRes = await api.me();
    state.user.members = meRes.members || [];
    if (state.user.members.length > 1) {
      const isFounder = !!state.user.members.find(m => m.id === state.user.id && m.isFounder);
      body.appendChild(el('div', { class: 'pt-3 border-t border-slate-200' },
        el('h4', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2' }, 'Membros atuais'),
        el('ul', { class: 'space-y-1' },
          ...state.user.members.map(m => {
            const roleBadge = m.isFounder
              ? el('span', { class: 'text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800' }, 'Dono')
              : el('span', { class: `text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${m.role === 'viewer' ? 'bg-slate-200 text-slate-700' : 'bg-cyan-100 text-cyan-800'}` }, m.role === 'viewer' ? 'Leitor' : 'Editor');
            return el('li', { class: 'flex items-center gap-2 text-sm py-1' },
              el('span', { class: `w-7 h-7 rounded-full ${avatarColor(m.id || m.email).bg} text-white text-[10px] font-semibold flex items-center justify-center shrink-0` }, userInitials(m.email || m.name)),
              el('div', { class: 'min-w-0 flex-1' },
                el('div', { class: 'truncate text-sm text-slate-800' }, m.email || m.name || 'membro'),
                el('div', { class: 'flex items-center gap-1.5 mt-0.5' },
                  roleBadge,
                  m.id === state.user.id && el('span', { class: 'text-[11px] text-slate-400' }, 'você'),
                ),
              ),
              isFounder && !m.isFounder && el('div', { class: 'flex items-center gap-1 shrink-0' },
                el('button', {
                  class: 'text-xs text-cyan-700 hover:bg-cyan-50 px-2 py-0.5 rounded',
                  title: m.role === 'viewer' ? 'Promover a Editor' : 'Rebaixar a Leitor',
                  onClick: async () => {
                    const next = m.role === 'viewer' ? 'editor' : 'viewer';
                    try {
                      await api.setMemberRole(m.id, next);
                      await renderBody();
                    } catch (err) { alert('Erro: ' + err.message); }
                  },
                }, m.role === 'viewer' ? '↑ Editor' : '↓ Leitor'),
                el('button', {
                  class: 'text-xs text-rose-700 hover:bg-rose-50 px-2 py-0.5 rounded',
                  title: 'Remover acesso',
                  onClick: async () => {
                    if (!confirm(`Remover ${m.email} da família?\n\nEla perde acesso aos atletas. Os atletas que ela criou aqui permanecem.`)) return;
                    try {
                      await api.removeMember(m.id);
                      await renderBody();
                    } catch (err) { alert('Erro: ' + err.message); }
                  },
                }, 'Remover'),
              ),
            );
          }),
        ),
      ));
    }

    // Convites pendentes
    let invitesData;
    try { invitesData = await api.listInvites(); } catch { invitesData = { invites: [] }; }
    const pending = (invitesData.invites || []).filter(i => !i.acceptedBy && new Date(i.expiresAt) > new Date());
    if (pending.length) {
      const origin = window.location.origin;
      body.appendChild(el('div', { class: 'pt-3 border-t border-slate-200' },
        el('h4', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2' }, 'Convites pendentes'),
        el('ul', { class: 'space-y-2' },
          ...pending.map(inv => {
            const url = `${origin}/?invite=${inv.token}`;
            const linkInput = el('input', {
              type: 'text', value: url, readonly: 'readonly',
              class: 'flex-1 text-xs bg-slate-50 border border-slate-300 rounded px-2 py-1 font-mono',
              onClick: (e) => e.target.select(),
            });
            const copyBtn = el('button', {
              type: 'button',
              class: 'shrink-0 text-xs rounded bg-slate-700 hover:bg-slate-800 text-white px-2 py-1',
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  copyBtn.textContent = 'Copiado!';
                  setTimeout(() => copyBtn.textContent = 'Copiar', 1500);
                } catch { linkInput.select(); document.execCommand('copy'); }
              },
            }, 'Copiar');
            const wppBtn = el('a', {
              href: `https://wa.me/?text=${encodeURIComponent('Você foi convidado pra ver os atletas no Tennis Flow: ' + url)}`,
              target: '_blank', rel: 'noopener',
              class: 'shrink-0 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1',
            }, 'WhatsApp');
            const revokeBtn = el('button', {
              type: 'button',
              class: 'shrink-0 text-xs rounded text-rose-700 hover:bg-rose-50 px-2 py-1',
              onClick: async () => {
                if (!confirm('Revogar este convite?')) return;
                await api.revokeInvite(inv.token);
                renderBody();
              },
            }, '🗑');
            const roleTag = el('span', {
              class: `text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${inv.role === 'viewer' ? 'bg-slate-200 text-slate-700' : 'bg-cyan-100 text-cyan-800'}`,
            }, inv.role === 'viewer' ? 'Leitor' : 'Editor');
            return el('li', null,
              el('div', { class: 'flex items-center gap-2 mb-1' },
                inv.label && el('span', { class: 'text-xs text-slate-600' }, inv.label),
                roleTag,
              ),
              el('div', { class: 'flex items-center gap-1' }, linkInput, copyBtn, wppBtn, revokeBtn),
            );
          }),
        ),
      ));
    }
  };

  renderBody();
}

async function logout() {
  await api.logout();
  state.user = null;
  state.profiles = [];
  state.activeProfileId = null;
  state.data = null;
  localStorage.removeItem('activeProfileId');
  init();
}

async function refreshActive() {
  if (!state.activeProfileId) { state.data = null; return; }
  state.data = await api.getTournaments(state.activeProfileId);
  // Carrega contador de alertas e dispara popup automático na primeira vez
  // que abrir o app com eventos pendentes.
  try {
    const unseen = await api.listAlerts(state.activeProfileId, { unseen: true });
    state.unseenAlertsCount = unseen.length;
    updateAppBadge(unseen.length);
    if (!state.alertOnLoadShown && unseen.length > 0) {
      state.alertOnLoadShown = true;
      setTimeout(() => openAlertsListModal({ onlyUnseen: true }), 400);
    }
  } catch {}
}

let pollTimer = null;
async function pollSyncStatus() {
  if (pollTimer) clearTimeout(pollTimer);
  if (!state.activeProfileId) return;
  try {
    const s = await api.syncStatus(state.activeProfileId);
    const wasRunning = state.syncStatus?.state === 'running';
    state.syncStatus = s;
    if (typeof s.unseenAlerts === 'number') {
      state.unseenAlertsCount = s.unseenAlerts;
      updateAppBadge(s.unseenAlerts);
    }
    if (wasRunning && s.state !== 'running') {
      await refreshActive();
      render();
      // Não auto-abre se o modal de progresso de sync ainda está aberto —
      // o usuário verá o "X alertas novos" no resumo e pode clicar no sino.
    } else {
      renderHeader();
    }
    if (typeof refreshSyncProgressModal === 'function') refreshSyncProgressModal();
  } catch {}
  pollTimer = setTimeout(pollSyncStatus, state.syncStatus?.state === 'running' ? 2000 : 30000);
}

// ===== Render =====
function render() {
  const root = $('app');
  root.innerHTML = '';
  // Reset modes — renderKanban / renderAuth re-adicionam quando precisam
  document.body.classList.remove('kanban-mode', 'auth-mode');
  root.appendChild(renderHeaderEl());

  if (!state.activeProfileId) {
    root.appendChild(renderEmptyState());
    return;
  }
  if (!state.data) {
    document.body.classList.add('kanban-mode');
    root.appendChild(el('div', { class: 'mt-8 text-center text-slate-500' }, 'Carregando...'));
    return;
  }

  const tournaments = state.data.tournaments || [];

  if (tournaments.length === 0) {
    // Mantém o tema navy mesmo sem torneios — senão a tela "fica branca"
    // pós-reset e parece quebrada até a primeira sync popular o quadro.
    document.body.classList.add('kanban-mode');
    root.appendChild(renderNeedSync());
    return;
  }

  root.appendChild(renderKanban(tournaments));
}

// ===== Timeline (single sectioned list) =====
const DAY = 24 * 60 * 60 * 1000;

function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function endOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); }

// ===== Estado computado por torneio (cor do card + flags visuais) =====
const NEW_BADGE_DAYS = 7;

function isBoletoExpired(t) {
  const pp = t.pendingPayment;
  if (!pp?.dueDate) return false;
  const due = brToDate(pp.dueDate);
  return due && due < startOfToday();
}

// Status de inscrição do TI — mantém em sincronia com backend/board.js.
// "Iniciado" no TI significa que o período COMEÇOU, mas pode já ter
// terminado se cancelDeadline ou startDate passaram. Aceita string OU
// objeto torneio (preferir objeto pra usar as datas).
function regStatusClosed(s) {
  if (typeof s === 'object') s = s?.registrationStatus || '';
  return !!s && /encerrad|finalizad/i.test(s);
}
function regStatusOpen(t) {
  if (!t) return false;
  const s = typeof t === 'string' ? t : (t.registrationStatus || '');
  if (regStatusClosed(s)) return false;
  if (/Aberto|aberta/i.test(s)) {
    if (typeof t === 'object' && t.cancelDeadline) {
      const d = brToDate(t.cancelDeadline);
      if (d && d < startOfToday()) return false;
    }
    return true;
  }
  if (/inicia/i.test(s)) {
    if (typeof t !== 'object') return true;
    if (t.cancelDeadline) {
      const d = brToDate(t.cancelDeadline);
      if (d && d < startOfToday()) return false;
    }
    if (t.startDate) {
      const d = brToDate(t.startDate);
      if (d && d < startOfToday()) return false;
    }
    return true;
  }
  return false;
}

function isRegistrationClosed(t, inscribed) {
  // Already inscribed → not "missed it"
  if (inscribed) return false;
  // TI explicit signal in catalog row
  if (regStatusClosed(t.registrationStatus)) return true;
  // Cancellation deadline already passed
  if (t.cancelDeadline) {
    const cd = brToDate(t.cancelDeadline);
    if (cd && cd < startOfToday()) return true;
  }
  // Tournament already started (= no longer accepting)
  const start = brToDate(t.startDate);
  if (start && start <= startOfToday()) return true;
  return false;
}

function isNewlyAdded(t) {
  if (!t.firstSeenAt) return false;
  const ms = Date.now() - new Date(t.firstSeenAt).getTime();
  return ms >= 0 && ms < NEW_BADGE_DAYS * DAY;
}

function daysFromToday(date) {
  if (!date) return null;
  return Math.round((date.getTime() - startOfToday().getTime()) / DAY);
}


function relativeDateLabel(t) {
  const start = brToDate(t.startDate);
  const end = brToDate(t.endDate) || start;
  const today = startOfToday();
  if (!start) return 'sem data';
  if (start <= today && end >= today) return 'em andamento agora';
  const dStart = daysFromToday(start);
  if (dStart < 0) {
    const dEnd = daysFromToday(end);
    if (dEnd === 0) return 'terminou hoje';
    if (dEnd === -1) return 'terminou ontem';
    if (dEnd > -7) return `terminou há ${-dEnd} dias`;
    if (dEnd > -30) return `terminou há ${Math.round(-dEnd / 7)} semanas`;
    const months = Math.round(-dEnd / 30);
    return `terminou há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  }
  if (dStart === 0) return 'começa hoje';
  if (dStart === 1) return 'começa amanhã';
  if (dStart < 14) return `daqui ${dStart} dias`;
  if (dStart < 60) return `daqui ${Math.round(dStart / 7)} semanas`;
  return `daqui ${Math.round(dStart / 30)} ${Math.round(dStart / 30) === 1 ? 'mês' : 'meses'}`;
}

// Normaliza pra busca: lowercase + remove acentos (Belém → belem,
// São Paulo → sao paulo). Permite busca insensível a diacríticos.
function normalizeForSearch(s) {
  if (!s) return '';
  // ̀-ͯ = bloco "Combining Diacritical Marks" (acentos isolados
  // após NFD: é → e + ´). Removendo, sobra a letra base.
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function applyHeaderFilters(tournaments) {
  const f = state;
  const q = normalizeForSearch((f.searchQuery || '').trim());
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  return tournaments.filter(t => {
    if (f.filterUFs.length && !f.filterUFs.includes(t.state)) return false;
    if (f.filterTiers.length) {
      const tiers = (t.tiers && t.tiers.length) ? t.tiers : (t.tier ? [t.tier] : []);
      if (!tiers.some(x => f.filterTiers.includes(x))) return false;
    }
    if (f.filterYears.length) {
      const y = startYearOf(t);
      if (!y || !f.filterYears.includes(y)) return false;
    }
    if (terms.length) {
      const haystack = normalizeForSearch([
        t.name, t.city, t.state,
        ...(t.tiers || []), t.tier,
        ...(t.labels || []).map(L => L.name),
      ].filter(Boolean).join(' '));
      if (!terms.every(term => haystack.includes(term))) return false;
    }
    return true;
  });
}

// ===== Kanban =====
// Labels, ordem e ícones têm que bater com backend/board.js. Mantém ids estáveis.
const KANBAN_COLUMNS = [
  { id: 'vou_jogar',           label: 'Monitorar',          icon: '⭐' },
  { id: 'inscricoes_abertas', label: 'Inscrições Abertas', icon: '🌟' },
  { id: 'pagar_inscricao',     label: 'Pagar inscrição',    icon: '💰' },
  { id: 'confirmado',          label: 'Confirmado',         icon: '🎾' },
  { id: 'viagem_comprada',     label: 'Viagem comprada',    icon: '✈️' },
  { id: 'torneios',            label: 'Não vou jogar',      icon: '❌' },
  { id: 'historico',           label: 'Arquivados',         icon: '📦' },
];
const KANBAN_COLUMN_IDS = KANBAN_COLUMNS.map(c => c.id);

function orderedKanbanColumns() {
  const order = state.columnOrder;
  if (!Array.isArray(order) || !order.length) return KANBAN_COLUMNS;
  const ordered = order.map(id => KANBAN_COLUMNS.find(c => c.id === id)).filter(Boolean);
  const remaining = KANBAN_COLUMNS.filter(c => !order.includes(c.id));
  return [...ordered, ...remaining];
}

// Mantém em sincronia com backend/board.js#getRegistrationWindowState.
// Lógica por dia (sem corte de hora) — TI tem 16h pra inscrição e
// 23:59 pra cancelamento, mas mostramos isso no texto, não na regra.
function getWindowState(t) {
  if (!t) return 'unknown';
  const s = t.registrationStatus || '';
  const today = startOfToday();
  const regOpens = t.registrationOpensAt ? brToDate(t.registrationOpensAt) : null;
  const regDeadline = t.registrationDeadline ? brToDate(t.registrationDeadline) : null;
  // Datas vencem o texto quando temos a janela completa
  if (regOpens && regDeadline) {
    if (regDeadline < today) return 'closed';
    if (regOpens > today) return 'pending';
    return 'open';
  }
  if (regDeadline) {
    if (regDeadline < today) return 'closed';
    if (!regStatusClosed(s)) return 'open';
  }
  if (!regDeadline && t.cancelDeadline) {
    const d = brToDate(t.cancelDeadline);
    if (d && d < today) return 'closed';
  }
  if (regOpens && !regDeadline) {
    if (regOpens > today) return 'pending';
  }
  if (regStatusClosed(s)) return 'closed';
  if (/a\s*iniciar/i.test(s)) return 'pending';
  if (/Aberto|aberta|inicia/i.test(s)) return 'open';
  return 'unknown';
}

// Auto-coluna — mesma priority order do backend/board.js#computeAutoColumn
function autoColumnFor(t) {
  const status = t.derivedStatus || 'unknown';
  if (status === 'past') return 'historico';

  const notes = t.notes || {};
  if (notes.manualGiveUp) return 'torneios';

  const pp = t.pendingPayment;
  const inscribed = t.isAnnaInscribed || notes.manualInscribed;
  const confirmed = t.isAnnaConfirmada;

  if (inscribed && pp?.dueDate) {
    const d = brToDate(pp.dueDate);
    if (d && d < startOfToday()) return 'torneios';
  }
  // Boleto pendente vence "Confirmada" — TI às vezes marca confirmada
  // mesmo sem pagamento; ação do user é pagar.
  if (inscribed && pp) return 'pagar_inscricao';
  if (confirmed) return 'confirmado';
  if (inscribed) return 'pagar_inscricao';

  const win = getWindowState(t);
  if (win === 'open') return 'inscricoes_abertas';
  if (win === 'closed') return 'torneios';
  return 'vou_jogar';
}

function effectiveColumnFor(t) {
  const auto = autoColumnFor(t);
  if (auto === 'historico') return 'historico';
  const userCol = t.notes?.column;
  if (userCol && KANBAN_COLUMN_IDS.includes(userCol)) return userCol;
  return auto;
}

function renderKanban(allTournaments) {
  document.body.classList.add('kanban-mode');
  const tournaments = applyHeaderFilters(allTournaments);

  // Resolve a ordem das colunas conforme preferência do usuário, depois
  // filtra as ocultas (cards continuam agrupados pra reaparecer ao mostrar)
  const allOrderedColumns = state.columnOrder
    ? [
        ...state.columnOrder.map(id => KANBAN_COLUMNS.find(c => c.id === id)).filter(Boolean),
        ...KANBAN_COLUMNS.filter(c => !state.columnOrder.includes(c.id)),
      ]
    : KANBAN_COLUMNS;
  const orderedColumns = allOrderedColumns.filter(c => !state.hiddenColumns.includes(c.id));

  // Group by column
  const cardsByColumn = Object.fromEntries(KANBAN_COLUMN_IDS.map(c => [c, []]));
  for (const t of tournaments) {
    const col = effectiveColumnFor(t);
    if (!cardsByColumn[col]) cardsByColumn[col] = [];
    cardsByColumn[col].push(t);
  }
  // Sort within each column: pinados primeiro, depois cardOrder manual, depois data
  const sortForColumn = (colId) => {
    const dir = state.columnSort[colId] === 'desc' ? 'desc' : 'asc';
    return (a, b) => {
      const pa = !!a.notes?.pinned, pb = !!b.notes?.pinned;
      if (pa !== pb) return pa ? -1 : 1;
      const oa = a.notes?.cardOrder, ob = b.notes?.cardOrder;
      if (typeof oa === 'number' && typeof ob === 'number') return oa - ob;
      if (typeof oa === 'number') return -1;
      if (typeof ob === 'number') return 1;
      const da = brToIso(a.startDate) || 'zzzz';
      const db = brToIso(b.startDate) || 'zzzz';
      return dir === 'desc' ? db.localeCompare(da) : da.localeCompare(db);
    };
  };
  for (const c of orderedColumns) cardsByColumn[c.id].sort(sortForColumn(c.id));

  const container = el('div', { id: 'kanban-board', class: 'mt-2 sm:mt-4 flex flex-col min-h-0' },
    el('div', {
      id: 'kanban-col-row',
      class: 'flex-1 min-h-0 flex gap-2 sm:gap-3 overflow-x-auto pb-2 px-1 -mx-1',
      style: 'scroll-snap-type: x proximity;',
    },
      ...orderedColumns.map(col => renderKanbanColumn(col, cardsByColumn[col.id] || [])),
    ),
  );

  // Wire SortableJS after render (next tick)
  setTimeout(() => wireKanbanSortable(container), 0);

  return container;
}

function renderEditableColumnLabel(col) {
  const current = state.columnLabels[col.id] || col.label;
  const span = el('span', {
    class: 'truncate cursor-text px-1 -mx-1 rounded hover:bg-white/10 outline-none',
    contenteditable: 'true',
    spellcheck: 'false',
    title: 'Clique pra renomear',
  }, current);
  // Impede que o drag da coluna inicie quando o usuário clica pra editar
  span.addEventListener('mousedown', (e) => e.stopPropagation());
  span.addEventListener('click', (e) => e.stopPropagation());
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
    if (e.key === 'Escape') { span.textContent = current; span.blur(); }
  });
  span.addEventListener('blur', async () => {
    const next = span.textContent.trim();
    if (!next || next === current) { span.textContent = current; return; }
    if (next === col.label) delete state.columnLabels[col.id];
    else state.columnLabels[col.id] = next.slice(0, 40);
    try { await api.updateBoardConfig({ columnLabels: state.columnLabels }); }
    catch (err) { alert('Erro ao salvar nome: ' + err.message); }
  });
  return span;
}

function renderKanbanColumn(col, cards) {
  const list = el('div', {
    class: 'kanban-list flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 p-2',
    'data-column': col.id,
  });
  for (const t of cards) list.appendChild(renderKanbanCard(t));

  const sortDir = state.columnSort[col.id] === 'desc' ? 'desc' : 'asc';
  const sortIcon = sortDir === 'desc' ? '↓' : '↑';
  const sortTitle = sortDir === 'desc'
    ? 'Ordenado: mais recente primeiro (click pra inverter)'
    : 'Ordenado: mais antigo primeiro (click pra inverter)';

  return el('div', {
    class: 'kanban-col rounded-lg shrink-0 w-72 sm:w-80 flex flex-col text-slate-100 max-h-full',
    'data-column-id': col.id,
    style: 'scroll-snap-align: start;',
  },
    // Header da coluna — fixo no topo, serve de handle pra drag-drop
    el('div', { class: 'kanban-col-header shrink-0 px-3 py-2 flex items-center justify-between gap-2 border-b border-white/10 cursor-grab hover:bg-white/5' },
      el('div', { class: 'flex items-center gap-2 font-medium text-sm min-w-0 flex-1' },
        el('span', { class: 'text-base shrink-0' }, col.icon),
        renderEditableColumnLabel(col),
      ),
      el('div', { class: 'flex items-center gap-1.5 shrink-0' },
        el('button', {
          class: 'text-xs text-white/60 hover:text-white px-1 cursor-pointer',
          title: sortTitle,
          onClick: async (e) => {
            e.stopPropagation();
            state.columnSort[col.id] = sortDir === 'desc' ? 'asc' : 'desc';
            localStorage.setItem('columnSort', JSON.stringify(state.columnSort));
            // Limpa cardOrder dos cards da coluna pra que o sort por data
            // volte a ter efeito (drag-drop atribui cardOrder a todos os irmãos).
            const tids = cards.map(t => t.id);
            if (tids.length) {
              cards.forEach(t => { if (t.notes) t.notes.cardOrder = null; });
              try { await api.clearCardOrder(state.activeProfileId, tids); } catch {}
            }
            rerenderBody();
          },
        }, sortIcon),
        el('span', { class: 'text-xs text-white/60' }, String(cards.length)),
      ),
    ),
    list,
    // Footer fixo — mantém uma faixa azul visível no fim da coluna,
    // do mesmo tamanho do gap entre cards (8px).
    el('div', { class: 'shrink-0 h-2' }),
  );
}

// Estado UI por card: tarja expandida (mostra texto) ou colapsada (só a barra).
const expandedLabelCards = new Set();

// ===== Card actions (3 pontinhos) =====
function openCardActions(anchorEl, t) {
  // Fecha popover existente
  const existing = document.getElementById('card-actions-popover');
  if (existing) { existing.remove(); return; }

  const isPinned = !!t.notes?.pinned;
  const pop = el('div', {
    id: 'card-actions-popover',
    class: 'fixed z-[60] bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px]',
    style: 'color:#0f172a;',
    onClick: (e) => e.stopPropagation(),
  },
    el('button', {
      class: 'w-full text-left px-3 py-2 text-sm hover:bg-slate-100',
      onClick: () => { pop.remove(); togglePinCard(t); },
    }, isPinned ? 'Desfixar' : 'Fixar no topo'),
    el('button', {
      class: 'w-full text-left px-3 py-2 text-sm hover:bg-slate-100',
      onClick: () => { pop.remove(); shareCardWhatsApp(t); },
    }, 'Compartilhar'),
  );

  // Posiciona off-screen primeiro pra forçar layout antes de medir.
  // Sem isso, na primeira renderização o offsetWidth pode vir 0 ou
  // o popover aparece brevemente em posição default antes do reposicionamento.
  pop.style.left = '-9999px';
  pop.style.top = '-9999px';
  pop.style.visibility = 'hidden';
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  const popW = pop.offsetWidth || 200;
  const popH = pop.offsetHeight || 80;
  let left = r.right - popW;
  let top = r.bottom + 4;
  left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
  if (top + popH > window.innerHeight - 8) top = r.top - popH - 4;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.visibility = 'visible';

  // Fecha ao clicar fora ou pressionar Esc
  const onAway = (ev) => {
    if (!pop.contains(ev.target) && ev.target !== anchorEl) { pop.remove(); cleanup(); }
  };
  const onKey = (ev) => { if (ev.key === 'Escape') { pop.remove(); cleanup(); } };
  const cleanup = () => {
    document.removeEventListener('click', onAway, true);
    document.removeEventListener('keydown', onKey);
  };
  setTimeout(() => {
    document.addEventListener('click', onAway, true);
    document.addEventListener('keydown', onKey);
  }, 0);
}

async function togglePinCard(t) {
  const next = !t.notes?.pinned;
  // Optimistic
  t.notes = { ...(t.notes || {}), pinned: next };
  rerenderBody();
  try {
    await api.updateNotes(state.activeProfileId, t.id, { pinned: next });
  } catch (err) {
    t.notes.pinned = !next;
    rerenderBody();
    alert('Erro ao fixar: ' + err.message);
  }
}

function buildShareText(t, { includeUrl = true, shareUrl = null } = {}) {
  // Sem emojis no corpo: alguns dispositivos/cadeias (Safari→WhatsApp,
  // wa.me, etc) corrompem caracteres fora do BMP e renderizam "?" ou "�".
  // Layout limpo com labels também escala melhor em fonte pequena.
  // O preview rico (via og:tags do /share) é o que entrega o visual.
  const tiers = (t.tiers && t.tiers.length) ? t.tiers : (t.tier ? [t.tier] : []);
  const where = [t.city, t.state].filter(Boolean).join(' / ');
  const dates = t.startDate
    ? (t.endDate && t.endDate !== t.startDate ? `${t.startDate} a ${t.endDate}` : t.startDate)
    : null;
  const win = getWindowState(t);
  const regDateText = (t.registrationStatus || '').match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || null;
  const closeDate = t.registrationDeadline || regDateText || t.cancelDeadline;
  const regOpen = win === 'open';
  const regClosed = win === 'closed';
  // Só mostra "Inscrições" se for info real de janela (aberta/encerrada).
  // Status do atleta tipo "Confirmado", "Pendente" não cabem aqui — são
  // privados e confundem quem recebe o link.
  let regLine = null;
  if (regOpen) regLine = closeDate ? `abertas até ${closeDate}` : 'abertas';
  else if (regClosed) regLine = closeDate ? `encerraram em ${closeDate}` : 'encerradas';
  else if (win === 'pending') regLine = t.registrationOpensAt ? `abrem em ${t.registrationOpensAt}` : 'a iniciar';
  const lines = [];
  lines.push(`*${t.name || 'Torneio'}*`);
  if (where) lines.push(`Local: ${where}`);
  if (dates) lines.push(`Datas: ${dates}`);
  if (tiers.length) lines.push(`Chave: ${tiers.join(' · ')}`);
  if (regLine) lines.push(`Inscrições: ${regLine}`);
  if (includeUrl) {
    const url = shareUrl || t.url;
    if (url) {
      lines.push('');
      lines.push(`Abrir torneio: ${url}`);
    }
  }
  lines.push('');
  lines.push('— Compartilhado via Tennis Flow');
  return lines.join('\n');
}

async function shareCardWhatsApp(t) {
  let shareUrl = null;
  try {
    const r = await api.createShareLink(state.activeProfileId, t.id);
    shareUrl = r.url;
  } catch (err) {
    console.warn('share link falhou, caindo pro link do TI', err);
  }
  // Web Share API: passa URL no campo `url` (vira preview card) e texto
  // SEM o link embutido — senão WhatsApp duplica (preview + URL crua).
  if (navigator.share && shareUrl) {
    const text = buildShareText(t, { includeUrl: false });
    try {
      await navigator.share({
        title: `${t.name || 'Torneio'} — Tennis Flow`,
        text,
        url: shareUrl,
      });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  // Fallback (desktop / sem Web Share): inclui URL no texto + abre wa.me
  const text = buildShareText(t, { includeUrl: true, shareUrl });
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function renderKanbanCard(t) {
  const selected = !!t.notes?.selected;
  const cityState = [t.city, t.state].filter(Boolean).join(' / ');
  const labels = t.labels || [];
  const isExpanded = expandedLabelCards.has(t.id);

  const labelsRow = labels.length > 0 && (isExpanded
    // Modo expandido: pílulas com nome (tiers em "selo" sólido)
    ? el('div', { class: 'flex flex-wrap gap-1 mb-1.5' },
        ...labels.map(L => el('span', {
          class: L.tier
            ? `text-[11px] px-1.5 py-0.5 rounded font-bold tracking-wide ${tierBadgeClass(L.color)}`
            : `text-[11px] px-1.5 py-0.5 rounded font-medium ${labelExpandedClass(L.color)}`,
          title: L.auto ? `${L.name} (automática)` : L.name,
        }, L.name)),
      )
    // Modo colapsado: tarjinhas (tiers usam tom escuro pra destacar)
    : el('div', { class: 'flex flex-wrap gap-1 mb-1.5' },
        ...labels.map(L => el('span', {
          class: `h-1.5 w-8 rounded-full ${L.tier ? tierStripClass(L.color) : labelStripClass(L.color)}`,
          title: L.name,
        }))));

  const onLabelClick = (e) => {
    e.stopPropagation();
    if (expandedLabelCards.has(t.id)) expandedLabelCards.delete(t.id);
    else expandedLabelCards.add(t.id);
    rerenderBody();
  };

  const isPinned = !!t.notes?.pinned;
  return el('article', {
    class: `kanban-card relative bg-white text-slate-900 rounded-md p-2.5 shadow-sm cursor-pointer hover:shadow-md ${isPinned ? 'ring-2 ring-amber-300' : ''}`,
    'data-tid': t.id,
    onClick: () => openTournament(t.id),
  },
    // Botão de 3 pontinhos no canto superior direito
    el('button', {
      class: 'absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 leading-none',
      title: 'Ações',
      'aria-label': 'Ações do torneio',
      // Stop mousedown também — senão SortableJS pode interpretar como início de drag
      onMousedown: (e) => e.stopPropagation(),
      onTouchstart: (e) => e.stopPropagation(),
      onClick: (e) => { e.stopPropagation(); openCardActions(e.currentTarget, t); },
    }, '⋯'),
    isPinned && el('span', {
      class: 'absolute top-1 right-8 text-amber-500 text-xs',
      title: 'Fixado no topo',
    }, '📌'),

    labelsRow && el('div', { onClick: onLabelClick, title: 'Click pra expandir/colapsar etiquetas' }, labelsRow),

    // Chip da coluna — só aparece quando há busca ativa, pra ajudar
    // o usuário a localizar em qual coluna o card está (útil no mobile
    // que mostra uma coluna por vez).
    (state.searchQuery && state.searchQuery.trim()) && (() => {
      const colId = effectiveColumnFor(t);
      const col = KANBAN_COLUMNS.find(c => c.id === colId);
      const label = state.columnLabels[colId] || col?.label || colId;
      return el('div', {
        class: 'mb-1 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-800 border border-cyan-200',
      },
        el('span', null, col?.icon || '🏷️'),
        el('span', null, label),
      );
    })(),

    el('div', { class: 'flex items-start gap-1.5 mb-0.5' },
      el('h3', { class: 'text-sm font-medium leading-snug line-clamp-2 pr-12 flex-1' }, t.name || '(sem nome)'),
      isNewlyAdded(t) && el('span', {
        class: 'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 leading-none mt-0.5',
      }, 'NOVO'),
    ),

    el('div', { class: 'text-xs text-slate-600 flex items-center justify-between gap-2' },
      el('span', { class: 'truncate' }, cityState || '—'),
      el('span', { class: `shrink-0 font-semibold ${cardDateColor(t)}` }, formatCardDate(t)),
    ),

    el('div', { class: 'mt-1.5 flex items-center justify-between gap-2' },
      cardMetaRow(t) || el('span'),
      el('button', {
        class: `text-base leading-none shrink-0 ${selected ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`,
        title: selected ? 'Remover do calendário' : 'Adicionar ao calendário',
        onClick: (e) => { e.stopPropagation(); toggleSelected(t); },
      }, selected ? '★' : '☆'),
    ),
  );
}

function cardMetaRow(t) {
  const comments = t.commentsCount || 0;
  const receipts = t.receiptsCount || 0;
  const days = daysUntilStart(t);
  if (!comments && !receipts && days === null) return null;

  const items = [];
  if (comments) items.push(el('span', { class: 'inline-flex items-center gap-0.5', title: `${comments} comentário(s)` }, '💬', String(comments)));
  if (receipts) items.push(el('span', { class: 'inline-flex items-center gap-0.5', title: `${receipts} comprovante(s)` }, '📎', String(receipts)));
  if (days !== null) {
    const label = days === 0 ? 'hoje' : (days > 0 ? `${days}d` : `${days}d`);
    const cls = days < 0
      ? 'text-slate-400'
      : days <= 7 ? 'text-amber-700' : 'text-slate-500';
    items.push(el('span', { class: `inline-flex items-center gap-0.5 ${cls}`, title: 'Dias até o início' }, '⏳', label));
  }
  if (!items.length) return null;
  return el('div', { class: 'flex items-center gap-2 text-[11px] text-slate-500' }, ...items);
}

function daysUntilStart(t) {
  if (!t.startDate) return null;
  const iso = brToIso(t.startDate);
  if (!iso) return null;
  const start = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((start - today) / 86400000);
}

function cardDateColor(t) {
  if (t.finished || t.derivedStatus === 'past') return 'text-slate-400';
  const days = daysUntilStart(t);
  if (days === null) return 'text-slate-500';
  if (days <= 0) return 'text-emerald-600';   // em andamento ou hoje
  if (days <= 7) return 'text-amber-600';      // até 7 dias
  return 'text-cyan-700';                      // futuro normal
}

// ===== Etiquetas: seção do modal + picker =====
function renderLabelsSection(t) {
  const labels = t.labels || [];
  const wrapper = el('section', { id: `labels-${t.id}` },
    el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, '🏷️ Etiquetas'),
    el('div', { class: 'flex flex-wrap gap-1.5 items-center' },
      ...labels.map(L => el('span', {
        class: L.tier
          ? `text-xs px-2 py-1 rounded font-bold tracking-wide inline-flex items-center gap-1 ${tierBadgeClass(L.color)}`
          : `text-xs px-2 py-1 rounded font-medium inline-flex items-center gap-1 ${labelExpandedClass(L.color)}`,
        title: L.auto ? `${L.name} (automática — vem do Tênis Integrado)` : L.name,
      }, L.name, L.auto && el('span', { class: 'text-[10px] opacity-60' }, '🔒')),
      ),
      el('button', {
        class: 'text-xs px-2 py-1 rounded border border-dashed border-slate-300 text-slate-600 hover:bg-slate-100',
        onClick: (e) => { e.stopPropagation(); openLabelPicker(t); },
      }, '+ Etiqueta'),
    ),
  );
  return wrapper;
}

async function openLabelPicker(t) {
  const profileId = state.activeProfileId;
  const root = $('modal-root');
  const overlay = el('div', { class: 'fixed inset-0 bg-black/40 z-[60]' });
  const panel = el('div', { class: 'fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none' });
  const card = el('div', { class: 'pointer-events-auto bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden' });
  panel.appendChild(card);
  const close = () => { overlay.remove(); panel.remove(); };
  overlay.onclick = close;

  // Header
  card.appendChild(el('div', { class: 'shrink-0 px-4 py-3 border-b border-slate-200 flex items-center justify-between' },
    el('h3', { class: 'text-base font-semibold text-slate-900' }, '🏷️ Etiquetas'),
    el('button', { class: 'text-slate-500 hover:text-slate-900 text-xl leading-none', onClick: close }, '×'),
  ));

  const body = el('div', { class: 'flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3' });
  card.appendChild(body);

  body.appendChild(el('div', { class: 'text-xs text-slate-500' }, 'Carregando...'));

  let allManual = [];
  let appliedIds = new Set(t.notes?.labelIds || []);

  async function reload() {
    const data = await api.listLabels(profileId);
    allManual = data.labels || [];
    drawList();
  }

  function drawList() {
    body.innerHTML = '';

    // Auto labels (read-only) — listadas no topo, com cadeado
    const autoLabels = (t.labels || []).filter(L => L.auto);
    if (autoLabels.length > 0) {
      body.appendChild(el('div', null,
        el('div', { class: 'text-xs text-slate-500 mb-1.5' }, 'Automáticas (do Tênis Integrado)'),
        el('div', { class: 'flex flex-wrap gap-1.5' },
          ...autoLabels.map(L => el('span', {
            class: L.tier
              ? `text-xs px-2 py-1 rounded font-bold tracking-wide inline-flex items-center gap-1 ${tierBadgeClass(L.color)}`
              : `text-xs px-2 py-1 rounded font-medium inline-flex items-center gap-1 ${labelExpandedClass(L.color)}`,
            title: 'Não dá pra editar — controle do sistema',
          }, L.name, el('span', { class: 'text-[10px] opacity-60' }, '🔒'))),
        ),
      ));
    }

    // Manual labels — selecionar/desselecionar
    body.appendChild(el('div', { class: 'pt-2 border-t border-slate-200' },
      el('div', { class: 'text-xs text-slate-500 mb-1.5 flex items-center justify-between' },
        el('span', null, 'Suas etiquetas'),
        el('button', {
          class: 'text-xs text-emerald-700 hover:underline',
          onClick: () => openLabelEditor(null),
        }, '+ Criar nova'),
      ),
      el('ul', { class: 'space-y-1' },
        ...allManual.map(L => {
          const checked = appliedIds.has(L.id);
          const row = el('li', { class: 'flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-50' });
          const cb = el('input', { type: 'checkbox', class: 'h-4 w-4 cursor-pointer' });
          cb.checked = checked;
          cb.onchange = async () => {
            if (cb.checked) appliedIds.add(L.id); else appliedIds.delete(L.id);
            const newIds = [...appliedIds];
            t.notes = { ...(t.notes || {}), labelIds: newIds };
            try {
              await api.updateNotes(profileId, t.id, { labelIds: newIds });
              // Refresh modal label section + card
              const sec = $(`labels-${t.id}`);
              if (sec) {
                // Reflect locally — server has computed labels but we know what changed
                const replaced = renderLabelsSection({ ...t, labels: [
                  ...(t.labels || []).filter(x => x.auto),
                  ...allManual.filter(x => appliedIds.has(x.id)).map(x => ({ ...x, auto: false })),
                ] });
                sec.replaceWith(replaced);
                t.labels = [
                  ...(t.labels || []).filter(x => x.auto),
                  ...allManual.filter(x => appliedIds.has(x.id)).map(x => ({ ...x, auto: false })),
                ];
              }
              rerenderBody();
            } catch (err) {
              cb.checked = !cb.checked;
              if (cb.checked) appliedIds.add(L.id); else appliedIds.delete(L.id);
              alert('Erro: ' + err.message);
            }
          };
          row.append(
            cb,
            el('span', { class: `text-xs px-2 py-0.5 rounded font-medium ${labelExpandedClass(L.color)}` }, L.name),
            el('div', { class: 'ml-auto flex gap-1 text-xs' },
              el('button', {
                class: 'text-slate-500 hover:text-slate-800 px-1',
                onClick: () => openLabelEditor(L),
                title: 'Editar',
              }, '✎'),
              el('button', {
                class: 'text-red-600 hover:text-red-800 px-1',
                onClick: async () => {
                  if (!confirm(`Excluir etiqueta "${L.name}"? Será removida de todos os torneios.`)) return;
                  await api.deleteLabel(profileId, L.id);
                  appliedIds.delete(L.id);
                  await reload();
                  rerenderBody();
                },
                title: 'Excluir',
              }, '🗑'),
            ),
          );
          return row;
        }),
        allManual.length === 0 && el('li', { class: 'text-xs text-slate-500 italic px-1' }, 'Nenhuma etiqueta criada ainda. Use "+ Criar nova".'),
      ),
    ));
  }

  function openLabelEditor(existing) {
    const editorOverlay = el('div', { class: 'fixed inset-0 bg-black/30 z-[62]' });
    const editorPanel = el('div', { class: 'fixed inset-0 z-[63] flex items-center justify-center p-4' });
    const editorCard = el('div', { class: 'bg-white rounded-lg shadow-xl w-full max-w-sm p-4 space-y-3' });
    editorPanel.appendChild(editorCard);
    const closeEditor = () => { editorOverlay.remove(); editorPanel.remove(); };
    editorOverlay.onclick = closeEditor;

    const isEdit = !!existing;
    const colors = ['emerald', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose', 'red', 'orange', 'amber', 'yellow', 'slate', 'gray'];
    let selectedColor = existing?.color || 'emerald';

    const nameInp = el('input', {
      type: 'text', placeholder: 'Nome da etiqueta',
      class: 'w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500',
    });
    nameInp.value = existing?.name || '';

    const colorGrid = el('div', { class: 'grid grid-cols-9 gap-1.5' });
    function drawColors() {
      colorGrid.innerHTML = '';
      for (const c of colors) {
        colorGrid.appendChild(el('button', {
          class: `h-7 rounded ${labelStripClass(c)} ${selectedColor === c ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`,
          onClick: (e) => { e.preventDefault(); selectedColor = c; drawColors(); preview.className = `text-xs px-2 py-1 rounded font-medium ${labelExpandedClass(selectedColor)}`; },
          title: c,
        }));
      }
    }

    const preview = el('span', { class: `text-xs px-2 py-1 rounded font-medium ${labelExpandedClass(selectedColor)}` });
    function updatePreview() { preview.textContent = nameInp.value || 'Pré-visualização'; }
    nameInp.oninput = updatePreview;
    updatePreview();

    drawColors();

    const errBox = el('div', { class: 'text-xs text-red-600' });

    editorCard.append(
      el('h4', { class: 'text-base font-semibold text-slate-900' }, isEdit ? 'Editar etiqueta' : 'Nova etiqueta'),
      el('label', { class: 'block' },
        el('div', { class: 'text-xs text-slate-500 mb-1' }, 'Nome'),
        nameInp,
      ),
      el('label', { class: 'block' },
        el('div', { class: 'text-xs text-slate-500 mb-1' }, 'Cor'),
        colorGrid,
      ),
      el('div', null,
        el('div', { class: 'text-xs text-slate-500 mb-1' }, 'Pré-visualização'),
        preview,
      ),
      errBox,
      el('div', { class: 'flex justify-end gap-2 pt-2' },
        el('button', { class: 'text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100', onClick: closeEditor }, 'Cancelar'),
        el('button', {
          class: 'text-sm px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700',
          onClick: async () => {
            errBox.textContent = '';
            try {
              if (isEdit) {
                await api.updateLabel(profileId, existing.id, { name: nameInp.value, color: selectedColor });
              } else {
                await api.createLabel(profileId, { name: nameInp.value, color: selectedColor });
              }
              closeEditor();
              await reload();
              rerenderBody();
            } catch (err) {
              errBox.textContent = err.message;
            }
          },
        }, isEdit ? 'Salvar' : 'Criar'),
      ),
    );

    document.body.appendChild(editorOverlay);
    document.body.appendChild(editorPanel);
    nameInp.focus();
  }

  document.body.appendChild(overlay);
  document.body.appendChild(panel);
  await reload();
}

// Mapeia color (Tailwind name) → classes pra strip e pra pílula expandida.
// Tailwind precisa das classes literais no source pra detectar; lista todas.
function labelStripClass(color) {
  const map = {
    emerald: 'bg-emerald-500', lime: 'bg-lime-500', green: 'bg-green-500',
    teal: 'bg-teal-500', cyan: 'bg-cyan-500', sky: 'bg-sky-500',
    blue: 'bg-blue-500', indigo: 'bg-indigo-500', violet: 'bg-violet-500',
    purple: 'bg-purple-500', pink: 'bg-pink-500', rose: 'bg-rose-500',
    red: 'bg-red-500', orange: 'bg-orange-500', amber: 'bg-amber-500',
    yellow: 'bg-yellow-500', slate: 'bg-slate-500', gray: 'bg-gray-500',
  };
  return map[color] || 'bg-slate-400';
}

function labelExpandedClass(color) {
  const map = {
    emerald: 'bg-emerald-100 text-emerald-800', lime: 'bg-lime-100 text-lime-800',
    green: 'bg-green-100 text-green-800', teal: 'bg-teal-100 text-teal-800',
    cyan: 'bg-cyan-100 text-cyan-800', sky: 'bg-sky-100 text-sky-800',
    blue: 'bg-blue-100 text-blue-800', indigo: 'bg-indigo-100 text-indigo-800',
    violet: 'bg-violet-100 text-violet-800', purple: 'bg-purple-100 text-purple-800',
    pink: 'bg-pink-100 text-pink-800', rose: 'bg-rose-100 text-rose-800',
    red: 'bg-red-100 text-red-800', orange: 'bg-orange-100 text-orange-800',
    amber: 'bg-amber-100 text-amber-800', yellow: 'bg-yellow-100 text-yellow-800',
    slate: 'bg-slate-200 text-slate-800', gray: 'bg-gray-200 text-gray-800',
  };
  return map[color] || 'bg-slate-100 text-slate-700';
}

// Tier "selo" — fundo sólido escuro + texto branco em negrito.
// Usado pra diferenciar visualmente os tiers (GA, G1, G2…) das etiquetas.
function tierBadgeClass(color) {
  const map = {
    violet: 'bg-violet-700 text-white', indigo: 'bg-indigo-700 text-white',
    blue: 'bg-blue-700 text-white', cyan: 'bg-cyan-700 text-white',
    emerald: 'bg-emerald-700 text-white', amber: 'bg-amber-700 text-white',
    sky: 'bg-sky-700 text-white', teal: 'bg-teal-700 text-white',
    rose: 'bg-rose-700 text-white', red: 'bg-red-700 text-white',
    orange: 'bg-orange-700 text-white', slate: 'bg-slate-700 text-white',
  };
  return map[color] || 'bg-slate-700 text-white';
}
function tierStripClass(color) {
  const map = {
    violet: 'bg-violet-700', indigo: 'bg-indigo-700',
    blue: 'bg-blue-700', cyan: 'bg-cyan-700',
    emerald: 'bg-emerald-700', amber: 'bg-amber-700',
    sky: 'bg-sky-700', teal: 'bg-teal-700',
    rose: 'bg-rose-700', red: 'bg-red-700',
    orange: 'bg-orange-700', slate: 'bg-slate-700',
  };
  return map[color] || 'bg-slate-700';
}

function wireKanbanSortable(container) {
  if (typeof Sortable === 'undefined') return;
  // Viewer (acesso só-leitura) não pode mover cards nem reordenar colunas.
  if (isViewer()) return;
  // Em mobile (telas <640px) o drag-drop do touchscreen briga com o
  // scroll/swipe natural. Pula o wiring inteiro — usuário move card
  // via dropdown "Mudar coluna" no header do modal e reorganiza colunas
  // via desktop. Detecção é dinâmica (atualiza em resize).
  if (window.matchMedia('(max-width: 640px)').matches) return;

  const colRowEl = container.querySelector('#kanban-col-row');

  // Edge-scroll: listeners nativos com capture:true (disparam antes do SortableJS)
  // atualizam dragX continuamente. setInterval lê dragX e scrolla colRowEl.
  // onMove não serve pra isso — só dispara ao cruzar limites de elementos visíveis,
  // então congela quando o ghost fica dentro da última coluna visível.
  let edgeScrollTimer = null;
  let dragX = -1, dragY = -1;
  let dragTapX = -1, dragTapY = -1;
  let ghostOverrideRaf = null;
  let edgeScrollDelta = 0;
  let _diagTick = 0;
  // Captura posição do click ANTES do SortableJS — evt.originalEvent em onStart
  // não preserva clientX/Y de forma confiável. Esse listener pega o pointerdown direto.
  if (colRowEl) {
    colRowEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.kanban-card, .kanban-col-header')) {
        dragTapX = e.clientX;
        dragTapY = e.clientY;
      }
    }, { capture: true });
  }
  // Cancela compensação de scroll do SortableJS — força o clone a ficar sob o cursor
  // preservando o offset do click, ignorando o deslocamento horizontal do colRowEl
  function pinGhostToCursor() {
    if (dragX >= 0 && dragY >= 0 && dragTapX >= 0) {
      // Clone tem só .sortable-drag; original também tem .sortable-ghost
      const ghost = document.querySelector('.sortable-drag:not(.sortable-ghost)');
      if (ghost) {
        ghost.style.transform = `translate3d(${dragX - dragTapX}px, ${dragY - dragTapY}px, 0)`;
      }
    }
    ghostOverrideRaf = requestAnimationFrame(pinGhostToCursor);
  }
  function trackDragX(e) {
    const t = e.touches && e.touches.length > 0 ? e.touches[0] : null;
    dragX = t ? t.clientX : e.clientX;
    dragY = t ? t.clientY : e.clientY;
  }
  function diagEdgeScroll(evt) {
    if (!colRowEl) { console.warn('[diag] colRowEl não encontrado'); return; }
    const row = colRowEl.getBoundingClientRect();
    const maxScroll = colRowEl.scrollWidth - colRowEl.clientWidth;
    const isMobile = colRowEl.clientWidth < 640;
    const ZONE_L = isMobile ? 60 : 80;
    const ZONE_R = isMobile ? 60 : 250;
    console.group('[edgeScroll diag] drag start');
    console.log('janela      ', `innerWidth=${window.innerWidth} innerHeight=${window.innerHeight}`);
    console.log('colRowEl    ', `left=${Math.round(row.left)} right=${Math.round(row.right)} width=${Math.round(row.width)}`);
    console.log('scroll      ', `scrollLeft=${Math.round(colRowEl.scrollLeft)} max=${Math.round(maxScroll)} scrollWidth=${colRowEl.scrollWidth}`);
    console.log('zonas       ', `esq < ${Math.round(row.left + ZONE_L)}  dir > ${Math.round(row.right - ZONE_R)}  L=${ZONE_L} R=${ZONE_R}  isMobile=${isMobile}`);
    console.log('item drag   ', evt?.item?.dataset?.tid || evt?.item?.dataset?.columnId || '?');
    const cols = Array.from(colRowEl.querySelectorAll('.kanban-col'));
    const colData = cols.map((col, i) => {
      const r = col.getBoundingClientRect();
      const visLeft  = Math.max(r.left, row.left);
      const visRight = Math.min(r.right, row.right);
      const visible  = visRight > visLeft ? Math.round(visRight - visLeft) : 0;
      const pct      = Math.round(visible / r.width * 100);
      return { i, id: col.dataset.columnId || i, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), visible, pct: pct + '%' };
    });
    console.table(colData);
    console.groupEnd();
  }
  function startEdgeScroll() {
    stopEdgeScroll();
    dragX = -1; dragY = -1;
    edgeScrollDelta = 0;
    _diagTick = 0;
    document.body.classList.add('kanban-dragging');
    // 'important' vence o scroll-snap-type: x mandatory !important do @media mobile
    if (colRowEl) colRowEl.style.setProperty('scroll-snap-type', 'none', 'important');
    document.addEventListener('pointermove', trackDragX, { capture: true, passive: true });
    document.addEventListener('touchmove', trackDragX, { capture: true, passive: true });
    // Pin ghost ao cursor — cancela compensação de scroll do SortableJS
    ghostOverrideRaf = requestAnimationFrame(pinGhostToCursor);
    edgeScrollTimer = setInterval(() => {
      if (dragX < 0 || !colRowEl) return;
      const rect = colRowEl.getBoundingClientRect();
      const isMobile = colRowEl.clientWidth < 640;
      // Zonas assimétricas: esquerda pequena (DevTools fica na direita, não na esquerda)
      // Zona esquerda pequena evita scroll acidental ao pegar card próximo à borda esquerda
      const ZONE_L = isMobile ? 60 : 80;
      const ZONE_R = isMobile ? 60 : 250;
      const SPEED = 18;
      const inL = dragX < rect.left + ZONE_L;
      const inR = dragX > rect.right - ZONE_R;
      if (++_diagTick % 10 === 0)
        console.log(`[tick] dragX=${Math.round(dragX)} scrollLeft=${Math.round(colRowEl.scrollLeft)} inL=${inL} inR=${inR} threshR=${Math.round(rect.right - ZONE_R)}`);
      if (inL) {
        colRowEl.scrollBy({ left: -SPEED, behavior: 'instant' });
        edgeScrollDelta -= SPEED;
      } else if (inR) {
        colRowEl.scrollBy({ left: SPEED, behavior: 'instant' });
        edgeScrollDelta += SPEED;
      }
      // Notifica SortableJS da nova coluna sob o cursor após scroll
      // (SortableJS só reavalia alvo quando pointermove dispara — cursor parado não dispara)
      if ((inL || inR) && dragY >= 0) {
        document.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, cancelable: true,
          clientX: dragX, clientY: dragY,
          pointerType: 'mouse', pointerId: 1,
          movementX: 0, movementY: 0,
        }));
      }
    }, 16);
  }
  function stopEdgeScroll() {
    clearInterval(edgeScrollTimer);
    edgeScrollTimer = null;
    if (ghostOverrideRaf) { cancelAnimationFrame(ghostOverrideRaf); ghostOverrideRaf = null; }
    document.body.classList.remove('kanban-dragging');
    dragX = -1; dragY = -1;
    // Não zerar dragTapX/Y aqui — startEdgeScroll chama stopEdgeScroll no início
    // pra limpar estado, e isso apagaria o tap capturado pelo pointerdown.
    // O pointerdown sobrescreve no próximo click.
    if (colRowEl) {
      if (edgeScrollDelta !== 0) {
        const isMobile = colRowEl.clientWidth < 640;
        // Mobile: cada coluna ocupa 100% do container; desktop: w-80 + gap-3 = 332px
        const COL_STEP = isMobile ? colRowEl.clientWidth : 332;
        const cur = colRowEl.scrollLeft;
        const maxScroll = colRowEl.scrollWidth - colRowEl.clientWidth;
        const target = edgeScrollDelta > 0
          ? Math.ceil(cur / COL_STEP) * COL_STEP
          : Math.floor(cur / COL_STEP) * COL_STEP;
        colRowEl.scrollLeft = Math.max(0, Math.min(target, maxScroll));
      }
      if (colRowEl.clientWidth >= 640) {
        // Desktop: restaura proximity inline
        colRowEl.style.setProperty('scroll-snap-type', 'x proximity');
      } else {
        // Mobile: remove inline — @media !important volta a mandar
        colRowEl.style.removeProperty('scroll-snap-type');
      }
    }
    edgeScrollDelta = 0;
    document.removeEventListener('pointermove', trackDragX, { capture: true });
    document.removeEventListener('touchmove', trackDragX, { capture: true });
  }

  // SortableJS pra cards (drag entre colunas)
  const lists = container.querySelectorAll('.kanban-list');
  for (const list of lists) {
    Sortable.create(list, {
      group: 'kanban',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      // forceFallback + fallbackOnBody: tira o clone do contêiner overflow e gruda
      // no <body>, evitando que o ghost herde a largura/posição do .kanban-list.
      // fallbackClass: CSS abaixo (.kanban-card-ghost) trava a largura no tamanho do card.
      forceFallback: true,
      fallbackOnBody: true,
      fallbackClass: 'kanban-card-ghost',
      // Touch: segurar 300ms imóvel pra iniciar drag. Qualquer movimento
       // dentro do delay cancela e libera scroll/swipe nativos.
      delay: 300,
      delayOnTouchOnly: true,
      touchStartThreshold: 0,
      scroll: false,
      onStart: (evt) => { diagEdgeScroll(evt); startEdgeScroll(); },
      onEnd: async (evt) => {
        // Suprime o click que dispara junto com o pointerup após drag —
        // sem isso o modal abre toda vez que o card é solto.
        // forceFallback:true não cancela o click nativo como o HTML5 DnD faz.
        const suppress = (e) => { e.stopPropagation(); e.preventDefault(); };
        document.addEventListener('click', suppress, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', suppress, true), 100);
        stopEdgeScroll();
        const tid = evt.item.dataset.tid;
        const newColumn = evt.to.dataset.column;
        const newIndex = evt.newIndex;
        if (!tid || !newColumn) return;
        const t = state.data?.tournaments?.find(x => x.id === tid);
        if (!t) return;
        const siblings = Array.from(evt.to.querySelectorAll('[data-tid]')).map(n => n.dataset.tid);
        const fromColumn = evt.from.dataset.column;
        const crossColumn = fromColumn && fromColumn !== newColumn;
        const sourceSiblings = crossColumn
          ? Array.from(evt.from.querySelectorAll('[data-tid]')).map(n => n.dataset.tid)
          : null;
        // Optimistic update: aplica cardOrder em todos os irmãos da coluna destino
        siblings.forEach((sid, idx) => {
          const tt = state.data?.tournaments?.find(x => x.id === sid);
          if (tt) tt.notes = { ...(tt.notes || {}), cardOrder: idx, ...(sid === tid ? { column: newColumn } : {}) };
        });
        if (sourceSiblings) {
          sourceSiblings.forEach((sid, idx) => {
            const tt = state.data?.tournaments?.find(x => x.id === sid);
            if (tt) tt.notes = { ...(tt.notes || {}), cardOrder: idx };
          });
        }
        try {
          await api.moveCard(
            state.activeProfileId, tid, newColumn, newIndex, siblings,
            crossColumn ? fromColumn : null,
            sourceSiblings,
          );
        } catch (err) {
          alert('Erro ao mover: ' + err.message);
          render();
        }
      },
    });
  }

  // SortableJS pra colunas (drag pra reordenar) — group separado
  if (colRowEl) {
    Sortable.create(colRowEl, {
      group: 'kanban-cols',
      animation: 150,
      handle: '.kanban-col-header',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      draggable: '.kanban-col',
      forceFallback: true,
      fallbackOnBody: true,
      fallbackClass: 'kanban-col-ghost',
      delay: 300,
      delayOnTouchOnly: true,
      touchStartThreshold: 0,
      scroll: false,
      onStart: (evt) => { diagEdgeScroll(evt); startEdgeScroll(); },
      onEnd: async () => {
        stopEdgeScroll();
        const ids = [...colRowEl.querySelectorAll('.kanban-col')].map(c => c.dataset.columnId).filter(Boolean);
        state.columnOrder = ids;
        try { await api.updateBoardConfig({ columnOrder: ids }); }
        catch (err) { alert('Erro ao salvar ordem: ' + err.message); }
      },
    });
  }
}


function renderHeader() {
  const old = $('header-bar');
  if (!old) return;
  const searchHadFocus = document.activeElement?.id === 'header-search';
  const searchCursor = searchHadFocus ? document.activeElement.selectionStart : null;
  old.replaceWith(renderHeaderEl());
  if (searchHadFocus) {
    const newInput = document.getElementById('header-search');
    if (newInput) { newInput.focus(); if (searchCursor != null) newInput.setSelectionRange(searchCursor, searchCursor); }
  }
}

// Title Case pra nomes próprios. Lida com partículas que ficam em
// minúsculo no português ("de", "da", "do", "dos", "das", "e").
// Email (com @) é retornado inalterado.
function toTitleCase(s) {
  if (!s) return '';
  if (s.includes('@')) return s;
  const lower = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
  return String(s).toLowerCase().split(/\s+/).map((w, i) => {
    if (i > 0 && lower.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function isViewer() {
  return state.user?.role === 'viewer';
}

// ===== Web Push helpers =====
function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function pushSupported() {
  return 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

async function getPushSubscription() {
  if (!await pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function subscribeToPush() {
  const reg = await navigator.serviceWorker.ready;
  const info = await api.pushInfo();
  if (!info?.enabled || !info.publicKey) {
    throw new Error('Notificações não habilitadas no servidor');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permissão negada');
  }
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(info.publicKey),
  });
  await api.pushSubscribe(subscription.toJSON());
  return subscription;
}

async function unsubscribeFromPush() {
  const sub = await getPushSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint);
    await sub.unsubscribe();
  }
}

// Bolinha-com-número no canto do ícone do app (iOS PWA, Android, macOS)
async function updateAppBadge(count) {
  if (!('setAppBadge' in navigator)) return;
  try {
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge?.();
  } catch {}
}

// Render do bloco de opt-in do push — null se já tá inscrito ou se push não é suportado
async function renderPushOptIn() {
  if (!await pushSupported()) return null;
  const info = await api.pushInfo();
  if (!info?.enabled) return null;
  const sub = await getPushSubscription();
  if (sub) {
    // Já inscrito — mostra status sutil + opção de desativar
    return el('div', { class: 'mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center justify-between gap-2' },
      el('div', { class: 'text-xs text-emerald-800' }, '🔔 Notificações ativadas neste dispositivo'),
      el('button', {
        class: 'text-[11px] text-emerald-700 hover:underline',
        onClick: async () => {
          if (!confirm('Desativar notificações neste dispositivo?')) return;
          try { await unsubscribeFromPush(); openAlertsListModal(); }
          catch (err) { alert('Erro: ' + err.message); }
        },
      }, 'Desativar'),
    );
  }
  // Não inscrito — mostra CTA
  return el('div', { class: 'mb-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-3 space-y-2' },
    el('div', { class: 'text-sm font-medium text-cyan-900' }, '🔔 Receber alertas no celular'),
    el('p', { class: 'text-xs text-cyan-800' },
      'Ative pra receber notificações nativas (com bolinha no ícone do app) quando rolar boleto novo, inscrição abrir, ranking mudar, etc.'),
    el('button', {
      class: 'w-full text-sm rounded bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-3 py-2',
      onClick: async (e) => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = 'Ativando…';
        try {
          await subscribeToPush();
          await api.pushTest(); // dispara push de teste
          openAlertsListModal();
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Ativar notificações neste dispositivo';
          alert('Não foi possível ativar: ' + err.message);
        }
      },
    }, 'Ativar notificações neste dispositivo'),
  );
}

// Cor estável e distinta por usuário, baseada em hash do email/id.
// Paleta escolhida pra ter contraste suficiente em texto branco.
const AVATAR_COLORS = [
  { bg: 'bg-cyan-600',    hover: 'hover:bg-cyan-700' },
  { bg: 'bg-emerald-600', hover: 'hover:bg-emerald-700' },
  { bg: 'bg-violet-600',  hover: 'hover:bg-violet-700' },
  { bg: 'bg-rose-600',    hover: 'hover:bg-rose-700' },
  { bg: 'bg-amber-600',   hover: 'hover:bg-amber-700' },
  { bg: 'bg-sky-600',     hover: 'hover:bg-sky-700' },
  { bg: 'bg-fuchsia-600', hover: 'hover:bg-fuchsia-700' },
  { bg: 'bg-teal-600',    hover: 'hover:bg-teal-700' },
  { bg: 'bg-indigo-600',  hover: 'hover:bg-indigo-700' },
  { bg: 'bg-orange-600',  hover: 'hover:bg-orange-700' },
];
function avatarColor(seed) {
  if (!seed) return AVATAR_COLORS[0];
  let h = 0;
  const s = String(seed).toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function userInitials(emailOrName) {
  if (!emailOrName) return '?';
  const s = String(emailOrName).trim();
  // Nome próprio (preferível) — primeira letra dos DOIS primeiros nomes.
  // Famílias com mesmo sobrenome (ex.: Garcia) ficavam com iniciais idênticas
  // se usássemos primeiro+último; usar os dois primeiros distingue ("Anna
  // Cláudia Garcia"=AC, "Anna Luiza Garcia"=AL).
  if (!s.includes('@')) {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  }
  // Fallback: email — pega 2 primeiras letras antes do @, separando por . _ -
  const local = s.includes('@') ? s.split('@')[0] : s;
  const parts = local.split(/[._\s-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

function renderHeaderEl() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);

  const logo = el('div', { class: 'flex items-center gap-2 shrink-0 select-none' },
    el('span', { class: 'text-xl' }, '🎾'),
    el('span', { class: 'font-bold tracking-tight text-base sm:text-lg' },
      el('span', { class: 'text-slate-900' }, 'T'),
      el('span', { class: 'text-slate-900 hidden sm:inline' }, 'ennis'),
      el('span', { class: 'text-cyan-600 sm:ml-0.5' }, 'Flow'),
    ),
  );

  const initials = userInitials(state.user?.name || state.user?.email || profile?.athleteName);
  const myColor = avatarColor(state.user?.id || state.user?.email);
  const avatarButton = state.user && el('button', {
    id: 'avatar-button',
    class: `w-9 h-9 rounded-full ${myColor.bg} text-white text-xs font-semibold flex items-center justify-center ${myColor.hover} shrink-0`,
    title: state.user.email || 'Conta',
    onClick: (e) => { e.stopPropagation(); toggleGearMenu(); },
  }, initials);

  // Bolinhas dos membros + botão "+" — só desktop (mobile usa item do menu)
  const otherMembers = (state.user?.members || []).filter(m => m.id !== state.user?.id);
  const memberStack = state.user && el('div', { class: 'hidden md:flex items-center -space-x-2 shrink-0' },
    ...otherMembers.slice(0, 4).map(m => {
      const c = avatarColor(m.id || m.email);
      return el('button', {
        class: `w-8 h-8 rounded-full ${c.bg} text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-[#0e3a4d] ${c.hover}`,
        title: m.email,
        onClick: (e) => { e.stopPropagation(); openInviteModal(); },
      }, userInitials(m.email || m.name));
    }),
    otherMembers.length > 4 && el('span', {
      class: 'w-8 h-8 rounded-full bg-slate-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-[#0e3a4d]',
      title: `+${otherMembers.length - 4} membros`,
    }, `+${otherMembers.length - 4}`),
    el('button', {
      class: 'w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white text-base font-semibold flex items-center justify-center ring-2 ring-[#0e3a4d]',
      title: 'Convidar membro',
      onClick: (e) => { e.stopPropagation(); openInviteModal(); },
    }, '+'),
  );

  // Busca livre — vive no header e filtra por nome/cidade/UF/etiqueta/chave.
  // font-size: 16px obrigatório pra iOS Safari não dar zoom no foco do input.
  // type=text (não search) pra evitar o "X" nativo que iOS esconde mas que
  // alguns browsers desktop renderizam de forma inconsistente. Usamos um
  // botão custom no canto direito.
  const searchInput = profile && el('input', {
    id: 'header-search',
    type: 'text',
    autocomplete: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: 'Buscar…',
    value: state.searchQuery || '',
    class: 'w-full bg-white/10 hover:bg-white/15 focus:bg-white/20 text-white placeholder-white/50 border border-white/20 rounded pl-3 pr-8 py-1.5 outline-none focus:border-cyan-300',
    style: 'font-size: 16px;',
  });
  let searchClearBtn = null;
  if (searchInput) {
    // Debounce do rerender pra não interferir com a digitação (iOS perde
    // foco se o DOM é trocado a cada keystroke).
    let pending = null;
    const updateClearBtnVisibility = () => {
      if (!searchClearBtn) return;
      searchClearBtn.style.display = (state.searchQuery && state.searchQuery.length) ? '' : 'none';
    };
    searchInput.oninput = (e) => {
      state.searchQuery = e.target.value;
      updateClearBtnVisibility();
      if (pending) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => { pending = null; rerenderBody(); });
    };
    searchClearBtn = el('button', {
      type: 'button',
      class: 'absolute inset-y-0 right-1 my-auto w-6 h-6 rounded-full text-white/70 hover:text-white hover:bg-white/20 flex items-center justify-center text-base leading-none',
      title: 'Limpar busca',
      onClick: (e) => {
        e.preventDefault();
        state.searchQuery = '';
        searchInput.value = '';
        updateClearBtnVisibility();
        rerenderBody();
        searchInput.focus();
      },
    }, '×');
    // Inicial: esconde se não tem busca
    if (!state.searchQuery) searchClearBtn.style.display = 'none';
  }
  const searchWrap = profile && el('div', { class: 'relative w-full' }, searchInput, searchClearBtn);

  const viewerBadge = isViewer() && el('span', {
    class: 'hidden sm:inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold bg-amber-400/90 text-amber-950 px-2 py-0.5 rounded shrink-0',
    title: 'Você tem acesso somente leitura. Peça ao dono pra promover sua conta.',
  }, '👁 Leitor');

  return el('header', { id: 'header-bar', class: 'flex items-center gap-2 sm:gap-3 pb-2 border-b border-slate-200 relative' },
    logo,
    profile && el('div', { class: 'flex-1 min-w-0 max-w-md mx-auto' }, searchWrap),
    el('div', { class: 'flex items-center gap-1 sm:gap-2 shrink-0' },
      viewerBadge,
      memberStack,
      profile && renderFiltersButton(),
      profile && renderAlertsBell(),
      profile && renderSyncIndicator(),
      avatarButton,
    ),
  );
}

function renderFiltersButton() {
  const activeCount =
    (state.filterUFs?.length || 0) +
    (state.filterYears?.length || 0) +
    (state.filterTiers?.length || 0) +
    (state.hiddenColumns?.length || 0);
  // Funil (Heroicons FunnelIcon, mini 20x20) — 3 linhas formando triângulo
  // invertido, ícone universal de filtro.
  const funnel = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  funnel.setAttribute('viewBox', '0 0 20 20');
  funnel.setAttribute('fill', 'currentColor');
  funnel.setAttribute('class', 'w-5 h-5');
  funnel.innerHTML = '<path fill-rule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 0 1 .628.74v2.288a2.25 2.25 0 0 1-.659 1.59l-4.682 4.683a2.25 2.25 0 0 0-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 0 1 8 18.25v-5.757a2.25 2.25 0 0 0-.659-1.591L2.659 6.22A2.25 2.25 0 0 1 2 4.629V2.34a.75.75 0 0 1 .628-.74Z" clip-rule="evenodd" />';
  return el('button', {
    id: 'filters-button',
    class: 'relative w-9 h-9 rounded-full flex items-center justify-center text-white/85 hover:text-white hover:bg-white/10',
    title: activeCount ? `Filtros (${activeCount} ativos)` : 'Filtros',
    onClick: (e) => { e.stopPropagation(); openFiltersPanel(); },
  },
    funnel,
    activeCount > 0 && el('span', {
      class: 'absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-cyan-500 text-white text-[10px] font-bold flex items-center justify-center',
    }, String(activeCount)),
  );
}

function renderAlertsBell() {
  const count = state.unseenAlertsCount || 0;
  const hasUnseen = count > 0;
  return el('button', {
    class: 'relative w-10 h-10 flex items-center justify-center rounded hover:bg-slate-100',
    title: hasUnseen ? `${count} alerta${count > 1 ? 's' : ''} não visto${count > 1 ? 's' : ''}` : 'Alertas',
    onClick: () => openAlertsListModal(),
  },
    el('span', { class: hasUnseen ? 'text-[#0e3a4d]' : 'text-slate-400', style: 'font-size:18px;line-height:1' }, '🔔'),
    hasUnseen && el('span', {
      class: 'absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center',
    }, count > 9 ? '9+' : String(count)),
  );
}

function renderSyncIndicator() {
  const ss = state.syncStatus;
  const lastSync = state.data?.syncedAt;
  let color, title;
  if (ss?.state === 'running') { color = 'bg-amber-400 animate-pulse'; title = 'Sincronizando…'; }
  else if (ss?.state === 'error') { color = 'bg-red-500'; title = 'Erro: ' + (ss.error || 'desconhecido'); }
  else if (lastSync) { color = 'bg-emerald-500'; title = 'Sincronizado'; }
  else { color = 'bg-slate-300'; title = 'Ainda não sincronizou'; }
  return el('button', {
    class: 'w-10 h-10 flex items-center justify-center rounded hover:bg-slate-100',
    title,
    onClick: () => showSyncStatus(),
  }, el('span', { class: `inline-block w-3 h-3 rounded-full ${color}` }));
}

function showSyncStatus() {
  const ss = state.syncStatus;
  const lastSync = state.data?.syncedAt;
  const fmtBR = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  let dot, title, detail;
  if (ss?.state === 'running') {
    openSyncProgressModal();
    return;
  }
  if (ss?.state === 'error') {
    dot = 'bg-rose-500';
    title = 'Última sincronização falhou';
    detail = `Erro: ${ss.error || 'desconhecido'}` + (lastSync ? `\nÚltima OK: ${fmtBR(lastSync)}` : '');
  } else if (lastSync) {
    dot = 'bg-emerald-500';
    title = 'Sincronizado';
    detail = fmtBR(lastSync);
  } else {
    dot = 'bg-slate-400';
    title = 'Ainda não sincronizou';
    detail = 'Clique abaixo pra puxar os torneios pela primeira vez.';
  }
  openSyncModal({ dot, title, detail });
}

// Persistent progress modal — opens on "Sincronizar agora", stays até o usuário
// dar OK depois da conclusão. Mostra contador de tempo enquanto roda e um
// mini relatório do que mudou ao terminar.
let syncProgressTickTimer = null;
function openSyncProgressModal() {
  const root = $('modal-root');
  if (document.getElementById('sync-progress-modal')) return;
  root.innerHTML = '';
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50' });
  const card = el('div', {
    id: 'sync-progress-modal',
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 85vh;',
  });
  const header = el('div', { class: 'bg-[#0e3a4d] text-white px-5 py-3 flex items-center gap-2' },
    el('span', { id: 'sync-progress-dot', class: 'inline-block w-3 h-3 rounded-full bg-amber-400 animate-pulse' }),
    el('span', { class: 'font-medium' }, 'Sincronização'),
  );
  const body = el('div', { id: 'sync-progress-body', class: 'px-5 py-4 overflow-y-auto flex-1' });
  const footer = el('div', { id: 'sync-progress-footer', class: 'px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50' });
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  root.appendChild(overlay);
  root.appendChild(card);

  if (syncProgressTickTimer) clearInterval(syncProgressTickTimer);
  syncProgressTickTimer = setInterval(refreshSyncProgressModal, 1000);
  refreshSyncProgressModal();
}

function refreshSyncProgressModal() {
  const card = document.getElementById('sync-progress-modal');
  if (!card) return;
  const ss = state.syncStatus;
  const dot = document.getElementById('sync-progress-dot');
  const body = document.getElementById('sync-progress-body');
  const footer = document.getElementById('sync-progress-footer');
  if (!body || !footer || !dot) return;

  body.innerHTML = '';
  footer.innerHTML = '';

  const close = () => {
    if (syncProgressTickTimer) { clearInterval(syncProgressTickTimer); syncProgressTickTimer = null; }
    document.getElementById('modal-root').innerHTML = '';
  };

  if (ss && ss.state !== 'running' && ss.state !== 'idle') {
    // Sync terminou — para o timer de atualização do modal
    if (syncProgressTickTimer) { clearInterval(syncProgressTickTimer); syncProgressTickTimer = null; }
  }

  if (!ss || ss.state === 'running') {
    dot.className = 'inline-block w-3 h-3 rounded-full bg-amber-400 animate-pulse';
    const startedAt = ss?.startedAt ? new Date(ss.startedAt).getTime() : Date.now();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const profileCount = (state.profiles || []).length;
    const subtitle = profileCount > 1
      ? `${profileCount} atletas · decorrido ${elapsedSec}s`
      : `Decorrido ${elapsedSec}s`;
    body.appendChild(el('div', { class: 'flex items-center gap-3 mb-3' },
      el('div', { class: 'w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#00a3e0] animate-spin' }),
      el('div', null,
        el('div', { class: 'font-semibold' }, 'Atualizando dados'),
        el('div', { class: 'text-xs text-slate-500' }, subtitle),
      ),
    ));
    const stepClass = 'flex items-start gap-2 text-xs text-slate-600 py-0.5';
    body.appendChild(el('ul', { class: 'space-y-0.5 mb-3 mt-1' },
      el('li', { class: stepClass }, el('span', { class: 'text-slate-400 shrink-0' }, '·'), 'Lendo torneios e inscrições'),
      el('li', { class: stepClass }, el('span', { class: 'text-slate-400 shrink-0' }, '·'), 'Detectando boletos pendentes e prazos'),
      el('li', { class: stepClass }, el('span', { class: 'text-slate-400 shrink-0' }, '·'), 'Atualizando rankings (nacional, regional, WTN)'),
      el('li', { class: stepClass }, el('span', { class: 'text-slate-400 shrink-0' }, '·'), 'Coletando histórico de partidas'),
      el('li', { class: stepClass }, el('span', { class: 'text-slate-400 shrink-0' }, '·'), 'Recalculando estatísticas e indicadores'),
    ));
    body.appendChild(el('p', { class: 'text-xs text-slate-500 italic' },
      'Costuma levar ~4 minutos. Pode esconder essa janela — quando terminar, mostro aqui o que mudou.'));
    footer.appendChild(el('button', {
      type: 'button',
      class: 'px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-600 hover:bg-slate-100',
      onClick: close,
    }, 'Esconder'));
    return;
  }

  if (ss.state === 'error') {
    dot.className = 'inline-block w-3 h-3 rounded-full bg-rose-500';
    body.appendChild(el('h3', { class: 'text-base font-semibold mb-1' }, 'Falha na sincronização'));
    body.appendChild(el('p', { class: 'text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 whitespace-pre-line' },
      ss.error || 'Erro desconhecido'));
    footer.appendChild(el('button', {
      type: 'button',
      class: 'px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-100',
      onClick: close,
    }, 'Fechar'));
    if (!isViewer()) {
      footer.appendChild(el('button', {
        type: 'button',
        class: 'px-3 py-1.5 text-sm rounded bg-[#00a3e0] hover:bg-[#0090c7] text-white font-medium',
        onClick: () => { close(); syncNow(); },
      }, 'Tentar de novo'));
    }
    return;
  }

  // Success — show summary
  dot.className = 'inline-block w-3 h-3 rounded-full bg-emerald-500';
  const s = ss.summary || {};
  const startedAt = ss.startedAt ? new Date(ss.startedAt).getTime() : null;
  const finishedAt = ss.finishedAt ? new Date(ss.finishedAt).getTime() : Date.now();
  const elapsedSec = startedAt ? Math.max(0, Math.round((finishedAt - startedAt) / 1000)) : null;

  const headerRow = el('div', { class: 'flex items-start gap-3 mb-3' },
    el('div', { class: 'w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg font-bold' }, '✓'),
    el('div', null,
      el('div', { class: 'font-semibold text-emerald-700' }, 'Sincronização concluída'),
      el('div', { class: 'text-xs text-slate-500' },
        [
          s.totalTournaments != null ? `${s.totalTournaments} torneios no total` : null,
          elapsedSec != null ? `em ${elapsedSec}s` : null,
        ].filter(Boolean).join(' · '),
      ),
    ),
  );
  body.appendChild(headerRow);

  if (s.baseline) {
    body.appendChild(el('div', { class: 'rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-sm text-sky-800' },
      'Primeira sincronização — todos os torneios foram carregados como base. As próximas vão destacar apenas as mudanças.'));
    footer.appendChild(el('button', {
      type: 'button',
      class: 'px-3 py-1.5 text-sm rounded bg-[#00a3e0] hover:bg-[#0090c7] text-white font-medium',
      onClick: close,
    }, 'OK'));
    return;
  }

  const newCount = (s.newTournaments || []).length;
  const updCount = (s.updatedTournaments || []).length;
  const ec = s.eventCounts || {};

  if (newCount === 0 && updCount === 0) {
    body.appendChild(el('div', { class: 'rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700' },
      'Nada novo. Nenhum torneio adicionado e nenhuma informação mudou desde a última sincronização.'));
  } else {
    const counterRow = el('div', { class: 'grid grid-cols-2 gap-2 mb-3' });
    const counterCard = (n, label, color) => el('div', { class: `rounded-lg border px-3 py-2 ${color}` },
      el('div', { class: 'text-2xl font-bold leading-none' }, String(n)),
      el('div', { class: 'text-xs mt-0.5' }, label),
    );
    counterRow.appendChild(counterCard(newCount, 'novos torneios', 'bg-emerald-50 border-emerald-200 text-emerald-800'));
    counterRow.appendChild(counterCard(updCount, 'com atualizações', 'bg-amber-50 border-amber-200 text-amber-800'));
    body.appendChild(counterRow);

    const evLine = (icon, n, label) => n > 0 && el('div', { class: 'flex items-center gap-2 text-sm' },
      el('span', null, icon),
      el('span', { class: 'font-semibold' }, String(n)),
      el('span', { class: 'text-slate-600' }, label),
    );
    const winChanged = ec.window_changed || 0;
    const datesChanged = (ec.reg_deadline_changed || 0) + (ec.reg_opens_changed || 0) + (ec.cancel_deadline_changed || 0);
    const evList = el('div', { class: 'space-y-1 mb-3' },
      evLine('💰', ec.boleto_detected || 0, 'boletos novos detectados'),
      evLine('✅', ec.boleto_cleared || 0, 'pagamentos confirmados'),
      evLine('✓',  ec.inscribed || 0,      'inscrições detectadas'),
      evLine('🟢', ec.confirmed || 0,      'inscrições confirmadas (sit. financeira OK)'),
      evLine('↩︎', ec.uninscribed || 0,    'inscrições removidas no TI'),
      evLine('⚠️', ec.unconfirmed || 0,    'inscrições perderam confirmação'),
      evLine('📌', winChanged,             `mudança${winChanged !== 1 ? 's' : ''} no estado de inscrição`),
      evLine('📅', datesChanged,           `data${datesChanged !== 1 ? 's' : ''} de inscrição/cancelamento atualizada${datesChanged !== 1 ? 's' : ''}`),
      evLine('🏆', ec.tiers_added || 0,    'chaves adicionadas (multi-categoria)'),
      s.newAlerts > 0 && el('button', {
        class: 'flex items-center gap-2 text-sm text-cyan-700 hover:underline',
        onClick: () => { close(); openAlertsListModal({ onlyUnseen: true }); },
      },
        el('span', null, '🔔'),
        el('span', { class: 'font-semibold' }, String(s.newAlerts)),
        el('span', null, `alerta${s.newAlerts > 1 ? 's' : ''} de regras (clique pra ver)`),
      ),
    );
    if (evList.children.length) body.appendChild(evList);

    if (newCount > 0) {
      body.appendChild(el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mt-3 mb-1' },
        `Novos torneios (${newCount})`));
      const list = el('ul', { class: 'space-y-1' });
      for (const t of s.newTournaments.slice(0, 20)) {
        const meta = [t.startDate, t.state, t.tier].filter(Boolean).join(' · ');
        list.appendChild(el('li', { class: 'text-sm border-l-2 border-emerald-400 pl-2' },
          el('div', { class: 'font-medium' }, t.name),
          meta && el('div', { class: 'text-xs text-slate-500' }, meta),
        ));
      }
      if (s.newTournaments.length > 20) {
        list.appendChild(el('li', { class: 'text-xs text-slate-500 italic' }, `…e mais ${s.newTournaments.length - 20}`));
      }
      body.appendChild(list);
    }

    if (updCount > 0) {
      body.appendChild(el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mt-3 mb-1' },
        `Torneios atualizados (${updCount})`));
      const list = el('ul', { class: 'space-y-1.5' });
      for (const t of s.updatedTournaments.slice(0, 20)) {
        list.appendChild(el('li', { class: 'text-sm border-l-2 border-amber-400 pl-2' },
          el('div', { class: 'font-medium' }, t.name),
          ...(t.events || []).map(ev => el('div', { class: 'text-xs text-slate-600' }, ev.message)),
        ));
      }
      if (s.updatedTournaments.length > 20) {
        list.appendChild(el('li', { class: 'text-xs text-slate-500 italic' }, `…e mais ${s.updatedTournaments.length - 20}`));
      }
      body.appendChild(list);
    }
  }

  footer.appendChild(el('button', {
    type: 'button',
    class: 'px-3 py-1.5 text-sm rounded bg-[#00a3e0] hover:bg-[#0090c7] text-white font-medium',
    onClick: close,
  }, 'OK'));
}

function openSyncModal({ dot, title, detail, runningOnly = false }) {
  const root = $('modal-root');
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-sm bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden',
  },
    el('div', { class: 'bg-[#0e3a4d] text-white px-5 py-3 flex items-center gap-2' },
      el('span', { class: `inline-block w-3 h-3 rounded-full ${dot}` }),
      el('span', { class: 'font-medium' }, 'Sincronização'),
    ),
    el('div', { class: 'px-5 py-4' },
      el('h3', { class: 'text-base font-semibold text-slate-900' }, title),
      detail && el('p', { class: 'text-sm text-slate-600 mt-1 whitespace-pre-line' }, detail),
    ),
    el('div', { class: 'px-5 pb-4 flex justify-end gap-2' },
      el('button', {
        type: 'button',
        class: 'px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-100',
        onClick: close,
      }, runningOnly ? 'Fechar' : 'Cancelar'),
      !runningOnly && !isViewer() && el('button', {
        type: 'button',
        class: 'px-3 py-1.5 text-sm rounded bg-[#00a3e0] hover:bg-[#0090c7] text-white font-medium',
        onClick: () => { close(); syncNow(); },
      }, 'Sincronizar agora'),
    ),
  );
  root.appendChild(overlay);
  root.appendChild(card);
}

// ===== Alertas =====
const ALERT_TYPE_META = {
  new_tournament_location: { label: 'Novo torneio em UF/cidade', icon: '📍' },
  new_tournament_tier:     { label: 'Novo torneio em chave',     icon: '🏆' },
  ranking_change:          { label: 'Mudança de ranking',        icon: '📊' },
};

function ruleSummary(rule) {
  const meta = ALERT_TYPE_META[rule.type];
  if (!meta) return rule.type;
  if (rule.type === 'new_tournament_location') {
    const ufs = rule.params?.ufs || [];
    const cities = rule.params?.cities || [];
    const parts = [];
    if (ufs.length) parts.push(`UF: ${ufs.join(', ')}`);
    if (cities.length) parts.push(`Cidades: ${cities.join(', ')}`);
    return parts.join(' · ') || 'Sem filtros';
  }
  if (rule.type === 'new_tournament_tier') {
    const tiers = rule.params?.tiers || [];
    return `Chaves: ${tiers.join(', ') || '—'}`;
  }
  if (rule.type === 'ranking_change') {
    return rule.params?.scope === 'df' ? 'Ranking DF' : 'Ranking nacional';
  }
  return '';
}

function openAlertRulesModal() {
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 85vh;',
  });
  const header = el('div', { class: 'bg-[#0e3a4d] text-white px-5 py-3 flex items-center justify-between' },
    el('span', { class: 'font-medium' }, '🔔 Alertas'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  );
  const body = el('div', { class: 'px-5 py-4 overflow-y-auto flex-1' });
  const footer = el('div', { class: 'px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-between gap-2' });
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  root.appendChild(overlay);
  root.appendChild(card);

  let rules = [];
  let editing = null; // rule id sendo editada, ou 'new'

  const reload = async () => {
    rules = await api.listAlertRules(state.activeProfileId);
    renderList();
  };

  const renderList = () => {
    body.innerHTML = '';
    footer.innerHTML = '';

    body.appendChild(el('p', { class: 'text-sm text-slate-600 mb-3' },
      'Crie regras pra ser avisado quando aparecerem novos torneios ou houver mudança no ranking. Os alertas são checados a cada sincronização.'));

    if (rules.length === 0) {
      body.appendChild(el('div', { class: 'text-sm text-slate-500 italic py-4 text-center' },
        'Nenhuma regra criada ainda.'));
    } else {
      const list = el('ul', { class: 'space-y-2' });
      for (const r of rules) {
        const meta = ALERT_TYPE_META[r.type] || {};
        const enabled = r.enabled !== false;
        list.appendChild(el('li', { class: `flex items-start gap-3 border rounded-lg p-3 ${enabled ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 opacity-60'}` },
          el('span', { class: 'text-xl' }, meta.icon || '🔔'),
          el('div', { class: 'flex-1 min-w-0' },
            el('div', { class: 'font-medium text-sm' }, r.label || meta.label),
            el('div', { class: 'text-xs text-slate-500 mt-0.5' }, ruleSummary(r)),
          ),
          el('div', { class: 'flex items-center gap-1 shrink-0' },
            el('button', {
              class: 'text-xs px-2 py-1 rounded text-slate-600 hover:bg-slate-100',
              onClick: async () => {
                await api.updateAlertRule(state.activeProfileId, r.id, { enabled: !enabled });
                reload();
              },
            }, enabled ? 'Pausar' : 'Ativar'),
            el('button', {
              class: 'text-xs px-2 py-1 rounded text-slate-600 hover:bg-slate-100',
              onClick: () => { editing = r.id; renderForm(r); },
            }, 'Editar'),
            el('button', {
              class: 'text-xs px-2 py-1 rounded text-rose-600 hover:bg-rose-50',
              onClick: async () => {
                if (!confirm('Apagar esta regra?')) return;
                await api.deleteAlertRule(state.activeProfileId, r.id);
                reload();
              },
            }, 'Apagar'),
          ),
        ));
      }
      body.appendChild(list);
    }

    footer.appendChild(el('button', {
      class: 'px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-100',
      onClick: close,
    }, 'Fechar'));
    footer.appendChild(el('button', {
      class: 'px-3 py-1.5 text-sm rounded bg-[#00a3e0] hover:bg-[#0090c7] text-white font-medium',
      onClick: () => { editing = 'new'; renderForm(null); },
    }, '+ Nova regra'));
  };

  const renderForm = (rule) => {
    body.innerHTML = '';
    footer.innerHTML = '';
    const initial = rule || { type: 'new_tournament_location', params: {} };
    let typeSel = initial.type;
    let params = { ...(initial.params || {}) };

    body.appendChild(el('div', { class: 'mb-3' },
      el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1' }, 'Tipo'),
      el('select', {
        class: 'w-full border border-slate-300 rounded px-2 py-1.5 text-sm',
        onChange: (e) => { typeSel = e.target.value; params = {}; renderParamsBlock(); },
      },
        ...Object.entries(ALERT_TYPE_META).map(([id, m]) => el('option', { value: id, ...(typeSel === id ? { selected: true } : {}) }, `${m.icon} ${m.label}`)),
      ),
    ));

    const paramsBlock = el('div', { class: 'space-y-2' });
    body.appendChild(paramsBlock);

    const renderParamsBlock = () => {
      paramsBlock.innerHTML = '';
      if (typeSel === 'new_tournament_location') {
        const ufs = (params.ufs || []).join(', ');
        const cities = (params.cities || []).join(', ');
        paramsBlock.appendChild(el('div', null,
          el('label', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500' }, 'UFs (separadas por vírgula)'),
          el('input', {
            class: 'w-full border border-slate-300 rounded px-2 py-1.5 text-sm mt-1',
            placeholder: 'DF, GO, SP', value: ufs,
            onInput: (e) => { params.ufs = e.target.value.split(',').map(s => s.trim()).filter(Boolean); },
          }),
        ));
        paramsBlock.appendChild(el('div', null,
          el('label', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500' }, 'Cidades (separadas por vírgula)'),
          el('input', {
            class: 'w-full border border-slate-300 rounded px-2 py-1.5 text-sm mt-1',
            placeholder: 'Brasília, Goiânia', value: cities,
            onInput: (e) => { params.cities = e.target.value.split(',').map(s => s.trim()).filter(Boolean); },
          }),
        ));
        paramsBlock.appendChild(el('p', { class: 'text-xs text-slate-500' },
          'Pode preencher só UF, só cidade, ou os dois (combinação OU).'));
      } else if (typeSel === 'new_tournament_tier') {
        const allTiers = TIER_ORDER;
        const sel = new Set(params.tiers || []);
        paramsBlock.appendChild(el('div', null,
          el('label', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-1' }, 'Chaves'),
          el('div', { class: 'flex flex-wrap gap-1.5' },
            ...allTiers.map(t => el('button', {
              class: `text-xs px-2.5 py-1 rounded-full border ${sel.has(t) ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300'}`,
              onClick: (e) => {
                e.preventDefault();
                if (sel.has(t)) sel.delete(t); else sel.add(t);
                params.tiers = [...sel];
                renderParamsBlock();
              },
            }, t)),
          ),
        ));
      } else if (typeSel === 'ranking_change') {
        const scope = params.scope || 'national';
        paramsBlock.appendChild(el('div', null,
          el('label', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-1' }, 'Escopo'),
          el('div', { class: 'flex gap-1.5' },
            ...[['national', 'Nacional'], ['df', 'DF']].map(([id, label]) => el('button', {
              class: `text-xs px-2.5 py-1 rounded-full border ${(params.scope || 'national') === id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300'}`,
              onClick: (e) => { e.preventDefault(); params.scope = id; renderParamsBlock(); },
            }, label)),
          ),
        ));
        paramsBlock.appendChild(el('p', { class: 'text-xs text-slate-500' },
          'Avisa em qualquer mudança de posição (subiu ou caiu).'));
      }
    };
    renderParamsBlock();

    footer.appendChild(el('button', {
      class: 'px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-100',
      onClick: () => { editing = null; renderList(); },
    }, 'Cancelar'));
    footer.appendChild(el('button', {
      class: 'px-3 py-1.5 text-sm rounded bg-[#00a3e0] hover:bg-[#0090c7] text-white font-medium',
      onClick: async () => {
        const body = { type: typeSel, params };
        try {
          if (rule) await api.updateAlertRule(state.activeProfileId, rule.id, body);
          else await api.createAlertRule(state.activeProfileId, body);
          editing = null;
          await reload();
        } catch (err) { alert('Erro: ' + err.message); }
      },
    }, rule ? 'Salvar' : 'Criar'));
  };

  reload();
}

function openAlertsListModal({ onlyUnseen = false } = {}) {
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 70vh;',
  });
  const header = el('div', { class: 'bg-[#0e3a4d] text-white px-5 py-3 flex items-center justify-between' },
    el('span', { class: 'font-medium' }, onlyUnseen ? '🔔 Novos alertas' : '🔔 Alertas'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  );
  const body = el('div', { class: 'px-5 py-4 overflow-y-auto flex-1' });
  const footer = el('div', { class: 'px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-between gap-2' });
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  root.appendChild(overlay);
  root.appendChild(card);

  const reload = async () => {
    body.innerHTML = '';
    footer.innerHTML = '';

    // Opt-in de push notifications — só aparece se não estiver inscrito
    const pushSection = await renderPushOptIn();
    if (pushSection) body.appendChild(pushSection);

    const events = await api.listAlerts(state.activeProfileId, { unseen: onlyUnseen });

    if (events.length === 0) {
      body.appendChild(el('div', { class: 'text-sm text-slate-500 italic py-6 text-center' },
        onlyUnseen ? 'Nenhum alerta novo.' : 'Nenhum alerta ainda. Configure regras em Criar alertas.'));
    } else {
      const list = el('ul', { class: 'space-y-2' });
      for (const e of events) {
        const tournament = state.data?.tournaments?.find(t => t.id === e.tournamentId);
        const actions = el('div', { class: 'flex items-center gap-2 mt-2 pt-2 border-t border-slate-100' });
        // Alerta de relatório entregue: botão hero gradient pra abrir o
        // HTML em nova aba. É a entrega WOW — vale destaque visual.
        if (e.type === 'report_delivered' && e.reportId) {
          actions.appendChild(el('a', {
            class: 'flex-1 text-center text-xs px-3 py-2 rounded text-white font-bold no-underline',
            style: 'background: linear-gradient(135deg, #0e3a4d 0%, #1f5b75 100%); box-shadow: 0 2px 8px rgba(14,58,77,0.25);',
            href: `/api/profiles/${state.activeProfileId}/reports/${e.reportId}`,
            target: '_blank',
            rel: 'noopener',
          }, '✨ Ver relatório'));
        }
        if (tournament) {
          actions.appendChild(el('button', {
            class: 'flex-1 text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-700 text-white font-medium',
            onClick: () => { close(); openTournament(tournament.id); },
          }, '👀 Ver torneio'));
        }
        if (!e.seen) {
          actions.appendChild(el('button', {
            class: 'flex-1 text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-100',
            onClick: async () => {
              await api.markAlertsSeen(state.activeProfileId, [e.id]);
              state.unseenAlertsCount = Math.max(0, (state.unseenAlertsCount || 0) - 1);
              updateAppBadge(state.unseenAlertsCount);
              renderHeader();
              reload();
            },
          }, '✓ Já vi'));
        }
        // Descartar — apaga do histórico. Ícone discreto, sem ocupar espaço
        // dos botões primários. Confirma pra evitar tap acidental no mobile.
        actions.appendChild(el('button', {
          class: 'text-xs px-2 py-1.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0',
          title: 'Descartar este alerta',
          onClick: async () => {
            if (!confirm('Descartar este alerta? Não dá pra desfazer.')) return;
            await api.deleteAlertEvent(state.activeProfileId, e.id);
            if (!e.seen) {
              state.unseenAlertsCount = Math.max(0, (state.unseenAlertsCount || 0) - 1);
              updateAppBadge(state.unseenAlertsCount);
              renderHeader();
            }
            reload();
          },
        }, '🗑'));
        list.appendChild(el('li', { class: `border rounded-lg p-3 ${e.seen ? 'bg-slate-50 border-slate-200' : 'bg-white border-amber-300'}` },
          el('div', { class: `text-sm ${e.seen ? 'text-slate-600' : 'font-medium'}` }, e.message),
          el('div', { class: 'text-xs text-slate-500 mt-0.5' }, new Date(e.createdAt).toLocaleString('pt-BR')),
          actions,
        ));
      }
      body.appendChild(list);
    }

    const hasUnseen = events.some(e => !e.seen);
    footer.appendChild(el('button', {
      class: 'px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-100',
      onClick: close,
    }, 'Fechar'));
    if (hasUnseen) {
      footer.appendChild(el('button', {
        class: 'px-3 py-1.5 text-sm rounded bg-[#00a3e0] hover:bg-[#0090c7] text-white font-medium',
        onClick: async () => {
          await api.markAllAlertsSeen(state.activeProfileId);
          state.unseenAlertsCount = 0;
          updateAppBadge(0);
          renderHeader();
          close();
        },
      }, 'Marcar todos como vistos'));
    }
  };

  reload();
}

// Painel de filtros (UF / Ano / Chave / Colunas) — substitui as pillRows
// que viviam dentro do gear menu. Mobile: bottom sheet. Desktop: popover
// ancorado no botão 🎚️ do header.
function openFiltersPanel() {
  const existing = $('filters-panel');
  if (existing) { closeFiltersPanel(); return; }

  const tournaments = state.data?.tournaments || [];
  const ufs = [...new Set(tournaments.map(t => t.state).filter(Boolean))].sort();
  const tiersInData = new Set();
  for (const t of tournaments) {
    for (const tier of (t.tiers && t.tiers.length ? t.tiers : (t.tier ? [t.tier] : []))) tiersInData.add(tier);
  }
  const tierOptions = TIER_ORDER.filter(x => tiersInData.has(x));
  const yearOptions = [...new Set(tournaments.map(t => startYearOf(t)).filter(Boolean))].sort();

  const isMobile = window.matchMedia('(max-width: 640px)').matches;

  const overlay = el('div', {
    id: 'filters-overlay',
    class: 'fixed inset-0 bg-black/30 z-[58]',
    onClick: () => closeFiltersPanel(),
  });

  const panel = el('div', {
    id: 'filters-panel',
    class: isMobile
      ? 'fixed left-0 right-0 bottom-0 z-[59] bg-white rounded-t-2xl shadow-2xl max-h-[85dvh] overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]'
      : 'fixed z-[59] bg-white border border-slate-200 rounded-lg shadow-xl w-80 max-w-[calc(100vw-1rem)] max-h-[80dvh] overflow-y-auto overscroll-contain',
    onClick: (e) => e.stopPropagation(),
  });

  const rerender = () => {
    const oldPanel = $('filters-panel');
    const oldOverlay = $('filters-overlay');
    if (oldPanel) oldPanel.remove();
    if (oldOverlay) oldOverlay.remove();
    openFiltersPanel();
  };

  const pill = (text, active, onClick) => el('button', {
    class: `text-xs px-2.5 py-1 rounded-full border ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`,
    onClick: (e) => { e.preventDefault(); onClick(); },
  }, text);

  const section = (label, options, isSelected, onTogglePill, onClearAll) => {
    if (!options.length) return null;
    const allActive = !options.some(isSelected);
    return el('div', { class: 'px-4 py-3 border-b border-slate-100 last:border-b-0' },
      el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2' }, label),
      el('div', { class: 'flex flex-wrap gap-1.5' },
        pill('Todos', allActive, () => { onClearAll(); rerender(); rerenderBody(); renderHeader(); }),
        ...options.map(v => pill(v, isSelected(v), () => { onTogglePill(v); rerender(); rerenderBody(); renderHeader(); })),
      ),
    );
  };

  const ufSection = section(
    'UF',
    ufs,
    (uf) => state.filterUFs.includes(uf),
    (uf) => {
      const idx = state.filterUFs.indexOf(uf);
      if (idx >= 0) state.filterUFs.splice(idx, 1);
      else state.filterUFs.push(uf);
      localStorage.setItem('filterUFs', JSON.stringify(state.filterUFs));
    },
    () => {
      state.filterUFs = [];
      localStorage.setItem('filterUFs', '[]');
    },
  );

  const yearSection = yearOptions.length > 1 ? section(
    'Ano',
    yearOptions.map(String),
    (y) => state.filterYears.includes(Number(y)),
    (y) => {
      const yn = Number(y);
      const idx = state.filterYears.indexOf(yn);
      if (idx >= 0) state.filterYears.splice(idx, 1);
      else state.filterYears.push(yn);
      localStorage.setItem('filterYears', JSON.stringify(state.filterYears));
    },
    () => {
      state.filterYears = [];
      localStorage.setItem('filterYears', '[]');
    },
  ) : null;

  const tierSection = section(
    'Chave',
    tierOptions,
    (t) => state.filterTiers.includes(t),
    (t) => {
      const idx = state.filterTiers.indexOf(t);
      if (idx >= 0) state.filterTiers.splice(idx, 1);
      else state.filterTiers.push(t);
      localStorage.setItem('filterTiers', JSON.stringify(state.filterTiers));
    },
    () => {
      state.filterTiers = [];
      localStorage.setItem('filterTiers', '[]');
    },
  );

  // Colunas — toggle visibilidade. Cards continuam agrupados pra reaparecer
  // ao mostrar a coluna.
  const columnsSection = el('div', { class: 'px-4 py-3' },
    el('div', { class: 'flex items-center justify-between mb-2' },
      el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500' }, 'Colunas'),
      state.hiddenColumns.length > 0 && el('button', {
        class: 'text-[11px] text-cyan-700 hover:underline',
        onClick: (e) => {
          e.preventDefault();
          state.hiddenColumns = [];
          localStorage.setItem('hiddenColumns', '[]');
          rerender(); rerenderBody(); renderHeader();
        },
      }, 'Mostrar todas'),
    ),
    el('div', { class: 'space-y-1' },
      ...KANBAN_COLUMNS.map(col => {
        const hidden = state.hiddenColumns.includes(col.id);
        const customLabel = state.columnLabels[col.id] || col.label;
        return el('label', { class: 'flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-50 cursor-pointer' },
          el('input', {
            type: 'checkbox',
            checked: !hidden,
            class: 'w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer',
            onChange: (e) => {
              if (e.target.checked) {
                state.hiddenColumns = state.hiddenColumns.filter(id => id !== col.id);
              } else {
                if (!state.hiddenColumns.includes(col.id)) state.hiddenColumns.push(col.id);
              }
              localStorage.setItem('hiddenColumns', JSON.stringify(state.hiddenColumns));
              rerenderBody(); renderHeader();
            },
          }),
          el('span', { class: 'text-base' }, col.icon),
          el('span', { class: `text-sm ${hidden ? 'text-slate-400 line-through' : 'text-slate-800'}` }, customLabel),
        );
      }),
    ),
  );

  const header = el('div', { class: 'sticky top-0 bg-white px-4 py-3 border-b border-slate-200 flex items-center justify-between' },
    el('h3', { class: 'text-base font-semibold text-slate-900' }, 'Filtros'),
    el('button', {
      class: 'text-slate-500 hover:text-slate-900 text-xl leading-none',
      onClick: () => closeFiltersPanel(),
    }, '×'),
  );

  panel.append(
    header,
    ufSection,
    yearSection,
    tierSection,
    columnsSection,
  );

  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  if (!isMobile) {
    const anchor = $('filters-button');
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const top = rect.bottom + 6;
      panel.style.top = `${top}px`;
      panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      panel.style.maxHeight = `calc(100dvh - ${top + 8}px - env(safe-area-inset-bottom))`;
    }
  }
}

function closeFiltersPanel() {
  const p = $('filters-panel');
  const o = $('filters-overlay');
  if (p) p.remove();
  if (o) o.remove();
}

function toggleGearMenu() {
  const existing = $('gear-menu');
  if (existing) { existing.remove(); return; }
  const profile = state.profiles.find(p => p.id === state.activeProfileId);

  // Cabeçalho do menu (estilo Trello): avatar + nome + email
  const initials = userInitials(state.user?.name || state.user?.email || profile?.athleteName);
  const displayName = state.user?.name || null;
  const myColor = avatarColor(state.user?.id || state.user?.email);
  const planLine = (() => {
    const p = state.user?.plan;
    if (!p) return null;
    if (p.effective === 'pro') return { text: 'Pro vitalício', color: 'text-emerald-700' };
    if (p.effective === 'trial') return { text: `Trial · ${p.trialDaysLeft}d restantes · fazer upgrade`, color: 'text-amber-700' };
    return { text: 'Free · fazer upgrade', color: 'text-cyan-700' };
  })();
  const userHeader = state.user && el('div', { class: 'px-3 py-3 border-b border-slate-200 flex items-center gap-3 bg-slate-50' },
    el('span', { class: `w-10 h-10 rounded-full ${myColor.bg} text-white text-sm font-semibold flex items-center justify-center shrink-0` }, initials),
    el('div', { class: 'min-w-0 flex-1' },
      displayName && el('div', { class: 'text-sm font-bold text-slate-700 truncate' }, displayName),
      el('div', { class: `${displayName ? 'text-xs text-slate-500' : 'text-sm font-bold text-slate-700'} truncate` }, state.user.email || 'Conta'),
      planLine && el('button', {
        class: `text-[11px] ${planLine.color} hover:underline truncate text-left mt-0.5`,
        onClick: () => { const m = $('gear-menu'); if (m) m.remove(); window.open('/upgrade', '_blank'); },
        title: 'Ver plano',
      }, planLine.text),
    ),
  );

  // Bloco do atleta — clique abre submenu pra trocar/adicionar
  const reopen = () => { const m = $('gear-menu'); if (m) { m.remove(); toggleGearMenu(); } };
  const hasMultipleAthletes = state.profiles.length > 1;
  const athleteHeader = profile && el('div', { class: 'px-3 py-2.5 border-b border-slate-200' },
    el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-[#1f5b75] mb-1' }, 'Atleta'),
    el('button', {
      class: 'w-full flex items-center justify-between gap-2 text-left rounded px-2 py-1.5 hover:bg-slate-100',
      onClick: () => { state.athleteSwitcherOpen = !state.athleteSwitcherOpen; reopen(); },
    },
      el('span', { class: 'flex items-center gap-1.5 min-w-0 text-sm text-slate-700 truncate' },
        hasMultipleAthletes && el('span', { class: 'text-emerald-600 shrink-0' }, '✓'),
        el('span', { class: 'truncate' }, toTitleCase(profile.athleteName || profile.tiEmail || 'Atleta')),
      ),
      el('span', { class: 'text-xs text-slate-400 shrink-0' }, state.athleteSwitcherOpen ? '▴' : '▾'),
    ),
    state.athleteSwitcherOpen && el('div', { class: 'mt-1 space-y-0.5' },
      ...state.profiles.filter(p => p.id !== state.activeProfileId).map(p => el('button', {
        class: 'w-full text-left text-sm px-2 py-1.5 rounded hover:bg-slate-100 text-slate-700 truncate',
        onClick: () => {
          state.athleteSwitcherOpen = false;
          const m = $('gear-menu'); if (m) m.remove();
          switchProfile(p.id);
        },
      }, toTitleCase(p.athleteName || p.tiEmail || 'Atleta'))),
      el('button', {
        class: 'w-full text-left text-sm px-2 py-1.5 rounded text-cyan-700 hover:bg-cyan-50',
        onClick: () => {
          state.athleteSwitcherOpen = false;
          const m = $('gear-menu'); if (m) m.remove();
          switchProfile('__new__');
        },
      }, '+ Adicionar atleta'),
    ),
  );

  // Separa as ações em "Atleta" e "Conta" pra deixar mais organizado
  const athleteFirstName = (profile?.athleteName || profile?.tiEmail || 'Atleta').split(/\s+/)[0];
  const athleteActions = profile ? [
    { label: 'Performance do Atleta', onClick: () => openAthleteCard() },
    { label: '🎾 Scout ao Vivo', onClick: () => openScoutListModal() },
    { label: 'Credenciais TI', onClick: () => openProfileForm(profile) },
  ] : [];
  // Mobile: "Convidar membro" no menu (não tem o "+" do member stack que
  // só aparece em md+). Desktop usa o "+" no header diretamente.
  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  const accountActions = state.user ? [
    isMobile && { label: 'Convidar membro', onClick: () => openInviteModal() },
    profile && { label: 'Criar alertas', onClick: () => openAlertRulesModal() },
    profile && { label: 'Conectar agenda', onClick: () => openCalendarSetup() },
    { label: 'Manual', onClick: () => window.open('/manual', '_blank') },
    state.user.isAdmin && { label: '🛠️ Admin', onClick: () => openAdminModal() },
    { label: 'Sair', onClick: () => logout() },
  ].filter(Boolean) : [];

  const menu = el('div', {
    id: 'gear-menu',
    // bg-white inline style pra não sofrer override do tema kanban-dark.
    // max-height usa dvh (dynamic viewport height) pra considerar a barra
    // dinâmica do Safari iOS e safe-area-inset-bottom pra não invadir o
    // notch/home indicator.
    // bg-white pra escapar dos overrides do tema kanban; max-height
    // calculado dinamicamente abaixo (depende de onde o menu cair).
    style: 'background:#fff; color:#0f172a;',
    class: 'fixed z-50 border border-slate-200 rounded-lg shadow-xl py-1 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain',
    onClick: (e) => e.stopPropagation(),
  },
    userHeader,
    athleteHeader,
    (athleteActions.length + accountActions.length) > 0 && el('div', { class: 'py-1' },
      ...[...athleteActions, ...accountActions].map(it => el('button', {
        class: 'block w-full text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#1f5b75] hover:bg-slate-100',
        onClick: () => { menu.remove(); it.onClick(); },
      }, it.label)),
    ),
    state.version && el('div', {
      class: 'px-3 py-2 border-t border-slate-200 text-[11px] text-slate-400 font-mono',
      title: 'Versão do Tennis Flow · clique pra forçar atualização',
      onClick: () => { menu.remove(); window.location.reload(); },
      style: 'cursor:pointer',
    }, `v${state.version.version} · ${state.version.commit}`),
  );

  // Anexa ao body (fora do #header-bar pra escapar dos overrides do tema kanban)
  document.body.appendChild(menu);

  // Posiciona logo abaixo do botão avatar, alinhado à direita.
  // max-height respeita a barra inferior dinâmica do Safari iOS via dvh
  // + safe-area-inset-bottom — senão o último item do menu fica escondido.
  const anchor = $('avatar-button');
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    const top = rect.bottom + 6;
    menu.style.top = `${top}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.maxHeight = `calc(100dvh - ${top + 8}px - env(safe-area-inset-bottom))`;
  }

  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target) && e.target.id !== 'avatar-button') { menu.remove(); document.removeEventListener('click', close); }
    });
  }, 0);
}

// Painel admin — só pra emails em ADMIN_EMAILS (gate via /api/auth/me).
// Concentra ações destrutivas (reset) e ferramentas de suporte.
function openAdminModal() {
  if (!state.user?.isAdmin) return;
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  const profileLabel = profile
    ? `${toTitleCase(profile.athleteName || profile.tiEmail)} (${profile.id.slice(0, 8)})`
    : '— sem perfil ativo —';

  const action = (label, desc, onClick, danger = false) => el('div', {
    class: 'border border-slate-200 rounded-lg p-3 flex items-start justify-between gap-3',
  },
    el('div', { class: 'flex-1 min-w-0' },
      el('div', { class: 'text-sm font-semibold text-slate-700' }, label),
      el('div', { class: 'text-xs text-slate-500 mt-0.5' }, desc),
    ),
    el('button', {
      class: `text-xs font-semibold px-3 py-1.5 rounded shrink-0 ${danger ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-cyan-600 hover:bg-cyan-700 text-white'}`,
      onClick,
    }, danger ? 'Executar' : 'Rodar'),
  );

  const reevaluateAlerts = async () => {
    if (!profile) return alertDialog('Sem perfil ativo');
    try {
      const r = await api.reevaluateAlerts(profile.id);
      await alertDialog(`• ${r.evaluated} eventos avaliados\n• ${r.added} eventos novos (resto eram duplicados)`, { title: 'Re-avaliação concluída' });
      // Atualiza badge de alertas
      try {
        const events = await api.listAlerts(profile.id);
        const unseen = (events || []).filter(e => !e.seen);
        updateAppBadge(unseen.length);
      } catch {}
    } catch (e) {
      alertDialog('Erro: ' + e.message);
    }
  };

  const resetBoard = async () => {
    if (!profile) return alertDialog('Sem perfil ativo');
    const ok = await confirmDialog(
      `Limpar overrides manuais de coluna/ordem em "${profileLabel}"?\n\nPreserva: comentários, etiquetas, anexos, alertas, pin.\nReverte: cards movidos manualmente voltam à regra automática.`,
      { okLabel: 'Limpar' },
    );
    if (!ok) return;
    try {
      const r = await api.resetBoardOverrides(profile.id);
      await alertDialog(`${r.cleared || 0} overrides limpos.`, { title: 'OK' });
      window.location.reload();
    } catch (e) { alertDialog('Erro: ' + e.message); }
  };

  const resetAll = async () => {
    if (!profile) return alertDialog('Sem perfil ativo');
    const txt = await promptDialog(
      `⚠️ DESTRUTIVO: vai apagar synced + notes + alertas de "${profileLabel}".\nPerfil + credenciais TI são preservados. Próxima sync vira baseline novo.\n\nDigite RESET pra confirmar:`,
      { title: 'Reset completo', placeholder: 'RESET', okLabel: 'Executar', danger: true },
    );
    if (txt !== 'RESET') return;
    try {
      await api.resetAll(profile.id);
      await alertDialog('Reset completo. Recarregando...');
      window.location.reload();
    } catch (e) { alertDialog('Erro: ' + e.message); }
  };

  // Inbox de pedidos. Quando o cliente clica "Enviar solicitação" no modal
  // de consentimento LGPD, fica registrado em /report-requests com profileId
  // já amarrado. Aqui é a entrada natural — admin não precisa adivinhar
  // qual atleta é o do pedido.
  // Compartilhado entre as seções de pedidos e entrega retroativa: a entrega
  // (de qualquer caminho) precisa atualizar o card "Pedidos de relatório".
  let reloadPendingRequests = () => {};

  function pendingRequestsSection() {
    const wrap = el('div', { class: 'border border-emerald-200 rounded-lg p-3 bg-emerald-50/40' });
    wrap.appendChild(el('div', { class: 'text-sm font-semibold text-slate-700' }, '📬 Pedidos de relatório'));
    wrap.appendChild(el('div', { class: 'text-xs text-slate-500 mt-0.5' },
      'Solicitações vindas pelo botão "Enviar solicitação" no modal de consentimento LGPD.'));

    const list = el('div', { class: 'mt-2 space-y-2' });
    list.appendChild(el('div', { class: 'text-xs text-slate-400 italic' }, 'Carregando…'));
    wrap.appendChild(list);

    const STATUS_BADGE = {
      pending:     { label: '⏳ Pendente',    cls: 'bg-amber-100 text-amber-800 border-amber-200' },
      in_progress: { label: '✏️ Em andamento', cls: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
      delivered:   { label: '✅ Entregue',    cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    };
    const NEXT_STATUS = { pending: 'in_progress', in_progress: 'delivered' };
    const NEXT_LABEL = { pending: '▶ Iniciar', in_progress: '✅ Marcar entregue' };

    const renderRequests = async () => {
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'text-xs text-slate-400 italic' }, 'Carregando…'));
      try {
        const requests = await api.listReportRequests();
        list.innerHTML = '';
        if (!requests.length) {
          list.appendChild(el('div', { class: 'text-xs text-slate-500 italic py-1' },
            'Nenhum pedido pendente.'));
          return;
        }
        for (const r of requests) {
          const date = new Date(r.createdAt).toLocaleString('pt-BR');
          const requester = [r.requesterFirstName, r.requesterLastName].filter(Boolean).join(' ') || '(sem nome)';
          const status = r.status || 'pending';
          const badgeCfg = STATUS_BADGE[status] || STATUS_BADGE.pending;
          const card = el('div', { class: `border rounded p-2 ${status === 'delivered' ? 'bg-slate-50 border-slate-200 opacity-75' : 'bg-white border-slate-200'}` });
          card.appendChild(el('div', { class: 'flex items-baseline justify-between gap-2' },
            el('div', { class: 'flex items-center gap-2 min-w-0' },
              el('div', { class: 'text-sm font-semibold text-slate-800 truncate' }, r.athleteName || '(sem nome)'),
              el('span', { class: `text-[10px] px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap ${badgeCfg.cls}` }, badgeCfg.label),
            ),
            el('div', { class: 'text-[10px] text-slate-500 shrink-0' }, date),
          ));
          card.appendChild(el('div', { class: 'text-[11px] text-slate-600 mt-0.5 truncate' },
            `${requester} · ${r.requesterEmail || '(sem email)'}`,
          ));
          const actions = el('div', { class: 'mt-2 flex gap-2 flex-wrap' });
          actions.appendChild(el('a', {
            class: 'flex-1 text-center text-[11px] px-2 py-1 rounded bg-cyan-600 hover:bg-cyan-700 text-white font-semibold no-underline',
            href: `/api/admin/profiles/${r.profileId}/report`,
            target: '_blank',
            rel: 'noopener',
          }, '👁️ Ver'));
          actions.appendChild(el('a', {
            class: 'flex-1 text-center text-[11px] px-2 py-1 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold no-underline',
            href: `/api/admin/profiles/${r.profileId}/export`,
          }, '📦 Zip'));
          if (NEXT_STATUS[status]) {
            const nextBtn = el('button', {
              class: 'flex-1 text-[11px] px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold',
            }, NEXT_LABEL[status]);
            nextBtn.onclick = async () => {
              nextBtn.disabled = true;
              nextBtn.textContent = '…';
              try {
                await api.updateReportRequestStatus(r.profileId, r.id, NEXT_STATUS[status]);
                await renderRequests();
              } catch (err) {
                alert('Erro: ' + err.message);
                nextBtn.disabled = false;
                nextBtn.textContent = NEXT_LABEL[status];
              }
            };
            actions.appendChild(nextBtn);
          }
          // Upload do HTML final entrega o relatório + dispara push/alerta.
          // Aparece em qualquer status que não seja delivered.
          if (status !== 'delivered') {
            const fileInput = el('input', { type: 'file', accept: 'text/html,.html', class: 'hidden' });
            const deliverBtn = el('button', {
              class: 'flex-1 text-[11px] px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold',
              title: 'Enviar HTML final, marca como entregue + notifica o cliente',
            }, '📤 Entregar HTML');
            deliverBtn.onclick = () => fileInput.click();
            fileInput.onchange = async () => {
              const file = fileInput.files?.[0];
              if (!file) return;
              const requesterEmail = r.requesterEmail || '(sem email)';
              const asEmail = prompt(
                `Entregar "${file.name}" pra ${r.athleteName || 'atleta'}.\n\n` +
                `Push e alerta vão pra: ${requesterEmail}\n\n` +
                `Pra mandar pra outro email (teste), digite aqui. Senão, deixe em branco e dê OK:`,
                ''
              );
              if (asEmail === null) return; // cancelou
              const target = asEmail.trim();
              if (!confirm(`Confirmar entrega de "${file.name}"?\n\nDestinatário: ${target || requesterEmail}\n\nIsso vai:\n1. Salvar o HTML no perfil\n2. Marcar pedido como entregue\n3. Disparar push pra ${target || requesterEmail}\n4. Criar alerta no painel dele`)) return;
              deliverBtn.disabled = true;
              deliverBtn.textContent = '⏳ Enviando…';
              try {
                const html = await file.text();
                await api.deliverReport(r.profileId, r.id, html, target || null);
                await renderRequests();
              } catch (err) {
                alert('Erro: ' + err.message);
                deliverBtn.disabled = false;
                deliverBtn.textContent = '📤 Entregar HTML';
              }
            };
            actions.appendChild(deliverBtn);
            actions.appendChild(fileInput);
          }
          card.appendChild(actions);
          list.appendChild(card);
        }
      } catch (err) {
        list.innerHTML = '';
        list.appendChild(el('div', { class: 'text-xs text-red-600' }, `Erro: ${err.message}`));
      }
    };
    renderRequests();
    reloadPendingRequests = renderRequests;

    return wrap;
  }

  // Bloco pra acesso cross-household — fallback pro caso de não ter pedido
  // registrado (cliente clicou antes do registro server-side estar deployado,
  // ou o admin precisa olhar dados de alguém da família/teste).
  function crossHouseholdAccess() {
    const wrap = el('div', { class: 'border border-violet-200 rounded-lg p-3 bg-violet-50/40' });
    wrap.appendChild(el('div', { class: 'text-sm font-semibold text-slate-700' }, '🔓 Acessar atleta diretamente'));
    wrap.appendChild(el('div', { class: 'text-xs text-slate-500 mt-0.5' },
      'Pra olhar dados da família/teste sem passar pelo fluxo de pedido.'));

    const select = el('select', {
      class: 'mt-2 w-full text-sm border border-slate-300 rounded px-2 py-1.5 bg-white text-slate-900',
    }, el('option', { value: '' }, 'Carregando perfis…'));
    const buttons = el('div', { class: 'mt-2 flex gap-2' });
    const reportBtn = el('a', {
      class: 'flex-1 text-center text-xs px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-700 text-white font-semibold pointer-events-none opacity-50',
      target: '_blank',
      rel: 'noopener',
      href: '#',
    }, '👁️ Ver relatório');
    const exportBtn = el('a', {
      class: 'flex-1 text-center text-xs px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-700 text-white font-semibold pointer-events-none opacity-50',
      href: '#',
    }, '📦 Baixar zip');

    const updateLinks = () => {
      const id = select.value;
      if (!id) {
        reportBtn.classList.add('pointer-events-none', 'opacity-50');
        exportBtn.classList.add('pointer-events-none', 'opacity-50');
        reportBtn.href = '#'; exportBtn.href = '#';
        return;
      }
      reportBtn.href = `/api/admin/profiles/${id}/report`;
      exportBtn.href = `/api/admin/profiles/${id}/export`;
      reportBtn.classList.remove('pointer-events-none', 'opacity-50');
      exportBtn.classList.remove('pointer-events-none', 'opacity-50');
    };
    select.addEventListener('change', updateLinks);

    api.listAdminProfiles().then(profiles => {
      select.innerHTML = '';
      select.appendChild(el('option', { value: '' }, '— escolha o atleta —'));
      for (const p of profiles) {
        const owner = p.ownerEmail || '(sem dono)';
        const counts = `${p.tournamentCount} torn · ${p.matchCount} jogos`;
        select.appendChild(el('option', { value: p.id },
          `${p.athleteName || '(sem nome)'} — ${owner} · ${counts}`,
        ));
      }
    }).catch(err => {
      select.innerHTML = '';
      select.appendChild(el('option', { value: '' }, `Erro: ${err.message}`));
    });

    buttons.append(reportBtn, exportBtn);
    wrap.append(select, buttons);
    return wrap;
  }

  // Entrega retroativa — caso de cliente que pediu por fora do app, antes
  // do fluxo "Solicitar análise completa" existir. Cria um request entry
  // sintético + entrega numa só ação. Único caso conhecido: Breiner pro
  // Rafa, mas a UI fica pronta caso apareça outro.
  function seedDeliverSection() {
    const wrap = el('div', { class: 'border border-emerald-200 rounded-lg p-3 bg-emerald-50/40' });
    wrap.appendChild(el('div', { class: 'text-sm font-semibold text-slate-700' }, '📤 Entregar relatório retroativo'));
    wrap.appendChild(el('div', { class: 'text-xs text-slate-500 mt-0.5' },
      'Pra cliente que pediu fora do app, antes do botão "Solicitar análise completa". Cria registro + dispara push/alerta.'));

    const select = el('select', {
      class: 'mt-2 w-full text-sm border border-slate-300 rounded px-2 py-1.5 bg-white text-slate-900',
    }, el('option', { value: '' }, 'Carregando perfis…'));
    const emailInput = el('input', {
      type: 'email',
      placeholder: 'email do destinatário (ex: breinerq@gmail.com)',
      class: 'mt-2 w-full text-sm border border-slate-300 rounded px-2 py-1.5 bg-white text-slate-900',
    });
    const fileInput = el('input', { type: 'file', accept: 'text/html,.html', class: 'hidden' });
    const fileLabel = el('div', { class: 'mt-2 text-xs text-slate-500 italic' }, 'Nenhum arquivo selecionado');
    const pickBtn = el('button', {
      class: 'mt-2 w-full text-xs px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold',
      onClick: () => fileInput.click(),
    }, '📎 Escolher HTML do relatório');
    fileInput.onchange = () => {
      const f = fileInput.files?.[0];
      fileLabel.textContent = f ? `📄 ${f.name} (${Math.round(f.size / 1024)} KB)` : 'Nenhum arquivo selecionado';
    };

    const deliverBtn = el('button', {
      class: 'mt-2 w-full text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold',
    }, '📤 Entregar agora');
    deliverBtn.onclick = async () => {
      const profileId = select.value;
      const email = emailInput.value.trim();
      const file = fileInput.files?.[0];
      if (!profileId) return alert('Escolha o atleta.');
      if (!email) return alert('Informe o email do destinatário.');
      if (!file) return alert('Selecione o HTML do relatório.');
      const profileLabel = select.options[select.selectedIndex]?.textContent || profileId;
      if (!confirm(`Entregar "${file.name}" pra ${email}?\n\nAtleta: ${profileLabel}\n\nIsso vai:\n1. Criar pedido retroativo no histórico\n2. Salvar HTML\n3. Disparar push pra ${email}\n4. Criar alerta no painel dele`)) return;
      deliverBtn.disabled = true;
      deliverBtn.textContent = '⏳ Enviando…';
      try {
        const html = await file.text();
        await api.seedAndDeliverReport(profileId, html, email);
        deliverBtn.textContent = '✅ Entregue!';
        emailInput.value = '';
        fileInput.value = '';
        fileLabel.textContent = 'Nenhum arquivo selecionado';
        // Atualiza o card "📬 Pedidos de relatório" pra mostrar a entrega
        // recém-feita sem precisar de refresh manual.
        reloadPendingRequests();
        setTimeout(() => {
          deliverBtn.disabled = false;
          deliverBtn.textContent = '📤 Entregar agora';
        }, 2500);
      } catch (err) {
        alert('Erro: ' + err.message);
        deliverBtn.disabled = false;
        deliverBtn.textContent = '📤 Entregar agora';
      }
    };

    api.listAdminProfiles().then(profiles => {
      select.innerHTML = '';
      select.appendChild(el('option', { value: '' }, '— escolha o atleta —'));
      for (const p of profiles) {
        const owner = p.ownerEmail || '(sem dono)';
        select.appendChild(el('option', { value: p.id },
          `${p.athleteName || '(sem nome)'} — ${owner}`,
        ));
      }
    }).catch(err => {
      select.innerHTML = '';
      select.appendChild(el('option', { value: '' }, `Erro: ${err.message}`));
    });

    wrap.append(select, emailInput, pickBtn, fileLabel, fileInput, deliverBtn);
    return wrap;
  }

  function announcementSection() {
    const wrap = el('div', { class: 'border border-cyan-200 rounded-lg p-3 bg-cyan-50/40 space-y-2' });
    wrap.appendChild(el('div', { class: 'text-sm font-semibold text-slate-700' }, '📢 Anúncio para todos os usuários'));
    wrap.appendChild(el('div', { class: 'text-xs text-slate-500' }, 'Aparece como banner no rodapé quando o app carregar. Push enviado pra quem tem notificações ativas.'));

    const msgArea = el('textarea', {
      placeholder: 'Ex: Pais 12F, treino às 14h no Golden Tulip.',
      class: 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400 resize-none',
      rows: '2',
    });
    const ctaInp = el('input', {
      type: 'text',
      placeholder: 'Rótulo do botão (opcional, ex: Ver detalhes)',
      class: 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400',
    });
    const urlInp = el('input', {
      type: 'text',
      placeholder: 'URL do botão (opcional, ex: /)',
      value: '/',
      class: 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400',
    });

    const status = el('div', { class: 'text-xs text-slate-500 italic' });

    const sendBtn = el('button', {
      class: 'text-xs font-semibold px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-700 text-white',
    }, 'Enviar');
    const clearBtn = el('button', {
      class: 'text-xs font-semibold px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700',
    }, 'Limpar anúncio ativo');

    sendBtn.onclick = async () => {
      const msg = msgArea.value.trim();
      if (!msg) return alert('Digite a mensagem.');
      sendBtn.disabled = true;
      sendBtn.textContent = '⏳ Enviando…';
      try {
        const r = await api.postAnnouncement(msg, urlInp.value.trim() || '/', ctaInp.value.trim() || null);
        status.textContent = `✅ Enviado — ${r.pushSent} device(s) notificado(s).`;
        msgArea.value = '';
        ctaInp.value = '';
        sendBtn.textContent = 'Enviar';
        sendBtn.disabled = false;
      } catch (e) {
        alert('Erro: ' + e.message);
        sendBtn.textContent = 'Enviar';
        sendBtn.disabled = false;
      }
    };

    clearBtn.onclick = async () => {
      await api.deleteAnnouncement();
      status.textContent = 'Anúncio removido.';
    };

    wrap.append(msgArea, ctaInp, urlInp, el('div', { class: 'flex gap-2' }, sendBtn, clearBtn), status);
    return wrap;
  }

  const card = el('div', {
    class: 'bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col',
    onClick: e => e.stopPropagation(),
  },
    el('div', { class: 'px-5 py-3 border-b border-slate-200 flex items-center justify-between' },
      el('div', {},
        el('h3', { class: 'text-base font-semibold text-slate-700' }, '🛠️ Painel Admin'),
        el('div', { class: 'text-xs text-slate-500 mt-0.5' }, `Perfil ativo: ${profileLabel}`),
      ),
      el('button', { class: 'text-slate-400 hover:text-slate-700 text-xl leading-none', onClick: () => modal.remove() }, '×'),
    ),
    el('div', { class: 'px-5 py-4 space-y-3 overflow-y-auto' },
      announcementSection(),
      action(
        '🔄 Re-avaliar regras de alerta',
        'Roda regras de torneio (localidade, tier) como se fossem novos. Não detecta mudanças de ranking — essas só disparam na próxima sync quando o valor mudar.',
        reevaluateAlerts,
      ),
      action(
        '↩️ Resetar overrides do quadro',
        'Limpa coluna/ordem manuais. Cards voltam à regra automática. Preserva comentários, etiquetas, anexos.',
        resetBoard,
      ),
      action(
        '💣 Reset completo do perfil',
        'Apaga synced + notes + alertas. Preserva credenciais TI. Próxima sync vira baseline novo.',
        resetAll,
        true,
      ),
      pendingRequestsSection(),
      seedDeliverSection(),
      crossHouseholdAccess(),
    ),
    state.version && el('div', {
      class: 'px-5 py-2 border-t border-slate-200 text-[11px] text-slate-400 font-mono bg-slate-50',
    }, `v${state.version.version} · ${state.version.commit}`),
  );

  const modal = el('div', {
    class: 'fixed inset-0 z-[70] bg-black/50 flex items-center justify-center',
    onClick: () => modal.remove(),
  }, card);
  document.body.appendChild(modal);
}

function rerenderBody() {
  const tournaments = state.data?.tournaments || [];
  const oldKanban = $('kanban-board');
  if (oldKanban) {
    // Preserva scroll horizontal das colunas + scroll vertical dentro de cada lista
    const colRow = oldKanban.querySelector('.overflow-x-auto');
    const savedColScroll = colRow ? colRow.scrollLeft : 0;
    const savedListScrolls = new Map();
    for (const list of oldKanban.querySelectorAll('.kanban-list')) {
      savedListScrolls.set(list.dataset.column, list.scrollTop);
    }
    const newKanban = renderKanban(tournaments);
    oldKanban.replaceWith(newKanban);
    requestAnimationFrame(() => {
      const newColRow = newKanban.querySelector('.overflow-x-auto');
      if (newColRow) newColRow.scrollLeft = savedColScroll;
      for (const list of newKanban.querySelectorAll('.kanban-list')) {
        const saved = savedListScrolls.get(list.dataset.column);
        if (saved) list.scrollTop = saved;
      }
    });
    return;
  }
  render();
}

// Modal de histórico de jogos — placeholder da Fase 1 do plano de Performance.
// Lista crua agrupada por torneio. Vai virar dashboard analítico nas fases
// seguintes (Glicko, win prob, Markov, predição).
async function openMatchesModal() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  if (!profile) return;
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-white text-slate-900 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden',
  });
  const refreshBtn = el('button', {
    class: 'text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white',
    title: 'Re-scrape só matches (~3s)',
  }, '↻ Atualizar');
  const exportBtn = el('a', {
    class: 'text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white no-underline',
    href: `/api/profiles/${profile.id}/matches.csv`,
    download: `matches-${profile.athleteName || 'atleta'}.csv`,
    title: 'Baixar CSV pra Excel',
  }, '⤓ CSV');

  card.appendChild(el('div', { class: 'shrink-0 bg-[#0e3a4d] text-white px-5 py-3 flex items-center justify-between gap-2' },
    el('h3', { class: 'font-medium' }, 'Histórico de jogos'),
    el('div', { class: 'flex items-center gap-2' }, refreshBtn, exportBtn,
      el('button', { class: 'text-white/70 hover:text-white text-xl leading-none ml-2', onClick: close }, '×'),
    ),
  ));
  const body = el('div', { class: 'flex-1 min-h-0 overflow-y-auto px-5 py-4' },
    el('div', { class: 'text-sm text-slate-500' }, 'Carregando...'),
  );
  card.appendChild(body);

  refreshBtn.onclick = async () => {
    refreshBtn.textContent = '↻ Atualizando…';
    refreshBtn.disabled = true;
    try {
      const r = await fetch(`/api/profiles/${profile.id}/matches/refresh`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).error || 'Erro');
      const result = await r.json();
      console.log('[matches refresh]', result);
      // Re-render
      openMatchesModal();
    } catch (err) {
      alert('Erro ao atualizar: ' + err.message);
      refreshBtn.textContent = '↻ Atualizar';
      refreshBtn.disabled = false;
    }
  };
  root.appendChild(overlay);
  root.appendChild(card);

  let resp;
  try {
    const r = await fetch(`/api/profiles/${profile.id}/matches`);
    if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
    resp = await r.json();
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'text-sm text-red-600' }, `Erro: ${err.message}`));
    return;
  }

  const matches = resp.matches || [];
  body.innerHTML = '';

  if (matches.length === 0) {
    body.appendChild(el('div', { class: 'text-sm text-slate-500 text-center py-8' },
      'Nenhum jogo carregado ainda. Faça uma sync.',
    ));
    return;
  }

  // Sumário no topo
  const wins = matches.filter(m => m.result === 'W').length;
  const losses = matches.filter(m => m.result === 'L').length;
  const pct = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0';
  const yearRange = (() => {
    const ys = matches.map(m => m.year).filter(Boolean);
    if (!ys.length) return '';
    const min = Math.min(...ys), max = Math.max(...ys);
    return min === max ? `${min}` : `${min}–${max}`;
  })();

  body.appendChild(el('div', { class: 'mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200' },
    el('div', { class: 'text-xs uppercase tracking-wide text-slate-500' }, `Anos ${yearRange}`),
    el('div', { class: 'text-base font-semibold text-slate-900 mt-0.5' },
      `${matches.length} jogos · ${wins}V ${losses}D · ${pct.replace('.', ',')}%`,
    ),
    el('div', { class: 'text-[11px] text-slate-500 mt-1' },
      'Fonte: Tênis Integrado · Atualizado a cada sync',
    ),
  ));

  // Agrupa por torneio. Ordem dos torneios: mais recente primeiro
  // (por endDate). Dentro do torneio: cronológica das rondas (R32 → F).
  const ROUND_RANK = { R128: 0, R64: 1, R32: 2, R16: 3, QF: 4, SF: 5, Final: 6, TT: 7 };
  const parseDmy = (s) => {
    if (!s) return 0;
    const [d, m, y] = s.split('/').map(Number);
    if (!d || !m || !y) return 0;
    return new Date(y, m - 1, d).getTime();
  };

  const byTournament = new Map();
  for (const m of matches) {
    const key = m.tournamentId || m.tournamentName;
    if (!byTournament.has(key)) byTournament.set(key, { meta: m, items: [] });
    byTournament.get(key).items.push(m);
  }
  // Sort dentro de cada torneio (R32 antes de Final = ordem cronológica do evento)
  for (const g of byTournament.values()) {
    g.items.sort((a, b) => (ROUND_RANK[a.round] ?? 99) - (ROUND_RANK[b.round] ?? 99));
  }
  // Sort entre torneios — mais recente primeiro
  const ordered = [...byTournament.values()].sort((a, b) => {
    const da = parseDmy(a.meta.endDate || a.meta.date);
    const db = parseDmy(b.meta.endDate || b.meta.date);
    return db - da;
  });

  for (const { meta, items } of ordered) {
    const groupCard = el('div', { class: 'mb-3 rounded-lg border border-slate-200 overflow-hidden' });
    groupCard.appendChild(el('div', { class: 'bg-slate-50 px-3 py-2 border-b border-slate-200' },
      el('div', { class: 'text-sm font-medium text-slate-900' }, meta.tournamentName || '—'),
      el('div', { class: 'text-[11px] text-slate-500 mt-0.5' },
        [
          meta.tier && `${meta.tier}`,
          meta.category && `${meta.category}`,
          meta.city && meta.state && `${meta.city}/${meta.state}`,
          meta.endDate,
        ].filter(Boolean).join(' · '),
      ),
    ));

    const list = el('ul', { class: 'divide-y divide-slate-100' });
    for (const m of items) {
      const isW = m.result === 'W';
      const dot = el('span', {
        class: `inline-block w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white ${isW ? 'bg-emerald-500' : 'bg-rose-500'}`,
      }, isW ? 'V' : 'D');
      const oppText = m.opponentNames && m.opponentNames.length > 1
        ? m.opponentNames.join(' · ')
        : m.opponentName || '?';
      list.appendChild(el('li', { class: 'px-3 py-2 flex items-center gap-3 text-sm' },
        el('div', { class: 'shrink-0 w-12 text-[11px] text-slate-500 uppercase tracking-wide' }, m.round || '?'),
        dot,
        el('div', { class: 'min-w-0 flex-1' },
          el('div', { class: 'text-slate-900 truncate' }, oppText),
          el('div', { class: 'text-[11px] text-slate-500 mt-0.5' },
            m.scoreRaw || (m.wo ? 'W.O.' : '—'),
            m.isDoubles ? ' · duplas' : '',
            m.hasSuperTiebreak ? ' · super-TB' : '',
          ),
        ),
      ));
    }
    groupCard.appendChild(list);
    body.appendChild(groupCard);
  }
}

function openAthleteCard() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  const data = state.data;
  if (!profile || !data) return;
  const athlete = data.athlete || {};
  const tournaments = data.tournaments || [];
  const today = startOfToday();

  // Próximo / último: só conta torneios inscritos e com inscrição paga
  const willPlay = (t) => {
    const givenUp = !!t.notes?.manualGiveUp;
    if (givenUp) return false;
    const inscribed = t.isAnnaInscribed || t.notes?.manualInscribed;
    const paid = !t.pendingPayment;
    return !!(inscribed && paid);
  };
  const future = tournaments
    .filter(t => willPlay(t) && brToDate(t.startDate) && brToDate(t.startDate) >= today)
    .sort((a, b) => (brToIso(a.startDate) || '').localeCompare(brToIso(b.startDate) || ''));
  const past = tournaments
    .filter(t => willPlay(t) && brToDate(t.endDate) && brToDate(t.endDate) < today)
    .sort((a, b) => (brToIso(b.endDate) || '').localeCompare(brToIso(a.endDate) || ''));
  const next = future[0];
  const last = past[0];

  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };

  const name = athlete.name || profile.athleteName || 'Atleta';
  const initials = userInitials(name);
  const rankCBT = athlete.rankingNational;
  // Ranking regional — UF detectada dinamicamente. Mantém fallback pro
  // campo antigo `rankingDF` enquanto synced.json ainda não foi reescrito.
  const rankRegional = athlete.rankingRegional || (athlete.rankingDF ? {
    uf: 'DF',
    regionalPosition: athlete.rankingDF.dfPosition,
    totalRegional: athlete.rankingDF.totalDF,
    cutoffDate: athlete.rankingDF.cutoffDate,
  } : null);
  const wtn = athlete.wtn;
  const cutoff = rankRegional?.cutoffDate;

  const tile = (label, value, hint, accent = 'cyan') => {
    const accentClass = {
      cyan:    'border-cyan-200    bg-cyan-50    text-cyan-900',
      emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      amber:   'border-amber-200   bg-amber-50   text-amber-900',
      slate:   'border-slate-200   bg-slate-50   text-slate-900',
    }[accent];
    return el('div', { class: `rounded-lg border ${accentClass} p-3` },
      el('div', { class: 'text-[10px] font-semibold uppercase tracking-wide opacity-70' }, label),
      el('div', { class: 'text-xl font-bold leading-tight mt-0.5' }, value),
      hint && el('div', { class: 'text-[11px] opacity-70 mt-0.5' }, hint),
    );
  };

  const sectionHeader = (title) => el('h3', {
    class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2',
  }, title);

  const tournamentMini = (icon, label, t) => el('div', { class: 'rounded-lg border border-slate-200 bg-white p-3' },
    el('div', { class: 'flex items-center gap-1.5 text-[11px] text-slate-500 mb-1' }, icon, label),
    el('div', { class: 'text-sm font-medium text-slate-900 leading-snug' }, t.name),
    el('div', { class: 'text-xs text-slate-600 mt-0.5' },
      `${[t.city, t.state].filter(Boolean).join(' / ')} • ${formatCardDate(t)} (${relativeDateLabel(t)})`,
    ),
  );

  const rankingTiles = (rankCBT || rankRegional?.regionalPosition || wtn) && el('div', null,
    sectionHeader(cutoff ? `Rankings · recorte ${cutoff}` : 'Rankings'),
    el('div', { class: 'grid grid-cols-2 gap-2' },
      rankCBT && tile(
        `CBT ${rankCBT.year} ${rankCBT.category}`,
        `${rankCBT.position}º`,
        `${rankCBT.points} pts`,
        'slate',
      ),
      rankRegional?.regionalPosition && tile(
        `Recorte ${rankRegional.uf || 'UF'}`,
        `${rankRegional.regionalPosition}º`,
        rankRegional.totalRegional ? `de ${rankRegional.totalRegional}` : 'no recorte do nacional',
        'slate',
      ),
      wtn && tile('WTN simples', wtn.single, 'world tennis number', 'slate'),
      wtn && tile('WTN duplas', wtn.double, 'world tennis number', 'slate'),
    ),
  );

  const desempenho = athlete.desempenho;
  const performanceBlock = desempenho && (desempenho.byYear?.length || desempenho.total?.wins || desempenho.total?.losses) && (() => {
    const pct = (w, l) => {
      const total = (w || 0) + (l || 0);
      return total > 0 ? `${((w / total) * 100).toFixed(1).replace('.', ',')}%` : '—';
    };
    const yearTile = (label, w, l, sw, sl, gw, gl, accent = 'cyan') => {
      const total = (w || 0) + (l || 0);
      const accentClass = {
        cyan:    'border-cyan-200    bg-cyan-50    text-cyan-900',
        emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        slate:   'border-slate-200   bg-slate-50   text-slate-900',
      }[accent];
      return el('div', { class: `rounded-lg border ${accentClass} p-3` },
        el('div', { class: 'text-[10px] font-semibold uppercase tracking-wide opacity-70' }, label),
        el('div', { class: 'text-2xl font-bold leading-tight mt-0.5' }, pct(w, l)),
        el('div', { class: 'text-[11px] opacity-80 mt-0.5' }, `${w}V · ${l}D · ${total}J`),
        (sw || sl) && el('div', { class: 'text-[10px] opacity-70 mt-0.5' }, `Sets ${sw}/${sw + sl} · Games ${gw}/${gw + gl}`),
      );
    };
    const yearNow = today.getFullYear();
    const cur = desempenho.byYear?.find(y => y.year === yearNow);
    const total = desempenho.total || {};
    return el('div', null,
      sectionHeader('Desempenho'),
      el('div', { class: 'grid grid-cols-2 gap-2' },
        cur
          ? yearTile(`Em ${yearNow}`, cur.wins, cur.losses, cur.setWins, cur.setLosses, cur.gameWins, cur.gameLosses, 'cyan')
          : tile(`Em ${yearNow}`, '—', 'sem jogos no ano', 'slate'),
        yearTile('Geral', total.wins || 0, total.losses || 0, total.setWins || 0, total.setLosses || 0, total.gameWins || 0, total.gameLosses || 0, 'emerald'),
      ),
      el('div', { class: 'mt-2 flex flex-wrap items-center gap-x-3 gap-y-1' },
        el('button', {
          class: 'text-xs text-cyan-700 hover:text-cyan-900 underline decoration-dotted',
          onClick: () => { close(); openMatchesModal(); },
        }, 'Ver histórico de jogos →'),
      ),
    );
  })();

  // Placeholder pra análise estatística — preenchido async por loadAnalyticsInto
  const analyticsBlock = el('div', null);

  const calendarBlock = (next || last) && el('div', null,
    sectionHeader('Calendário'),
    el('div', { class: 'space-y-2' },
      next && tournamentMini('📅', 'Próximo torneio', next),
      last && tournamentMini('🏆', 'Último torneio', last),
    ),
  );
  const noTournaments = !next && !last && el('div', { class: 'text-sm text-slate-500 text-center py-4 border border-dashed border-slate-200 rounded-lg' },
    'Nenhum torneio carregado ainda.',
  );

  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden',
  },
    el('div', { class: 'shrink-0 bg-gradient-to-br from-[#0e3a4d] to-[#1f5b75] text-white px-5 pt-4 pb-5' },
      el('div', { class: 'flex items-start justify-between gap-3 mb-3' },
        el('div', { class: 'min-w-0 flex items-center gap-3' },
          el('span', { class: 'shrink-0 w-12 h-12 rounded-full bg-white/15 border border-white/20 text-white text-base font-semibold flex items-center justify-center' }, initials),
          el('div', { class: 'min-w-0' },
            el('h2', { class: 'text-lg font-semibold truncate' }, name),
          ),
        ),
        el('button', { class: 'shrink-0 text-white/70 hover:text-white text-xl leading-none', onClick: close, title: 'Fechar' }, '×'),
      ),
      athlete.profileUrl && el('a', {
        href: athlete.profileUrl, target: '_blank', rel: 'noopener',
        class: 'inline-flex items-center gap-1 text-xs text-cyan-200 hover:text-white',
      }, 'Ver perfil no Tênis Integrado ↗'),
      athlete.id && !athlete.profileUrl && el('div', { class: 'text-xs text-white/60' }, `ID TI ${athlete.id}`),
    ),
    el('div', { class: 'flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4' },
      analyticsBlock,
      performanceBlock,
      rankingTiles,
      calendarBlock,
      noTournaments,
    ),
  );
  root.appendChild(overlay);
  root.appendChild(card);

  // Lazy-load analytics — não bloqueia abertura do modal
  loadAnalyticsInto(analyticsBlock, profile.id);
}

// Renderiza a seção "Análise estatística" no card do atleta. Lazy-fetch
// pra não bloquear a abertura. Usa Glicko-2 + Expected vs Realized + top
// surprises calculados no backend (`/api/profiles/:id/analytics`).
async function loadAnalyticsInto(container, profileId) {
  container.innerHTML = '';
  const sectionH = el('h3', { class: 'text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3' }, 'Performance');
  container.appendChild(sectionH);
  container.appendChild(el('div', { class: 'text-xs text-slate-400 italic' }, 'Calculando…'));

  let data;
  try {
    const r = await fetch(`/api/profiles/${profileId}/analytics`);
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    data = await r.json();
  } catch (err) {
    container.innerHTML = '';
    container.appendChild(sectionH);
    container.appendChild(el('div', { class: 'text-xs text-red-600' }, `Erro: ${err.message}`));
    return;
  }

  if (data.counts.analyzed === 0) {
    container.innerHTML = '';
    container.appendChild(sectionH);
    container.appendChild(el('div', { class: 'text-xs text-slate-400 italic' },
      `Sem matches analisáveis (excluídos: ${data.counts.excluded.wo} WOs, ${data.counts.excluded.doubles} duplas).`,
    ));
    return;
  }

  container.innerHTML = '';
  container.appendChild(sectionH);

  // ─── CTA — Análise estatística completa (no topo) ────────────────
  // Aparece antes da análise interativa pra que o usuário veja o
  // produto principal (relatório técnico assinado) já de cara, e
  // tenha acesso aos relatórios já entregues caso haja.
  container.appendChild(renderReportCta(profileId));

  const N = data.narratives || {};

  // Helper pra renderizar parágrafo com **bold** (estilo simples markdown)
  const para = (text, cls = 'text-[12px] leading-relaxed text-slate-700 mt-2') => {
    if (!text) return null;
    const div = el('div', { class: cls });
    // Substitui **bold** por <strong>
    const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    div.innerHTML = html;
    return div;
  };

  // ─── HEADLINE — frase de abertura "em uma frase" ──────────────────
  if (N.headline) {
    container.appendChild(el('div', { class: 'rounded-lg border border-cyan-200 bg-cyan-50 p-3 mb-3' },
      el('div', { class: 'text-[10px] font-semibold uppercase tracking-wide text-cyan-700 mb-1' }, 'Em uma frase'),
      el('div', { class: 'text-[13px] leading-relaxed text-slate-800' }, N.headline),
    ));
  }

  // ─── NÍVEL DE JOGO — Glicko + sparkline ──────────────────────────
  const ratingTile = el('div', { class: 'rounded-lg border border-violet-200 bg-violet-50 text-violet-900 p-3 mb-3' });
  ratingTile.appendChild(el('div', { class: 'flex items-baseline justify-between' },
    el('div', { class: 'text-[10px] font-semibold uppercase tracking-wide opacity-70' }, 'Nível de jogo'),
    el('div', { class: 'text-[10px] opacity-60' }, `n=${data.counts.analyzed} partidas`),
  ));
  ratingTile.appendChild(el('div', { class: 'text-3xl font-bold leading-tight mt-0.5' },
    `${data.athleteRating.r}`,
    el('span', { class: 'text-base font-normal opacity-70 ml-1' }, ` ± ${data.athleteRating.rd}`),
  ));
  ratingTile.appendChild(el('div', { class: 'text-[11px] opacity-80 mt-0.5' },
    `Faixa: ${data.athleteRating.ci95.lower}–${data.athleteRating.ci95.upper}`,
  ));

  // Sparkline
  const hist = data.ratingHistory || [];
  if (hist.length >= 2) {
    const W = 380, H = 70, PAD = 6;
    const rs = hist.map(h => h.r);
    const lowerBound = hist.map(h => h.r - 1.96 * h.rd);
    const upperBound = hist.map(h => h.r + 1.96 * h.rd);
    const yMin = Math.min(...lowerBound) - 30;
    const yMax = Math.max(...upperBound) + 30;
    const yRange = yMax - yMin || 1;
    const xStep = (W - 2 * PAD) / (hist.length - 1);
    const yOf = (v) => H - PAD - ((v - yMin) / yRange) * (H - 2 * PAD);
    const xOf = (i) => PAD + i * xStep;

    let band = `M ${xOf(0)} ${yOf(upperBound[0])}`;
    for (let i = 1; i < hist.length; i++) band += ` L ${xOf(i)} ${yOf(upperBound[i])}`;
    for (let i = hist.length - 1; i >= 0; i--) band += ` L ${xOf(i)} ${yOf(lowerBound[i])}`;
    band += ' Z';

    let line = `M ${xOf(0)} ${yOf(rs[0])}`;
    for (let i = 1; i < hist.length; i++) line += ` L ${xOf(i)} ${yOf(rs[i])}`;

    const sparkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sparkSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    sparkSvg.setAttribute('class', 'w-full block mt-2');
    sparkSvg.style.height = '70px';
    sparkSvg.innerHTML = `
      <path d="${band}" fill="rgba(167, 139, 250, 0.3)" stroke="none"/>
      <path d="${line}" fill="none" stroke="rgb(124, 58, 237)" stroke-width="2"/>
      <circle cx="${xOf(hist.length - 1)}" cy="${yOf(rs[rs.length - 1])}" r="4" fill="rgb(124, 58, 237)"/>
    `;
    ratingTile.appendChild(sparkSvg);
    ratingTile.appendChild(el('div', { class: 'text-[10px] opacity-60 mt-1' },
      'Evolução do nível ao longo das partidas, com banda de incerteza (95%)',
    ));
  }
  if (N.rating) ratingTile.appendChild(para(N.rating, 'text-[12px] leading-relaxed text-violet-900 mt-2'));
  container.appendChild(ratingTile);

  // ─── FORMA RECENTE — 3 janelas temporais ─────────────────────────
  if (data.forma) {
    const f = data.forma;
    const formaRow = (label, w, t) => {
      const pct = t > 0 ? Math.round((w / t) * 100) : 0;
      const barColor = pct >= 50 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-rose-500';
      return el('div', { class: 'flex items-center gap-2 text-[12px] py-1' },
        el('div', { class: 'shrink-0 w-36 text-slate-600' }, label),
        el('div', { class: 'flex-1 h-4 bg-slate-100 rounded overflow-hidden relative' },
          el('div', { class: `${barColor} h-full`, style: `width: ${pct}%` }),
          el('div', { class: 'absolute inset-0 flex items-center justify-end pr-1 text-[10px] text-slate-700 font-medium' },
            t > 0 ? `${pct}% · ${w}V ${t - w}D` : 'sem dados',
          ),
        ),
      );
    };
    const formaTile = el('div', { class: 'rounded-lg border border-slate-200 bg-white p-3 mb-3' },
      el('div', { class: 'text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2' }, 'Forma recente'),
      formaRow('Últimos 3 meses', f.last90.wins, f.last90.total),
      formaRow('Últimos 12 meses', f.last365.wins, f.last365.total),
      formaRow('Histórico todo', f.allTime.wins, f.allTime.total),
    );
    if (N.forma) formaTile.appendChild(para(N.forma));
    container.appendChild(formaTile);
  }

  // ─── COMO ELA GANHA E PERDE — buckets ────────────────────────────
  const buckets = data.bucketPerformance;
  const bucketLabel = {
    strong: 'Adversária mais forte',
    even:   'Mesmo nível',
    weak:   'Adversária mais fraca',
  };
  const bucketRow = (key) => {
    const b = buckets[key];
    const tot = b.w + b.l;
    const pct = tot > 0 ? Math.round((b.w / tot) * 100) : 0;
    const barColor = pct >= 50 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-500' : 'bg-rose-500';
    return el('div', { class: 'flex items-center gap-2 text-[12px] py-1' },
      el('div', { class: 'shrink-0 w-36 text-slate-600' }, bucketLabel[key]),
      el('div', { class: 'flex-1 h-4 bg-slate-100 rounded overflow-hidden relative' },
        el('div', { class: `${barColor} h-full`, style: `width: ${pct}%` }),
        el('div', { class: 'absolute inset-0 flex items-center justify-end pr-1 text-[10px] text-slate-700 font-medium' },
          tot > 0 ? `${pct}% · ${b.w}V ${b.l}D` : 'sem dados',
        ),
      ),
    );
  };
  const bucketTile = el('div', { class: 'rounded-lg border border-slate-200 bg-white p-3 mb-3' },
    el('div', { class: 'text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2' }, 'Como ela ganha e perde'),
    bucketRow('strong'),
    bucketRow('even'),
    bucketRow('weak'),
  );
  if (N.bucket) bucketTile.appendChild(para(N.bucket));
  container.appendChild(bucketTile);

  // ─── ESPERADO vs REALIZADO ───────────────────────────────────────
  const ou = data.over_under;
  const evrColor = Math.abs(ou.delta) < 0.5 ? 'slate' : ou.delta >= 0 ? 'emerald' : 'rose';
  const evrAccent = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    rose:    'border-rose-200    bg-rose-50    text-rose-900',
    slate:   'border-slate-200   bg-slate-50   text-slate-900',
  }[evrColor];
  const evrSign = ou.delta > 0 ? '+' : '';
  const evrTile = el('div', { class: `rounded-lg border ${evrAccent} p-3 mb-3` },
    el('div', { class: 'text-[10px] font-semibold uppercase tracking-wide opacity-70' }, 'Esperado vs Realizado'),
    el('div', { class: 'text-2xl font-bold leading-tight mt-0.5' },
      `${evrSign}${ou.delta} vitória${Math.abs(ou.delta) === 1 ? '' : 's'}`,
    ),
    el('div', { class: 'text-[11px] opacity-80 mt-0.5' },
      `Esperado ${data.expected.wins} · Real ${data.realized.wins}`,
    ),
  );
  if (N.expectedRealized) evrTile.appendChild(para(N.expectedRealized, `text-[12px] leading-relaxed mt-2 opacity-90`));
  container.appendChild(evrTile);

  // ─── MOMENTOS QUE SE DESTACARAM ──────────────────────────────────
  if (N.topPositive || N.topNegative) {
    container.appendChild(el('div', { class: 'text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2 mt-1' },
      'Momentos que se destacaram',
    ));

    if (N.topPositive) {
      const t = N.topPositive;
      container.appendChild(el('div', { class: 'rounded-lg border border-emerald-200 bg-emerald-50 p-3 mb-2' },
        el('div', { class: 'text-[11px] font-bold text-emerald-700' }, '★ ' + t.title),
        el('div', { class: 'text-[12px] text-slate-800 mt-0.5' }, t.line1),
        el('div', { class: 'text-[12px] text-slate-700 mt-0.5' }, `Placar: ${t.score || '—'}`),
        el('div', { class: 'text-[12px] text-slate-700 leading-relaxed mt-1.5' }, t.paragraph),
      ));
    }

    if (N.topNegative) {
      const t = N.topNegative;
      container.appendChild(el('div', { class: 'rounded-lg border border-rose-200 bg-rose-50 p-3 mb-2' },
        el('div', { class: 'text-[11px] font-bold text-rose-700' }, '✗ ' + t.title),
        el('div', { class: 'text-[12px] text-slate-800 mt-0.5' }, t.line1),
        el('div', { class: 'text-[12px] text-slate-700 mt-0.5' }, `Placar: ${t.score || '—'}`),
        el('div', { class: 'text-[12px] text-slate-700 leading-relaxed mt-1.5' }, t.paragraph),
      ));
    }
  }


  // Disclaimer
  if (data.counts.excluded.wo > 0 || data.counts.excluded.doubles > 0) {
    const ex = data.counts.excluded;
    const parts = [];
    if (ex.wo > 0) parts.push(`${ex.wo} W.O.`);
    if (ex.doubles > 0) parts.push(`${ex.doubles} duplas`);
    container.appendChild(el('div', { class: 'mt-3 text-[10px] text-slate-400 italic' },
      `Excluídos da análise: ${parts.join(' e ')}.`,
    ));
  }
}

// CTA no topo do modal de Performance: 2 botões — "Solicitar análise" +
// "Ver relatórios" (count). Atualiza dinamicamente conforme novos
// relatórios são entregues.
function renderReportCta(profileId) {
  const wrap = el('div', { class: 'rounded-lg border border-slate-200 bg-slate-50 p-3 mb-3' });
  wrap.appendChild(el('div', { class: 'flex items-center gap-2 text-[11px] font-semibold text-slate-700 mb-1' }, '📊 Análise estatística completa'));
  wrap.appendChild(el('div', { class: 'text-[12px] text-slate-600 leading-relaxed' },
    'Cada partida revela um padrão. Veja o retrato técnico do jogo do atleta — onde está, onde evolui e onde focar. Análise assinada pelo estatístico responsável.',
  ));
  const btnRow = el('div', { class: 'mt-2 flex gap-2 flex-wrap' });
  btnRow.appendChild(el('button', {
    class: 'text-xs px-3 py-1.5 rounded bg-[#0e3a4d] text-white hover:bg-[#16526a]',
    onClick: () => {
      const profile = state.profiles.find(p => p.id === profileId);
      const athleteName = profile?.athleteName || profile?.tiEmail || 'Atleta';
      openCompleteReportRequestModal(athleteName);
    },
  }, 'Solicitar análise completa →'));
  const viewBtn = el('button', {
    class: 'text-xs px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50',
    onClick: () => openDeliveredReportsModal(profileId),
  }, '📂 Ver relatórios');
  viewBtn.disabled = true;
  viewBtn.title = 'Carregando relatórios entregues…';
  btnRow.appendChild(viewBtn);
  wrap.appendChild(btnRow);

  // Link "Veja um exemplo" só aparece quando o atleta ainda não tem
  // relatório próprio entregue — quem já tem, vê o seu na lista.
  // Adicionado depois do then() abaixo, pra não piscar antes de saber
  // se há entregas.

  // Carrega lista assíncrona pra ajustar o botão, contagem e exibir
  // (ou não) o link de exemplo.
  api.listProfileReports(profileId).then(reports => {
    if (!reports.length) {
      viewBtn.textContent = '📂 Sem relatórios ainda';
      viewBtn.title = 'Nenhum relatório foi entregue até o momento';
      // disabled segue
      // Mostra o exemplo só pra quem ainda não conhece o produto
      wrap.appendChild(el('a', {
        class: 'mt-2 inline-flex items-center gap-1 text-[11px] text-cyan-700 hover:text-cyan-900 underline',
        href: '/exemplo-relatorio.pdf',
        target: '_blank',
        rel: 'noopener',
      }, '📄 Veja um exemplo de relatório →'));
    } else {
      viewBtn.textContent = `📂 Ver relatórios (${reports.length})`;
      viewBtn.title = `${reports.length} relatório${reports.length > 1 ? 's' : ''} entregue${reports.length > 1 ? 's' : ''}`;
      viewBtn.disabled = false;
    }
  }).catch(() => {
    viewBtn.textContent = '📂 Ver relatórios';
    viewBtn.title = 'Erro ao carregar';
  });

  return wrap;
}

// Modal: lista de relatórios entregues. Usuário escolhe qual ver, abre em
// nova aba. Ao abrir, marca o alerta correspondente como visto pra
// limpar o badge do sino.
async function openDeliveredReportsModal(profileId) {
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 80vh;',
  });
  card.appendChild(el('div', { class: 'bg-[#0e3a4d] text-white px-5 py-3 flex items-center justify-between' },
    el('span', { class: 'font-medium' }, '📂 Relatórios entregues'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  ));
  const body = el('div', { class: 'px-5 py-4 overflow-y-auto flex-1' });
  body.appendChild(el('div', { class: 'text-sm text-slate-500 italic' }, 'Carregando…'));
  card.appendChild(body);
  root.appendChild(overlay);
  root.appendChild(card);

  let reports;
  try {
    reports = await api.listProfileReports(profileId);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'text-sm text-red-600' }, `Erro: ${err.message}`));
    return;
  }
  body.innerHTML = '';
  if (!reports.length) {
    body.appendChild(el('div', { class: 'text-sm text-slate-500 italic py-6 text-center' },
      'Nenhum relatório entregue ainda. Quando o estatístico finalizar a análise, aparece aqui.'));
    return;
  }

  body.appendChild(el('p', { class: 'text-xs text-slate-500 mb-3' },
    'Toque em um relatório pra abrir em nova aba. A cada nova edição que entregarmos, ele aparece aqui.'));

  const list = el('ul', { class: 'space-y-2' });
  reports.forEach((r, i) => {
    const date = r.deliveredAt ? new Date(r.deliveredAt).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    }) : '—';
    const edicao = reports.length - i; // mais recente = maior número de edição
    const item = el('li', {
      class: 'border border-slate-200 rounded-lg p-3 hover:bg-slate-50 cursor-pointer flex items-center gap-3',
      onClick: () => {
        window.open(`/api/profiles/${profileId}/reports/${r.reportId}`, '_blank', 'noopener');
        close();
      },
    },
      el('div', { class: 'flex-1 min-w-0' },
        el('div', { class: 'text-sm font-semibold text-slate-900' },
          `📊 Relatório de Performance — ${edicao}ª edição`),
        el('div', { class: 'text-xs text-slate-500 mt-0.5' }, `Entregue em ${date}`),
      ),
      el('div', { class: 'text-cyan-700 text-sm font-semibold' }, 'Abrir →'),
    );
    list.appendChild(item);
  });
  body.appendChild(list);
}

// ===== Scout ao Vivo (live match tracking) =====

// Modal lista: matches em curso + form pra criar novo
function openScoutListModal() {
  const profileId = state.activeProfileId;
  if (!profileId) return alert('Selecione um perfil');
  const profile = state.profiles.find(p => p.id === profileId);
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-1rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 92dvh;',
  });
  card.appendChild(el('div', { class: 'bg-gradient-to-br from-[#0e3a4d] to-[#1f5b75] text-white px-5 py-3 flex items-center justify-between' },
    el('span', { class: 'font-medium' }, '🎾 Scout ao Vivo'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  ));
  const body = el('div', { class: 'px-5 py-4 overflow-y-auto flex-1 space-y-4' });
  card.appendChild(body);
  root.append(overlay, card);

  body.appendChild(el('div', { class: 'text-xs text-slate-500 italic' }, 'Carregando…'));

  api.listLiveMatches(profileId).then(matches => {
    body.innerHTML = '';
    const live = matches.filter(m => !m.finished);
    const past = matches.filter(m => m.finished);

    // Botão criar novo match
    body.appendChild(el('button', {
      class: 'w-full bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold px-4 py-3 rounded-lg',
      onClick: () => { close(); openScoutCreateModal(profileId); },
    }, '+ Iniciar novo scout'));

    if (live.length) {
      body.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-2' }, 'Em andamento'));
      live.forEach(m => body.appendChild(scoutListItem(m, profileId, close, true)));
    }
    if (past.length) {
      body.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-3' }, 'Já marcados'));
      past.forEach(m => body.appendChild(scoutListItem(m, profileId, close, false)));
    }
    if (!matches.length) {
      body.appendChild(el('div', { class: 'text-sm text-slate-500 italic text-center py-6' },
        'Nenhum scout ainda. Comece pelo botão acima.'));
    }
  }).catch(err => {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'text-sm text-red-600' }, `Erro: ${err.message}`));
  });
}

function scoutListItem(m, profileId, parentClose, isLive) {
  const score = renderScoreSummary(m);
  const ctx = m.tournamentName ? `${m.tournamentName}${m.round ? ` · ${m.round}` : ''}` : (m.source === 'off-ti' ? 'fora do TI' : '');
  const abandonLabel = m.abandoned
    ? `Ret. · ${m.abandonedBy === 'a' ? shortName(m.athleteName) : m.abandonedBy === 'o' ? shortName(m.opponentName) : '—'}`
    : 'Encerrado';
  const statusBadge = isLive
    ? el('span', { class: 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700' }, '● AO VIVO')
    : el('span', { class: 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700' }, abandonLabel);
  // Nota 0-10 inline (cores fixas Anna cyan, adv rose)
  const cs = m.computedScore;
  const noteBadge = cs && (cs.a?.score != null || cs.o?.score != null)
    ? el('div', { class: 'flex gap-1' },
        cs.a?.score != null && el('span', { class: 'text-[10px] font-bold px-2 py-0.5 rounded-full text-cyan-700 bg-cyan-100' }, `Anna ${cs.a.score.toFixed(1).replace('.', ',')}`),
        cs.o?.score != null && el('span', { class: 'text-[10px] font-bold px-2 py-0.5 rounded-full text-rose-700 bg-rose-100' }, `Adv ${cs.o.score.toFixed(1).replace('.', ',')}`),
      )
    : null;

  // Lixeira fica na linha inferior, sem sobrepor badges. stopPropagation
  // pra não abrir o tracking ao clicar.
  const deleteBtn = el('button', {
    class: 'text-slate-300 hover:text-rose-500 text-base leading-none p-1 rounded transition-colors shrink-0',
    title: 'Excluir scout',
  }, '🗑');
  deleteBtn.onclick = async (e) => {
    e.stopPropagation();
    const [_sA, _sO] = dualShortName(m.athleteName, m.opponentName);
    const summary = `${_sA} × ${_sO}${ctx ? ` · ${ctx}` : ''}`;
    if (!(await confirmDialog(`Excluir este scout?\n\n${summary}\n\nNão dá pra desfazer — pontos, stats e notas serão perdidos.`, { danger: true, okLabel: 'Excluir' }))) return;
    try {
      await api.deleteLiveMatch(profileId, m.id);
      parentClose();
      openScoutListModal();
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  };

  const [_titleA, _titleO] = dualShortName(m.athleteName, m.opponentName);
  const wrap = el('div', { class: 'border border-slate-200 rounded-lg p-3 mt-2 cursor-pointer hover:bg-slate-50' });
  const head = el('div', {},
    el('div', { class: 'flex items-start justify-between gap-3 mb-1' },
      el('div', { class: 'min-w-0 flex-1' },
        el('div', { class: 'text-sm font-semibold text-slate-900 truncate' }, `${_titleA} × ${_titleO}`),
        ctx && el('div', { class: 'text-[11px] text-slate-500 truncate' }, ctx),
      ),
      statusBadge,
    ),
    el('div', { class: 'flex items-center justify-between gap-2 mt-1' },
      el('div', { class: 'text-xs text-slate-700 font-medium' }, score),
      el('div', { class: 'flex items-center gap-2' },
        noteBadge,
        deleteBtn,
      ),
    ),
  );
  // Ao vivo: abre tracking pra continuar marcando.
  // Encerrado: abre tracking em modo leitura.
  wrap.onclick = () => { parentClose(); openScoutTrackModal(profileId, m.id); };
  wrap.appendChild(head);
  return wrap;
}

function renderScoreSummary(m) {
  if (!m.setsHistory || !m.currentSet) return '—';
  const sets = m.setsHistory.map(s => `${s.a}-${s.o}`);
  if (!m.finished) sets.push(`${m.currentSet.a}-${m.currentSet.o}*`);
  return sets.join(' · ');
}

// Modal criar: form simples (atleta · adversária · contexto · config)
function openScoutCreateModal(profileId) {
  const profile = state.profiles.find(p => p.id === profileId);
  const athleteName = profile?.athleteName || 'Atleta';
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-1rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 92dvh;',
  });
  card.appendChild(el('div', { class: 'bg-gradient-to-br from-[#0e3a4d] to-[#1f5b75] text-white px-5 py-3 flex items-center justify-between' },
    el('span', { class: 'font-medium' }, '🎾 Novo scout'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  ));
  const body = el('div', { class: 'px-5 py-4 overflow-y-auto flex-1 space-y-3' });
  card.appendChild(body);
  root.append(overlay, card);

  // Atleta
  body.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold' }, 'Atleta'));
  body.appendChild(el('div', { class: 'text-sm font-semibold' }, athleteName));

  // Adversária
  const opponentInput = el('input', {
    type: 'text',
    placeholder: 'Nome da adversária',
    class: 'w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-300',
  });
  body.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-2' }, 'Adversária'));
  body.appendChild(opponentInput);

  // Contexto
  const contextInput = el('input', {
    type: 'text',
    placeholder: 'Ex: G1 Brasiliense · R2 · ou amistoso, treino…',
    class: 'w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-300',
  });
  body.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-2' }, 'Contexto (opcional)'));
  body.appendChild(contextInput);

  // Quem saca
  let firstServer = 'a';
  const btnA = el('button', { class: 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold' }, `🎾 ${athleteName.split(/\s+/)[0]}`);
  const btnO = el('button', { class: 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-slate-300 text-slate-700' }, '🎾 Adversária');
  btnA.onclick = () => {
    firstServer = 'a';
    btnA.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    btnO.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-slate-300 text-slate-700';
  };
  btnO.onclick = () => {
    firstServer = 'o';
    btnO.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    btnA.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-slate-300 text-slate-700';
  };
  body.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-2' }, 'Quem começa sacando?'));
  body.appendChild(el('div', { class: 'flex gap-2' }, btnA, btnO));

  // Formato
  let format = 'best_of_3';
  const formats = [
    ['best_of_3', 'Melhor de 3'],
    ['best_of_3_stb', 'Melhor de 3 + super-TB'],
    ['one_set_match_tb', '1 set + match TB'],
    ['pro_set_8', 'Pro-set 8 games'],
  ];
  const fmtBtns = formats.map(([key, label]) => {
    const b = el('button', { class: 'text-xs px-3 py-2 rounded-lg border border-slate-300 text-slate-700' }, label);
    b.dataset.key = key;
    b.onclick = () => {
      format = key;
      fmtBtns.forEach(x => x.className = 'text-xs px-3 py-2 rounded-lg border border-slate-300 text-slate-700');
      b.className = 'text-xs px-3 py-2 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    };
    return b;
  });
  fmtBtns[0].className = 'text-xs px-3 py-2 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
  body.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-2' }, 'Formato'));
  body.appendChild(el('div', { class: 'grid grid-cols-2 gap-2' }, ...fmtBtns));

  // Ad — par de botões seguindo o padrão de firstServer/format
  let adValue = true;
  const adOn  = el('button', { class: 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold' }, 'Ad');
  const adOff = el('button', { class: 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-slate-300 text-slate-700' }, 'No Ad');
  adOn.onclick = () => {
    adValue = true;
    adOn.className  = 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    adOff.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-slate-300 text-slate-700';
  };
  adOff.onclick = () => {
    adValue = false;
    adOff.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    adOn.className  = 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-slate-300 text-slate-700';
  };
  body.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-2' }, 'Vantagem'));
  body.appendChild(el('div', { class: 'flex gap-2' }, adOn, adOff));
  body.appendChild(el('div', { class: 'text-[11px] text-slate-500 mt-1' }, 'No Ad = no 40-40 o ponto seguinte decide o game.'));

  // Botão criar
  const errBox = el('div', { class: 'text-xs text-red-600 hidden' });
  body.appendChild(errBox);
  const submitBtn = el('button', {
    class: 'w-full bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-bold px-4 py-3 rounded-lg mt-3',
  }, '▶ Iniciar tracking');
  submitBtn.onclick = async () => {
    const opponent = opponentInput.value.trim();
    if (!opponent) {
      errBox.textContent = 'Informe o nome da adversária';
      errBox.classList.remove('hidden');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Criando…';
    try {
      const m = await api.createLiveMatch(profileId, {
        opponentName: opponent,
        athleteName,
        tournamentName: contextInput.value.trim() || null,
        config: { format, ad: adValue, firstServer },
      });
      close();
      openScoutTrackModal(profileId, m.id);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = '▶ Iniciar tracking';
    }
  };
  body.appendChild(submitBtn);
  setTimeout(() => opponentInput.focus(), 50);
}

// Bottom sheet: pergunta quem abandonou antes de confirmar encerramento.
// Retorna 'a', 'o', ou null (cancelado).
// Quando o scout chegou até aqui, a partida ESTAVA rolando — então não é
// W.O. (W.O. = não houve jogo, scout deve ser apagado, não encerrado).
// Aqui sempre é RET (Retirement): alguém parou. Retorna { side, reason } | null.
function pickAbandonSide(athleteName, opponentName) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const done = (result) => { root.remove(); resolve(result); };
    const [shortA, shortB] = dualShortName(athleteName, opponentName);
    const btn = (label, color, side) => el('button', {
      class: `w-full py-3 rounded-xl text-sm font-bold text-white transition-opacity active:opacity-70 ${color}`,
      onClick: () => done({ side, reason: 'ret' }),
    }, label);
    root.append(
      el('div', { class: 'fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4', onClick: (e) => { if (e.currentTarget === e.target) done(null); } },
        el('div', { class: 'bg-white rounded-2xl px-5 py-5 max-w-sm w-full shadow-2xl' },
          el('div', { class: 'text-sm font-bold text-slate-800 mb-1 text-center' }, 'Quem parou?'),
          el('div', { class: 'text-xs text-slate-400 mb-5 text-center' }, 'A partida será encerrada como RET (Retirement) — alguém desistiu durante o jogo.'),
          el('div', { class: 'flex flex-col gap-2' },
            btn(shortA, 'bg-cyan-600 hover:bg-cyan-700', 'a'),
            btn(shortB, 'bg-rose-600 hover:bg-rose-700', 'o'),
            el('button', {
              class: 'w-full py-3 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200',
              onClick: () => done(null),
            }, 'Cancelar'),
          ),
        ),
      ),
    );
  });
}

// Modal "Encerrar match" com 2 caminhos: placar final manual OU RET.
// Retorna { kind: 'sets', sets: [{a,o}] } | { kind: 'ret', side: 'a'|'o' } | null.
// Mesma estética visual do app (modal branco). Usado no owner E poderia ser
// reaproveitado no scouter público no futuro.
function pickFinalizeOrRet(athleteName, opponentName) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let phase = 'choice'; // 'choice' | 'sets' | 'ret'
    const cardWrap = el('div', { class: 'space-y-3' });
    function done(result) { root.remove(); resolve(result); }
    function renderPhase(p) {
      phase = p;
      cardWrap.innerHTML = '';
      const back = el('button', {
        class: 'w-full py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 underline',
        onClick: () => renderPhase('choice'),
      }, '← Voltar');
      if (phase === 'choice') {
        cardWrap.appendChild(el('div', { class: 'text-sm font-bold text-slate-800 text-center' }, 'Encerrar match'));
        cardWrap.appendChild(el('div', { class: 'text-xs text-slate-500 text-center' }, 'Como o jogo terminou?'));
        cardWrap.appendChild(el('div', { class: 'flex flex-col gap-2 mt-3' },
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700',
            onClick: () => renderPhase('sets'),
          }, 'Marcar placar final'),
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-amber-700 hover:bg-amber-800',
            onClick: () => renderPhase('ret'),
          }, 'Retirement (alguém parou)'),
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 mt-1',
            onClick: () => done(null),
          }, 'Cancelar'),
        ));
      } else if (phase === 'sets') {
        cardWrap.appendChild(el('div', { class: 'text-sm font-bold text-slate-800 text-center' }, 'Placar final'));
        cardWrap.appendChild(el('div', { class: 'text-xs text-slate-500 text-center' }, 'Games por set. Deixe vazio o set que não houve.'));
        const [shortA, shortB] = dualShortName(athleteName, opponentName);
        const inputs = [];
        function makeSetRow(idx) {
          const inA = el('input', {
            type: 'number', min: '0', max: '99', placeholder: '—',
            class: 'w-16 text-center text-base font-bold bg-white text-slate-900 border border-slate-300 rounded px-2 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-400',
          });
          const inO = el('input', {
            type: 'number', min: '0', max: '99', placeholder: '—',
            class: 'w-16 text-center text-base font-bold bg-white text-slate-900 border border-slate-300 rounded px-2 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-400',
          });
          inputs.push({ a: inA, o: inO });
          return el('div', { class: 'flex items-center justify-center gap-3' },
            el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold w-12 text-right' }, `Set ${idx + 1}`),
            inA,
            el('span', { class: 'text-slate-400' }, '·'),
            inO,
          );
        }
        cardWrap.appendChild(el('div', { class: 'space-y-2 my-2' },
          el('div', { class: 'flex items-center justify-center gap-3 text-[10px] uppercase tracking-wider' },
            el('div', { class: 'w-12' }),
            el('div', { class: 'w-16 text-center text-cyan-700 font-bold truncate' }, shortA),
            el('div', { class: 'opacity-0' }, '·'),
            el('div', { class: 'w-16 text-center text-rose-700 font-bold truncate' }, shortB),
          ),
          makeSetRow(0),
          makeSetRow(1),
          makeSetRow(2),
        ));
        const errBox = el('div', { class: 'hidden text-xs text-rose-600 text-center' });
        cardWrap.appendChild(errBox);
        cardWrap.appendChild(el('button', {
          class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700',
          onClick: () => {
            const sets = [];
            for (const { a, o } of inputs) {
              const va = a.value.trim(), vo = o.value.trim();
              if (!va && !vo) continue;
              if (!va || !vo) { errBox.textContent = 'Preencha os 2 lados do set ou deixe ambos vazios.'; errBox.classList.remove('hidden'); return; }
              sets.push({ a: parseInt(va, 10), o: parseInt(vo, 10) });
            }
            if (!sets.length) { errBox.textContent = 'Informe ao menos 1 set.'; errBox.classList.remove('hidden'); return; }
            done({ kind: 'sets', sets });
          },
        }, 'Salvar placar'));
        cardWrap.appendChild(back);
      } else if (phase === 'ret') {
        const [shortA, shortB] = dualShortName(athleteName, opponentName);
        cardWrap.appendChild(el('div', { class: 'text-sm font-bold text-slate-800 text-center' }, 'Quem parou?'));
        cardWrap.appendChild(el('div', { class: 'text-xs text-slate-500 text-center' }, 'Encerra como RET (Retirement). O placar atual fica como resultado.'));
        cardWrap.appendChild(el('div', { class: 'flex flex-col gap-2 mt-3' },
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700',
            onClick: () => done({ kind: 'ret', side: 'a' }),
          }, shortA),
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700',
            onClick: () => done({ kind: 'ret', side: 'o' }),
          }, shortB),
          back,
        ));
      }
    }
    root.appendChild(el('div', { class: 'fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4', onClick: (e) => { if (e.currentTarget === e.target) done(null); } },
      el('div', { class: 'bg-white rounded-2xl px-5 py-5 max-w-sm w-full shadow-2xl' }, cardWrap),
    ));
    renderPhase('choice');
  });
}

// Modal "Quem venceu este game?" pra game manual (scouter perdeu o
// scout dos pontos). Mesma estética do pickAbandonSide.
function pickGameWinner(athleteName, opponentName) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const done = (winner) => { root.remove(); resolve(winner); };
    const btn = (label, color, winner) => el('button', {
      class: `w-full py-3 rounded-xl text-sm font-bold text-white transition-opacity active:opacity-70 ${color}`,
      onClick: () => done(winner),
    }, label);
    root.append(
      el('div', { class: 'fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4', onClick: (e) => { if (e.currentTarget === e.target) done(null); } },
        el('div', { class: 'bg-white rounded-2xl px-5 py-5 max-w-sm w-full shadow-2xl' },
          el('div', { class: 'text-sm font-bold text-slate-800 mb-1 text-center' }, 'Quem venceu este game?'),
          el('div', { class: 'text-xs text-slate-400 mb-5 text-center' }, 'Use quando perdeu o scout dos pontos. Os pontos do game atual serão descartados.'),
          el('div', { class: 'flex flex-col gap-2' },
            btn(shortName(athleteName), 'bg-cyan-600 hover:bg-cyan-700', 'a'),
            btn(shortName(opponentName), 'bg-rose-600 hover:bg-rose-700', 'o'),
            el('button', {
              class: 'w-full py-3 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200',
              onClick: () => done(null),
            }, 'Cancelar'),
          ),
        ),
      ),
    );
  });
}

// Modal de tracking — coração do Scout ao Vivo
// Modal de aviso estilizado — substitui o alert() nativo.
// Uso: await alertDialog('Mensagem');
function alertDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); padding:1rem;';
    const card = el('div', { class: 'bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden' });
    if (opts.title) card.appendChild(el('div', { class: 'px-5 pt-4 pb-1 text-base font-semibold' }, opts.title));
    card.appendChild(el('div', { class: 'px-5 py-3 text-sm text-slate-700 whitespace-pre-wrap' }, message));
    const okBtn = el('button', { class: 'px-4 py-2 rounded-lg text-white text-sm font-semibold bg-cyan-600 hover:bg-cyan-700' }, opts.okLabel || 'OK');
    card.appendChild(el('div', { class: 'flex justify-end px-5 pb-4' }, okBtn));
    root.appendChild(card);
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    const close = () => {
      document.removeEventListener('keydown', onKey);
      root.remove();
      resolve();
    };
    okBtn.onclick = close;
    root.onclick = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    setTimeout(() => okBtn.focus(), 50);
  });
}

// Modal de input estilizado — substitui o prompt() nativo.
// Uso: const txt = await promptDialog('Digite X:', { placeholder: 'X' });
// Retorna string ou null se cancelado.
function promptDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); padding:1rem;';
    const card = el('div', { class: 'bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden' });
    if (opts.title) card.appendChild(el('div', { class: 'px-5 pt-4 pb-1 text-base font-semibold' }, opts.title));
    card.appendChild(el('div', { class: 'px-5 py-3 text-sm text-slate-700 whitespace-pre-wrap' }, message));
    const input = el('input', {
      type: 'text',
      class: 'mx-5 mb-3 px-3 py-2 border border-slate-300 rounded-lg w-[calc(100%-2.5rem)] text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500',
      placeholder: opts.placeholder || '',
      value: opts.defaultValue || '',
    });
    card.appendChild(input);
    const actions = el('div', { class: 'flex gap-2 justify-end px-5 pb-4' });
    const cancelBtn = el('button', { class: 'px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm font-medium' }, opts.cancelLabel || 'Cancelar');
    const okBtn = el('button', {
      class: `px-4 py-2 rounded-lg text-white text-sm font-semibold ${opts.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-cyan-600 hover:bg-cyan-700'}`,
    }, opts.okLabel || 'OK');
    actions.append(cancelBtn, okBtn);
    card.appendChild(actions);
    root.appendChild(card);
    const onKey = (e) => { if (e.key === 'Escape') close(null); else if (e.key === 'Enter') close(input.value); };
    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      root.remove();
      resolve(result);
    };
    cancelBtn.onclick = () => close(null);
    okBtn.onclick = () => close(input.value);
    root.onclick = (e) => { if (e.target === root) close(null); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    setTimeout(() => input.focus(), 50);
  });
}

// Modal de confirmação estilizado — substitui o confirm() nativo.
// Uso: const ok = await confirmDialog('Excluir?', { danger: true });
function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); padding:1rem;';
    const card = el('div', { class: 'bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden' });
    if (opts.title) card.appendChild(el('div', { class: 'px-5 pt-4 pb-1 text-base font-semibold' }, opts.title));
    card.appendChild(el('div', { class: 'px-5 py-3 text-sm text-slate-700 whitespace-pre-wrap' }, message));
    const actions = el('div', { class: 'flex gap-2 justify-end px-5 pb-4' });
    const cancelBtn = el('button', { class: 'px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm font-medium' }, opts.cancelLabel || 'Cancelar');
    const okBtn = el('button', {
      class: `px-4 py-2 rounded-lg text-white text-sm font-semibold ${opts.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-cyan-600 hover:bg-cyan-700'}`,
    }, opts.okLabel || 'Confirmar');
    actions.append(cancelBtn, okBtn);
    card.appendChild(actions);
    root.appendChild(card);
    const onKey = (e) => { if (e.key === 'Escape') close(false); else if (e.key === 'Enter') close(true); };
    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      root.remove();
      resolve(result);
    };
    cancelBtn.onclick = () => close(false);
    okBtn.onclick = () => close(true);
    root.onclick = (e) => { if (e.target === root) close(false); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    setTimeout(() => okBtn.focus(), 50);
  });
}

async function openScoutTrackModal(profileId, matchId) {
  const root = $('modal-root');
  root.innerHTML = '';
  // Ao fechar, volta pra lista de scouts (não fecha tudo) — UX esperada
  // ao apertar o ← do header.
  const close = () => { root.innerHTML = ''; openScoutListModal(); };

  const overlay = el('div', {
    class: 'fixed inset-0 z-50',
    style: 'background: linear-gradient(135deg, #0a2530 0%, #0e3a4d 100%); overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch;',
  });
  const container = el('div', { class: 'relative max-w-md lg:max-w-5xl mx-auto text-white flex flex-col pb-8' });
  overlay.appendChild(container);
  root.appendChild(overlay);

  // Carrega state
  let m;
  try {
    m = await api.getLiveMatch(profileId, matchId);
  } catch (err) {
    container.appendChild(el('div', { class: 'p-6 text-red-300' }, `Erro: ${err.message}`));
    container.appendChild(el('button', { class: 'm-4 px-4 py-2 rounded bg-white/10', onClick: close }, 'Fechar'));
    return;
  }

  const render = () => {
    container.innerHTML = '';

    // Header
    const isLive = !m.finished;
    // Padding-top respeita safe-area do iOS quando o app é instalado
    // como PWA standalone (apple-mobile-web-app-status-bar-style: black-translucent
    // deixa o status bar transparente sobre o conteúdo).
    container.appendChild(el('div', {
      class: 'px-4 py-3 border-b border-white/10 flex items-center gap-3',
      style: 'padding-top: max(env(safe-area-inset-top), 0.75rem);',
    },
      el('button', { class: 'text-white/70 hover:text-white text-xl', onClick: close }, '←'),
      el('div', { class: 'flex-1 min-w-0' },
        el('div', { class: 'flex items-center gap-2' },
          isLive ? el('span', { class: 'inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse' }) : null,
          el('span', { class: `text-[10px] font-bold uppercase tracking-wider ${isLive ? 'text-red-400' : 'text-slate-400'}` },
            isLive ? 'Ao vivo' : (m.abandoned
              ? `Ret. · ${m.abandonedBy === 'a' ? dualShortName(m.athleteName, m.opponentName)[0] : m.abandonedBy === 'o' ? dualShortName(m.athleteName, m.opponentName)[1] : '—'}`
              : 'Encerrado')),
        ),
        el('div', { class: 'text-sm font-semibold truncate' }, dualShortName(m.athleteName, m.opponentName).join(' × ')),
        m.tournamentName && m.tournamentName.length >= 4 && el('div', { class: 'text-[11px] text-cyan-200 truncate' }, m.tournamentName),
      ),
      // Match encerrado: botão visível de compartilhar no header (relatório).
      // Ao vivo, share fica nas ações junto com undo/encerrar.
      !isLive ? el('button', {
        class: 'flex items-center gap-1.5 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 px-3 py-1.5 rounded-lg shrink-0',
        title: 'Compartilhar relatório',
        onClick: () => openScoutShareModal(profileId, m),
      }, '🔗', el('span', null, 'Compartilhar')) : null,
    ));

    // Placar (sempre full width no topo)
    container.appendChild(renderScorePanel(m));

    // Desktop: 2 colunas. Mobile: empilhado (grid-cols-1).
    const grid = el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 lg:gap-4' });
    const leftCol = el('div', { class: 'flex flex-col' });
    const rightCol = el('div', { class: 'flex flex-col' });
    grid.append(leftCol, rightCol);
    container.appendChild(grid);

    if (isLive) {
      // Ao vivo: ações de marcar na esquerda, stats/momentum/notas na direita
      leftCol.appendChild(renderPhaseBanner(m));
      leftCol.appendChild(renderStatButtons(m, profileId,
        async (winner, stat) => {
          try { m = await api.addLivePoint(profileId, m.id, winner, stat); render(); }
          catch (err) { alert(err.message); }
        },
        async (stat) => {
          try { m = await api.addLiveMarker(profileId, m.id, stat); render(); }
          catch (err) { alert(err.message); }
        },
      ));
      leftCol.appendChild(renderActions(m, profileId, async (action) => {
        try {
          if (action === 'undo') m = await api.undoLivePoint(profileId, m.id);
          else if (action === 'share') return openScoutShareModal(profileId, m);
          else if (action === 'game-manual') {
            const winner = await pickGameWinner(m.athleteName, m.opponentName);
            if (!winner) return;
            m = await api.gameManualLiveMatch(profileId, m.id, winner);
          }
          else if (action === 'abandon') {
            const result = await pickFinalizeOrRet(m.athleteName, m.opponentName);
            if (!result) return;
            if (result.kind === 'sets') {
              await api.finalizeLiveMatch(profileId, m.id, result.sets);
            } else {
              await api.abandonLiveMatch(profileId, m.id, result.side, 'ret');
            }
            close();
            return;
          }
          render();
        } catch (err) { alert(err.message); }
      }));
      rightCol.appendChild(renderStatsPanel(m));
      rightCol.appendChild(renderMomentumPanel(m));
      rightCol.appendChild(renderNotesPanel(m, {
        onAdd: async (text, tag) => { m = await api.addLiveNote(profileId, m.id, text, tag); render(); },
        onDelete: async (noteId) => { m = await api.deleteLiveNote(profileId, m.id, noteId); render(); },
      }));
    } else {
      // Relatório: stats na esquerda, momentum + notas na direita
      leftCol.appendChild(renderStatsPanel(m));
      rightCol.appendChild(renderMomentumPanel(m));
      rightCol.appendChild(renderNotesPanel(m, {
        onAdd: async (text, tag) => { m = await api.addLiveNote(profileId, m.id, text, tag); render(); },
        onDelete: async (noteId) => { m = await api.deleteLiveNote(profileId, m.id, noteId); render(); },
      }));
    }
  };

  render();
}

function renderScorePanel(m) {
  const cs = m.currentSet;
  const cg = formatGameLabel(m.currentGame, m.config?.ad);
  const sets = m.setsHistory || [];
  // Colunas a exibir: só os sets jogados + 1 atual (se ao vivo).
  // Resolve o bug do "set fantasma": backend não reseta currentSet ao
  // finalizar, então mostrar set vazio em amarelo passava sensação de
  // partida incompleta.
  const setsCount = Math.max(1, m.finished ? sets.length : sets.length + 1);
  const setColTemplate = Array(setsCount).fill('40px').join(' ');
  const rowTemplate = `1fr ${setColTemplate} 50px`;

  const wrap = el('div', { class: 'px-4 py-4' });
  const grid = el('div', { class: 'bg-white/5 rounded-xl border border-white/10 overflow-hidden' });
  const header = el('div', { class: 'grid', style: `grid-template-columns: ${rowTemplate};` });
  header.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-white/40 px-3 py-1.5 font-bold' }, 'Atleta'));
  for (let i = 0; i < setsCount; i++) header.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-white/40 px-1 py-1.5 text-center font-bold' }, String(i + 1)));
  header.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-white/40 px-2 py-1.5 text-center font-bold' }, 'Pts'));
  grid.appendChild(header);

  // Anna (a)
  grid.appendChild(rowForSide('a', m.athleteName, m, cs, cg, sets, rowTemplate, setsCount));
  grid.appendChild(rowForSide('o', m.opponentName, m, cs, cg, sets, rowTemplate, setsCount));
  wrap.appendChild(grid);

  // Banner TIEBREAK / SUPER-TB destacado
  const mode = m.currentGame?.mode;
  if ((mode === 'tiebreak' || mode === 'super_tiebreak') && !m.finished) {
    const target = mode === 'super_tiebreak' ? 10 : 7;
    const label = mode === 'super_tiebreak' ? 'SUPER TIEBREAK' : 'TIEBREAK';
    wrap.appendChild(el('div', {
      class: 'mt-2 rounded-lg px-3 py-2 text-center font-bold text-sm flex items-center justify-center gap-2',
      style: 'background: rgba(252, 211, 77, 0.15); border: 1px solid rgba(252, 211, 77, 0.4); color: #fde68a;',
    }, `🎾 ${label}`, el('span', { class: 'text-xs font-normal opacity-80' }, `· primeiro a ${target} pts (com 2 de vantagem)`)));
  }
  return wrap;
}

// Pula preposições/conectivos do nome ("de", "da", "do", "dos", "das", "e",
// "di", "du") pra exibir tokens significativos. Mesma lógica do /scouting.
const NAME_STOPWORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'di', 'du', 'del', 'della', 'van', 'von', 'la', 'le']);
function nameTokens(name) {
  return (name || '').trim().split(/\s+/).filter(p => p && !NAME_STOPWORDS.has(p.toLowerCase()));
}

// "Rafael de Veríssimo Queiroz" → "Rafael Veríssimo".
function shortName(name) {
  const t = nameTokens(name);
  if (t.length <= 1) return t.join(' ');
  return `${t[0]} ${t[1]}`;
}

function firstName(name) {
  return nameTokens(name)[0] || '';
}

// Desambigua 2 nomes: se primeiro nome bate, busca primeiro sobrenome
// diferente. "Rafael Veríssimo Queiroz" vs "Rafael Veríssimo Pereira" →
// ["Rafael Queiroz", "Rafael Pereira"].
function dualShortName(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return [shortName(a), shortName(b)];
  if (ta[0].toLowerCase() !== tb[0].toLowerCase()) return [shortName(a), shortName(b)];
  const max = Math.max(ta.length, tb.length);
  for (let i = 1; i < max; i++) {
    const sa = (ta[i] || '').toLowerCase();
    const sb = (tb[i] || '').toLowerCase();
    if (sa !== sb) {
      return [
        `${ta[0]} ${ta[i] || ta[ta.length - 1]}`,
        `${tb[0]} ${tb[i] || tb[tb.length - 1]}`,
      ];
    }
  }
  return [shortName(a), shortName(b)];
}

function rowForSide(side, name, m, cs, cg, sets, rowTemplate, setsCount) {
  const isServer = m.server === side && !m.finished;
  const isWinner = m.finished && m.winner === side;
  const isLoser  = m.finished && m.winner && m.winner !== side;
  const rowStyle = `grid-template-columns: ${rowTemplate};` + (isLoser ? ' opacity: 0.5;' : '');
  const row = el('div', { class: 'grid items-center', style: rowStyle });
  const nameSuffix = isWinner ? ' 🏆' : (isServer ? ' 🎾' : '');
  row.appendChild(el('div', { class: `px-3 py-2 text-sm flex items-center gap-2 ${isWinner ? 'font-extrabold' : 'font-semibold'}` },
    el('span', { class: 'inline-block w-2.5 h-2.5 rounded-full', style: `background: ${side === 'a' ? '#0891b2' : '#e11d48'}` }),
    el('span', { class: 'truncate' }, shortName(name) + nameSuffix),
  ));
  for (let i = 0; i < setsCount; i++) {
    const s = sets[i];
    if (s) {
      // Set encerrado: amarelo só no vencedor; TB vira superscript no perdedor.
      const setWinner = s.a > s.o ? 'a' : (s.o > s.a ? 'o' : null);
      const wonThisSet = setWinner === side;
      const classes = 'px-1 py-2 text-center text-base ' +
        (wonThisSet ? 'font-extrabold text-yellow-300' : 'font-bold');
      // Tiebreak: número pequeno (subscript) ao lado do perdedor mostra os
      // pts dele no TB. Convenção ITF/CBT: "7  6³" — set 7-6, perdedor fez 3.
      // Super-TB substitui set inteiro — mostra direto o score do TB.
      const isSuperTb = s.mode === 'super_tiebreak' && s.tiebreak;
      let children;
      if (isSuperTb) {
        children = [String(s.tiebreak[side])];
      } else if (s.tiebreak && !wonThisSet) {
        children = [
          String(s[side]),
          el('sup', { class: 'text-[10px] font-normal opacity-80 ml-0.5' }, String(s.tiebreak[side])),
        ];
      } else {
        children = [String(s[side])];
      }
      row.appendChild(el('div', { class: classes }, ...children));
    } else if (!m.finished) {
      // Set sendo jogado: parcial em destaque ciano (não amarelo, pra
      // amarelo ficar reservado a vencedor).
      row.appendChild(el('div', {
        class: 'px-1 py-2 text-center text-base font-bold text-cyan-300',
      }, String(cs[side])));
    } else {
      // Não deveria cair aqui (setsCount agora é exato), mas mantém fallback.
      row.appendChild(el('div', { class: 'px-1 py-2 text-center text-base opacity-40' }, ''));
    }
  }
  // Pts atuais (só ao vivo)
  const ptsLabel = m.finished ? '' : (cg.split('-')[side === 'a' ? 0 : 1] || '0');
  row.appendChild(el('div', { class: 'px-2 py-2 text-center text-xl font-extrabold text-yellow-300' }, ptsLabel));
  return row;
}

function formatGameLabel(cg, ad) {
  if (!cg) return '0-0';
  if (cg.mode === 'tiebreak' || cg.mode === 'super_tiebreak') return `${cg.a}-${cg.o}`;
  const labels = ['0', '15', '30', '40'];
  if (cg.a < 4 && cg.o < 4) return `${labels[cg.a]}-${labels[cg.o]}`;
  if (cg.a >= 3 && cg.o >= 3) {
    if (cg.a === cg.o) return '40-40';
    if (cg.a === cg.o + 1) return 'AD-40';
    if (cg.o === cg.a + 1) return '40-AD';
  }
  return `${cg.a}-${cg.o}`;
}

// Banner que mostra a fase atual do ponto (acima dos botões de stat)
function renderPhaseBanner(m) {
  const state = derivePointState(m);
  const serverName = state.server === 'a' ? m.athleteName.split(/\s+/)[0] : 'Opponent';
  const wrap = el('div', { class: 'mx-3 mb-2 rounded-lg px-3 py-2 flex items-center gap-2' });
  if (state.phase === 'rally') {
    wrap.style.cssText = 'background: rgba(124, 58, 237, 0.18); border: 1px solid rgba(124, 58, 237, 0.4);';
    wrap.appendChild(el('span', { class: 'text-base' }, '⚡'));
    wrap.appendChild(el('span', { class: 'text-sm font-bold uppercase tracking-wide', style: 'color:#c4b5fd' }, 'Rally'));
  } else {
    const isAnna = state.server === 'a';
    const color = isAnna ? '#67e8f9' : '#fda4af';
    wrap.style.cssText = `background: rgba(255,255,255,0.06); border: 1px solid ${isAnna ? 'rgba(8,145,178,0.4)' : 'rgba(225,29,72,0.4)'};`;
    wrap.appendChild(el('span', { class: 'text-base' }, '🎾'));
    wrap.appendChild(el('span', { class: 'text-sm font-bold uppercase tracking-wide', style: `color:${color}` }, `${serverName} serving`));
    wrap.appendChild(el('span', { class: 'text-xs ml-auto', style: 'color:rgba(255,255,255,0.6)' },
      state.firstServeIn ? '1st serve' : '2nd serve'));
  }
  return wrap;
}

// Deriva o estado do ponto atual a partir do log:
// - phase: 'serve' (default ou após 1st serve fault) | 'rally' (após return in play)
// - firstServeIn: true até alguém marcar 'serve_fault' no ponto atual
function derivePointState(m) {
  const pts = m.points || [];
  let firstServeIn = true;
  let rally = false;
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    if (p.winner != null) break;
    if (p.stat === 'serve_fault') firstServeIn = false;
    if (p.stat === 'return_in_play') rally = true;
  }
  return { phase: rally ? 'rally' : 'serve', firstServeIn, server: m.server };
}

// Renderiza botões baseado na fase atual. onPoint(winner, stat) fecha ponto;
// onMarker(stat) registra evento intermediário (não fecha).
function renderStatButtons(m, profileId, onPoint, onMarker) {
  const state = derivePointState(m);
  const wrap = el('div', { class: 'mx-3 bg-white text-slate-900 rounded-xl p-3' });

  let btns;
  if (state.phase === 'serve') {
    const server = state.server;
    const receiver = server === 'a' ? 'o' : 'a';
    const serverCls   = server   === 'a' ? 'anna' : 'adv';
    const receiverCls = receiver === 'a' ? 'anna' : 'adv';
    btns = [
      { stat: 'ace',             label: 'Ace',             winner: server,   cls: serverCls },
      { stat: 'return_winner',   label: 'Return Winner',   winner: receiver, cls: receiverCls },
      { stat: 'service_winner',  label: 'Service Winner',  winner: server,   cls: serverCls },
      { stat: 'return_error',    label: 'Return Error',    winner: server,   cls: receiverCls },
      { stat: 'serve_fault',     label: '1st Serve Fault', marker: true,     cls: serverCls,   disabled: !state.firstServeIn },
      { stat: 'return_in_play',  label: 'Return in Play',  marker: true,     cls: receiverCls },
      { stat: 'double_fault',    label: 'Double Fault',    winner: receiver, cls: serverCls },
      null, // alinha grid 2x4
    ];
  } else {
    // Rally — qualquer botão fecha o ponto
    btns = [
      { stat: 'winner',         label: 'Winner',         winner: 'a', cls: 'anna' },
      { stat: 'winner',         label: 'Winner',         winner: 'o', cls: 'adv' },
      { stat: 'forced_error',   label: 'Forced Error',   winner: 'o', cls: 'anna' },
      { stat: 'forced_error',   label: 'Forced Error',   winner: 'a', cls: 'adv' },
      { stat: 'unforced_error', label: 'Unforced Error', winner: 'o', cls: 'anna' },
      { stat: 'unforced_error', label: 'Unforced Error', winner: 'a', cls: 'adv' },
    ];
  }

  const grid = el('div', { class: 'grid grid-cols-2 gap-2' });
  for (const b of btns) {
    if (b === null) {
      grid.appendChild(el('div', { class: 'opacity-0' }));
      continue;
    }
    grid.appendChild(renderStatBtn(b, onPoint, onMarker));
  }
  wrap.appendChild(grid);
  return wrap;
}

function renderStatBtn(b, onPoint, onMarker) {
  const bg = b.cls === 'anna' ? '#0891b2' : '#e11d48';
  const bgHover = b.cls === 'anna' ? '#0e7490' : '#be123c';
  const btn = el('button', {
    class: 'rounded-xl py-3 px-2 text-white font-bold text-sm shadow active:scale-95 transition disabled:opacity-40',
    style: `background:${bg};`,
  }, b.label);
  if (b.disabled) btn.disabled = true;
  btn.onmouseover = () => { if (!btn.disabled) btn.style.background = bgHover; };
  btn.onmouseout = () => { btn.style.background = bg; };
  btn.onclick = () => {
    if (b.marker) onMarker?.(b.stat);
    else onPoint(b.winner, b.stat);
  };
  return btn;
}

function renderActions(m, profileId, onAction) {
  // profileId null = scouter público. Compartilhar fica só pro dono
  // (público já tem o link via dashboard do /scouting do coach).
  const isOwner = !!profileId;
  // Owner: 4 colunas (undo, game-manual, share, encerrar)
  // Público: 3 colunas (undo, game-manual, encerrar)
  const cols = isOwner ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3';
  const wrap = el('div', { class: `px-3 mt-3 grid gap-2 ${cols}` });
  const undoBtn = el('button', {
    class: 'text-xs px-3 py-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-semibold disabled:opacity-50',
    onClick: () => onAction('undo'),
  }, '↶ Desfazer último');
  if (!m.points || m.points.length === 0) undoBtn.disabled = true;
  wrap.appendChild(undoBtn);
  // Game manual: perdeu o scout do game e marca o vencedor sem
  // inventar pontos. Disponível pra owner e scouter público.
  wrap.appendChild(el('button', {
    class: 'text-xs px-3 py-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-400/30 text-amber-100 font-semibold',
    title: 'Use quando perdeu o scout dos pontos do game',
    onClick: () => onAction('game-manual'),
  }, '⇥ Game manual'));
  if (isOwner) {
    wrap.appendChild(el('button', {
      class: 'text-xs px-3 py-2.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 font-semibold',
      onClick: () => onAction('share'),
    }, '🔗 Compartilhar'));
  }
  wrap.appendChild(el('button', {
    class: 'text-xs px-3 py-2.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-semibold',
    onClick: () => onAction('abandon'),
  }, '⏹ Encerrar'));
  return wrap;
}

function renderStatsPanel(m) {
  const wrap = el('div', { class: 'px-4 py-4' });
  wrap.appendChild(el('h3', { class: 'text-xs font-bold uppercase tracking-wider text-cyan-200/80 mb-2' }, 'Stats'));
  const stats = computeStats(m);
  const tbl = el('div', { class: 'bg-white/5 rounded-lg border border-white/10 overflow-hidden' });

  // Header com os nomes reais dos atletas (desambigua homônimos).
  const [shortA, shortO] = dualShortName(m.athleteName, m.opponentName);
  const head = el('div', { class: 'grid grid-cols-3 text-[10px] uppercase tracking-wide text-white/50 border-b border-white/10' });
  head.appendChild(el('div', { class: 'px-3 py-2 text-center font-bold text-cyan-300 truncate' }, shortA || 'Atleta'));
  head.appendChild(el('div', { class: 'px-3 py-2 text-center' }, ''));
  head.appendChild(el('div', { class: 'px-3 py-2 text-center font-bold text-rose-300 truncate' }, shortO || 'Adv'));
  tbl.appendChild(head);

  // 1ª linha: Nota técnica (destacada) — cores fixas (cyan Anna, rose adv)
  const cs = m.computedScore;
  if (cs && (cs.a?.score != null || cs.o?.score != null)) {
    const noteRow = el('div', { class: 'grid grid-cols-3 text-xs border-b border-white/10', style: 'background: rgba(255,255,255,0.04)' });
    noteRow.appendChild(el('div', { class: 'px-3 py-2 text-center font-extrabold text-lg', style: 'color:#67e8f9' },
      cs.a?.score != null ? cs.a.score.toFixed(1).replace('.', ',') : '—'));
    noteRow.appendChild(el('div', { class: 'px-3 py-2 text-center text-white/85 font-semibold uppercase tracking-wide text-[10px]' }, 'Nota técnica · 0-10'));
    noteRow.appendChild(el('div', { class: 'px-3 py-2 text-center font-extrabold text-lg', style: 'color:#fda4af' },
      cs.o?.score != null ? cs.o.score.toFixed(1).replace('.', ',') : '—'));
    tbl.appendChild(noteRow);
  }

  // Demais métricas (padrão iOnCourt)
  const sa = stats.a, so = stats.o;
  const pctText = (won, total) => total > 0 ? `${won}/${total} (${Math.round(100 * won / total)}%)` : '—';
  const rows = [
    // Serve
    ['Aces',                    sa.aces, so.aces],
    ['Double Faults',           sa.doubleFaults, so.doubleFaults],
    ['Service Winners',         sa.serviceWinners, so.serviceWinners],
    ['1st Serve %',             pctText(sa.firstServeIn, sa.firstServeAttempted), pctText(so.firstServeIn, so.firstServeAttempted)],
    ['1st Serve Pts Won',       pctText(sa.pointsWonOn1stServe, sa.pointsPlayedOn1stServe), pctText(so.pointsWonOn1stServe, so.pointsPlayedOn1stServe)],
    ['2nd Serve Pts Won',       pctText(sa.pointsWonOn2ndServe, sa.pointsPlayedOn2ndServe), pctText(so.pointsWonOn2ndServe, so.pointsPlayedOn2ndServe)],
    // Return
    ['Return Winners',          sa.returnWinners, so.returnWinners],
    ['Return Errors',           sa.returnErrors, so.returnErrors],
    ['Break Points Won',        sa.breakPointsFaced > 0 ? `${sa.breakPointsWon}/${sa.breakPointsFaced}` : '—',
                                so.breakPointsFaced > 0 ? `${so.breakPointsWon}/${so.breakPointsFaced}` : '—'],
    // Rally
    ['Winners',                 sa.winners, so.winners],
    ['Forced Errors',           sa.forcedErrors, so.forcedErrors],
    ['Unforced Errors',         sa.unforcedErrors, so.unforcedErrors],
    // Total
    ['Total Pts Won',           sa.pointsWon, so.pointsWon],
  ];
  rows.forEach(([label, a, o]) => {
    const r = el('div', { class: 'grid grid-cols-3 text-xs border-b border-white/5' });
    r.appendChild(el('div', { class: 'px-3 py-1.5 text-center font-semibold' }, String(a)));
    r.appendChild(el('div', { class: 'px-3 py-1.5 text-center text-white/70' }, label));
    r.appendChild(el('div', { class: 'px-3 py-1.5 text-center font-semibold' }, String(o)));
    tbl.appendChild(r);
  });
  wrap.appendChild(tbl);
  return wrap;
}

// Composer + lista de notas qualitativas. opts: { onAdd, onDelete?, readOnly? }
function renderNotesPanel(m, opts = {}) {
  const wrap = el('div', { class: 'px-4 py-4' });
  wrap.appendChild(el('h3', { class: 'text-xs font-bold uppercase tracking-wider text-cyan-200/80 mb-2' }, '📝 Notas de performance'));

  if (!opts.readOnly && opts.onAdd) {
    const composer = el('div', { class: 'bg-white rounded-xl p-3 text-slate-900 mb-3' });
    const textarea = el('textarea', {
      placeholder: 'Observação rápida — ex: "segundo saque na quadra" · "errou muitos voleios na subida à rede"…',
      class: 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 h-16 focus:outline-none focus:ring-2 focus:ring-cyan-300 resize-none',
    });
    composer.appendChild(textarea);

    // Tag chips
    let selectedTag = null;
    const tags = [
      ['tecnico',   'Técnico',   '#0e7490'],
      ['tatico',    'Tático',    '#7c3aed'],
      ['fisico',    'Físico',    '#ea580c'],
      ['emocional', 'Emocional', '#be123c'],
    ];
    const tagRow = el('div', { class: 'flex gap-1.5 flex-wrap mt-2' });
    const tagBtns = [];
    tags.forEach(([key, label, color]) => {
      const b = el('button', {
        class: 'text-[11px] px-2 py-1 rounded-full border border-slate-300 text-slate-600 font-semibold',
      }, label);
      b.onclick = () => {
        selectedTag = selectedTag === key ? null : key;
        tagBtns.forEach(({ key: k, btn, color: c }) => {
          if (k === selectedTag) {
            btn.style.background = c;
            btn.style.color = 'white';
            btn.style.borderColor = c;
          } else {
            btn.style.background = '';
            btn.style.color = '';
            btn.style.borderColor = '';
            btn.className = 'text-[11px] px-2 py-1 rounded-full border border-slate-300 text-slate-600 font-semibold';
          }
        });
      };
      tagBtns.push({ key, btn: b, color });
      tagRow.appendChild(b);
    });
    composer.appendChild(tagRow);

    const submit = el('button', {
      class: 'mt-2 w-full text-xs px-3 py-2 rounded bg-cyan-600 hover:bg-cyan-700 text-white font-semibold disabled:opacity-50',
    }, '+ Adicionar nota');
    submit.onclick = async () => {
      const text = textarea.value.trim();
      if (!text) { textarea.focus(); return; }
      submit.disabled = true;
      submit.textContent = '⏳ Salvando…';
      try {
        await opts.onAdd(text, selectedTag);
        // callback faz re-render
      } catch (err) {
        alert(err.message);
        submit.disabled = false;
        submit.textContent = '+ Adicionar nota';
      }
    };
    composer.appendChild(submit);
    wrap.appendChild(composer);
  }

  // Lista de notas (newest first)
  const notes = (m.notes || []).slice().reverse();
  if (notes.length === 0) {
    wrap.appendChild(el('div', { class: 'text-[11px] text-white/40 italic text-center py-2' },
      opts.readOnly ? 'Nenhuma nota neste match.' : 'Suas observações aparecem aqui — o que os números não contam.'));
    return wrap;
  }

  const tagMeta = {
    tecnico:   { label: 'Técnico',   color: '#0e7490' },
    tatico:    { label: 'Tático',    color: '#7c3aed' },
    fisico:    { label: 'Físico',    color: '#ea580c' },
    emocional: { label: 'Emocional', color: '#be123c' },
  };

  const list = el('div', { class: 'space-y-2' });
  notes.forEach(n => {
    const meta = n.tag && tagMeta[n.tag];
    const item = el('div', { class: 'bg-white/5 border border-white/10 rounded-lg p-3' });
    const head = el('div', { class: 'flex items-center justify-between mb-1 gap-2 flex-wrap' });
    head.appendChild(el('span', { class: 'text-[10px] font-bold uppercase tracking-wider text-cyan-300' },
      formatNoteScore(n.score)));
    if (meta) head.appendChild(el('span', {
      class: 'text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white',
      style: `background:${meta.color}`,
    }, meta.label));
    const right = el('span', { class: 'ml-auto text-[10px] text-white/40' }, relativeTimeShort(n.ts));
    head.appendChild(right);
    if (opts.onDelete) {
      const del = el('button', { class: 'text-[10px] text-white/40 hover:text-red-300 ml-2' }, '×');
      del.onclick = async () => {
        if (!(await confirmDialog('Excluir esta nota?', { danger: true, okLabel: 'Excluir' }))) return;
        try { await opts.onDelete(n.id); } catch (err) { alert(err.message); }
      };
      head.appendChild(del);
    }
    item.appendChild(head);
    item.appendChild(el('div', { class: 'text-sm text-white/90' }, n.text));
    list.appendChild(item);
  });
  wrap.appendChild(list);
  return wrap;
}

function formatNoteScore(score) {
  if (!score) return '';
  const sets = (score.sets || []).map(s => `${s.a}-${s.o}`).join(' · ');
  const cur = score.currentSetGames ? `${score.currentSetGames.a}-${score.currentSetGames.o}` : '';
  const cg = score.currentGame || '';
  return [sets, cur, cg].filter(Boolean).join(' · ');
}

function relativeTimeShort(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

// Badge grande com a nota 0-10 + breakdown compacto
function renderScoreBadge(cs) {
  const score = cs.score;
  // Cor: vermelho < 4, amarelo 4-7, verde 7+
  const color = score < 4 ? '#e11d48' : score < 7 ? '#f59e0b' : '#10b981';
  const wrap = el('div', { class: 'rounded-xl p-4 mb-2', style: 'background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);' });
  wrap.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-white/50 font-bold' }, 'Nota técnica do match'));

  const row = el('div', { class: 'flex items-end gap-3 mt-1' });
  const big = el('div', { class: 'text-5xl font-extrabold leading-none', style: `color:${color}` }, score.toFixed(1).replace('.', ','));
  row.appendChild(big);
  row.appendChild(el('div', { class: 'text-xs text-white/60 pb-1' }, ' / 10'));
  wrap.appendChild(row);

  // Breakdown — 4 mini-barras
  const b = cs.breakdown;
  const items = [
    ['% pts ganhos',          b.pctWon?.score],
    ['Saldo ofensivo',         b.balance?.score],
    ['Sacando',                b.serving?.score],
    ['Recebendo',              b.receiving?.score],
  ];
  const grid = el('div', { class: 'mt-3 grid grid-cols-2 gap-2' });
  for (const [label, val] of items) {
    if (val == null) continue;
    const c = val < 4 ? '#e11d48' : val < 7 ? '#f59e0b' : '#10b981';
    const item = el('div', { class: 'text-[11px]' },
      el('div', { class: 'text-white/60' }, label),
      el('div', { class: 'flex items-center gap-2 mt-0.5' },
        el('div', { class: 'flex-1 h-1.5 rounded-full', style: 'background:rgba(255,255,255,0.1)' },
          el('div', { class: 'h-full rounded-full', style: `width:${val * 10}%; background:${c}` }),
        ),
        el('span', { class: 'font-semibold text-white/85', style: 'min-width:1.75rem; text-align:right' }, val.toFixed(1).replace('.', ',')),
      ),
    );
    grid.appendChild(item);
  }
  wrap.appendChild(grid);
  return wrap;
}

// Calcula stats consolidados a partir do log. Cada ponto pertence a um
// "rally" que começa no saque e termina em winner != null. Markers
// (serve_fault, return_in_play) atualizam o estado do rally em curso.
// Momentum ±1 por ponto — escala adaptativa pra caber em qualquer largura
function renderMomentumPanel(m) {
  const closed = (m.points || []).filter(p => p.winner != null);
  if (closed.length === 0) return el('div');
  const total = closed.length;
  const annaWon = closed.filter(p => p.winner === 'a').length;
  const oppWon = total - annaWon;
  const VB_W = 1000;
  const padding = 12;
  const usable = VB_W - 2 * padding;
  const spacing = usable / total;
  const stroke = spacing >= 6 ? 3 : spacing >= 4 ? 2.2 : spacing >= 2.5 ? 1.5 : 1;
  const bars = closed.map((p, i) => {
    const x = padding + spacing * (i + 0.5);
    const top = p.winner === 'a' ? 15 : 65;
    const color = p.winner === 'a' ? '#0891b2' : '#e11d48';
    return `<line x1="${x.toFixed(2)}" y1="40" x2="${x.toFixed(2)}" y2="${top}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" />`;
  }).join('');
  const wrap = el('div', { class: 'px-4 py-4' });
  wrap.appendChild(el('h3', { class: 'text-xs font-bold uppercase tracking-wider text-cyan-200/80 mb-2 flex items-center justify-between' },
    el('span', null, 'Momentum · cada barra = 1 ponto'),
    el('span', { class: 'font-normal text-[11px] text-white/70' },
      el('span', { style: 'color:#67e8f9; font-weight:bold;' }, String(annaWon)),
      ' · ',
      el('span', { style: 'color:#fda4af; font-weight:bold;' }, String(oppWon)),
      el('span', { style: 'opacity:0.5;' }, ` · total ${total}`),
    ),
  ));
  const chart = document.createElement('div');
  chart.style.cssText = 'background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:12px;';
  chart.innerHTML = `<svg viewBox="0 0 ${VB_W} 80" style="width:100%; height:80px; display:block;" preserveAspectRatio="none">
    <line x1="0" y1="40" x2="${VB_W}" y2="40" stroke="rgba(255,255,255,0.35)" stroke-width="1" vector-effect="non-scaling-stroke" />
    ${bars}
  </svg>`;
  wrap.appendChild(chart);
  return wrap;
}

function computeStats(m) {
  const init = () => ({
    aces: 0, doubleFaults: 0, serviceWinners: 0,
    returnWinners: 0, returnErrors: 0, returnsInPlay: 0,
    winners: 0, forcedErrors: 0, unforcedErrors: 0,
    pointsWon: 0,
    firstServeIn: 0, firstServeAttempted: 0,
    pointsWonOn1stServe: 0, pointsPlayedOn1stServe: 0,
    pointsWonOn2ndServe: 0, pointsPlayedOn2ndServe: 0,
    breakPointsWon: 0, breakPointsFaced: 0,
  });
  const s = { a: init(), o: init() };

  // Itera, mantendo state do ponto atual
  let cur = { firstServeIn: true, server: null, ended: false };
  for (const p of (m.points || [])) {
    if (cur.server == null) cur.server = p.server;
    if (p.winner == null) {
      // Marker
      if (p.stat === 'serve_fault') cur.firstServeIn = false;
      // return_in_play: noop pra stats (já capturado no fluxo)
      continue;
    }
    // Ponto fechado
    s[p.winner].pointsWon++;

    const server = cur.server || p.server;
    const receiver = server === 'a' ? 'o' : 'a';

    // % 1º saque (in vs fora): cada ponto conta 1 tentativa de 1º saque
    s[server].firstServeAttempted++;
    if (cur.firstServeIn) s[server].firstServeIn++;

    // Pts ganhos no 1º / 2º saque
    if (cur.firstServeIn) {
      s[server].pointsPlayedOn1stServe++;
      if (p.winner === server) s[server].pointsWonOn1stServe++;
    } else {
      s[server].pointsPlayedOn2ndServe++;
      if (p.winner === server) s[server].pointsWonOn2ndServe++;
    }

    // Stat-specific
    switch (p.stat) {
      case 'ace':            s[server].aces++; break;
      case 'service_winner': s[server].serviceWinners++; break;
      case 'double_fault':   s[server].doubleFaults++; break;
      case 'return_winner':  s[receiver].returnWinners++; s[receiver].returnsInPlay++; break;
      case 'return_error':   s[receiver].returnErrors++; break;
      case 'winner':         s[p.winner].winners++; break;
      case 'forced_error': {
        // p.winner ganhou, o oposto cometeu o erro forçado
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

    // Reset pro próximo ponto
    cur = { firstServeIn: true, server: null, ended: false };
  }

  // Break Points: 2ª passada com tracker próprio do game state.
  // BP = receiver está em situação de ganhar o game com 1 ponto.
  // Não conta em tiebreak (não tem saque/devolução distintos).
  // ad=true: BP quando receiver_pts >= 3 e diff (recv-srv) >= 1.
  // ad=false (no-ad): BP quando receiver_pts >= 3 e receiver_pts >= server_pts.
  const adOn = m.config?.ad !== false;
  let bpGame = { a: 0, o: 0 };
  let bpServer = null;
  let setGames = { a: 0, o: 0 };
  let inTiebreak = false;
  for (const p of (m.points || [])) {
    if (p.winner == null) continue;
    if (bpServer == null) bpServer = p.server;
    const recv = bpServer === 'a' ? 'o' : 'a';
    if (!inTiebreak) {
      const r = bpGame[recv], sv = bpGame[bpServer];
      const isBP = adOn ? (r >= 3 && r - sv >= 1) : (r >= 3 && r >= sv);
      if (isBP) {
        s[recv].breakPointsFaced++;
        if (p.winner === recv) s[recv].breakPointsWon++;
      }
    }
    bpGame[p.winner]++;
    let ended = null;
    if (inTiebreak) {
      if (bpGame.a >= 7 && bpGame.a - bpGame.o >= 2) ended = 'a';
      else if (bpGame.o >= 7 && bpGame.o - bpGame.a >= 2) ended = 'o';
    } else if (adOn) {
      if (bpGame.a >= 4 && bpGame.a - bpGame.o >= 2) ended = 'a';
      else if (bpGame.o >= 4 && bpGame.o - bpGame.a >= 2) ended = 'o';
    } else {
      if (bpGame.a >= 4 && bpGame.a > bpGame.o) ended = 'a';
      else if (bpGame.o >= 4 && bpGame.o > bpGame.a) ended = 'o';
    }
    if (ended) {
      if (inTiebreak) {
        setGames = { a: 0, o: 0 };
        inTiebreak = false;
      } else {
        setGames[ended]++;
        if (setGames.a === 6 && setGames.o === 6) inTiebreak = true;
        if ((setGames.a >= 6 && setGames.a - setGames.o >= 2) ||
            (setGames.o >= 6 && setGames.o - setGames.a >= 2) ||
            setGames.a === 7 || setGames.o === 7) {
          setGames = { a: 0, o: 0 };
        }
      }
      bpGame = { a: 0, o: 0 };
      bpServer = bpServer === 'a' ? 'o' : 'a';
    }
  }

  // Contagem geral de "returns in play" (devoluções boas) — qualquer return_in_play marker já indica que voltou
  // (não fechou via return winner/error). Mas return_winner também conta como devolução que entrou.
  // Vou recontar
  for (const p of (m.points || [])) {
    if (p.stat === 'return_in_play') {
      // Quem está recebendo no ponto? p.server é o servidor, então recebedor é o oposto
      const receiver = p.server === 'a' ? 'o' : 'a';
      s[receiver].returnsInPlay++;
    }
  }

  return s;
}

// Modal de envio do relatório do match — gera HTML estático permanente
// no servidor e oferece o link pra WhatsApp/email. Link NÃO expira
// (diferente do link viewer, que expira em 7 dias após o match encerrar).
async function openMatchReportShareModal(profileId, match) {
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-1rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 92dvh;',
  });
  card.appendChild(el('div', { class: 'bg-gradient-to-br from-[#0e3a4d] to-[#1f5b75] text-white px-5 py-3 flex items-center justify-between' },
    el('span', { class: 'font-medium' }, '📧 Enviar relatório do match'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  ));
  const body = el('div', { class: 'px-5 py-4 overflow-y-auto flex-1 space-y-4' });
  card.appendChild(body);
  root.append(overlay, card);

  body.appendChild(el('div', { class: 'text-xs text-slate-500 italic' }, 'Gerando relatório…'));

  let report;
  try {
    report = await api.generateMatchReport(profileId, match.id);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'text-sm text-red-600' }, `Erro: ${err.message}`));
    return;
  }
  body.innerHTML = '';

  const origin = window.location.origin;
  const reportUrl = `${origin}${report.url}`;
  const matchLabel = `${match.athleteName} vs ${match.opponentName}`;
  const placar = renderScoreSummary(match);
  const cs = match.computedScore;
  const notaText = cs?.a?.score != null ? `Nota técnica: ${cs.a.score.toFixed(1)}/10` : '';

  // Resumo
  body.appendChild(el('div', { class: 'rounded-lg border border-slate-200 bg-slate-50 p-3' },
    el('div', { class: 'text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2' }, 'Resumo do relatório'),
    el('div', { class: 'text-sm font-semibold text-slate-900' }, matchLabel),
    match.tournamentName ? el('div', { class: 'text-[11px] text-slate-600 mt-0.5' }, match.tournamentName) : null,
    el('div', { class: 'text-xs text-slate-700 mt-2' }, `📊 ${placar}`),
    notaText ? el('div', { class: 'text-xs text-cyan-700 font-semibold mt-1' }, notaText) : null,
  ));

  // Link permanente
  body.appendChild(el('div', { class: 'rounded-lg border border-cyan-200 bg-cyan-50/50 p-3' },
    el('div', { class: 'text-sm font-bold text-cyan-900 mb-1' }, '🔗 Link permanente'),
    el('div', { class: 'text-[11px] text-cyan-700 mb-2' }, 'Snapshot do match congelado · vive pra sempre · abre direto no navegador.'),
    el('div', { class: 'bg-white border border-cyan-200 rounded p-2 mb-2 text-[11px] text-slate-700 font-mono break-all' }, reportUrl),
    el('div', { class: 'grid grid-cols-3 gap-2' },
      el('a', {
        class: 'text-xs px-3 py-2 rounded bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-center no-underline',
        href: `https://wa.me/?text=${encodeURIComponent(`Relatório do match ${matchLabel}\n${placar}${notaText ? ' · ' + notaText : ''}\n\n${reportUrl}`)}`,
        target: '_blank', rel: 'noopener',
      }, '📱 WhatsApp'),
      el('a', {
        class: 'text-xs px-3 py-2 rounded border border-slate-300 hover:bg-slate-50 font-semibold text-center text-slate-700 no-underline',
        href: reportUrl,
        target: '_blank', rel: 'noopener',
      }, '👁️ Abrir'),
      copyButton(reportUrl),
    ),
  ));

  // Email (mailto)
  const subject = `Relatório do match — ${matchLabel}`;
  const bodyText = `Segue o relatório do match:\n\n${matchLabel}\n${match.tournamentName || ''}\n${placar}${notaText ? ' · ' + notaText : ''}\n\nLink (placar, stats, nota técnica):\n${reportUrl}\n\n—\nEnviado pelo Tennis Flow.`;
  body.appendChild(el('div', { class: 'rounded-lg border border-slate-200 p-3' },
    el('div', { class: 'text-sm font-bold text-slate-900 mb-1' }, '✉️ Enviar por email'),
    el('div', { class: 'text-[11px] text-slate-600 mb-2' }, 'Abre seu cliente de email padrão com assunto e corpo preenchidos.'),
    el('a', {
      class: 'block text-center text-xs px-3 py-2 rounded bg-cyan-600 hover:bg-cyan-700 text-white font-semibold no-underline',
      href: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`,
    }, '✉️ Abrir cliente de email'),
  ));
}

// Modal compartilhar — adapta ao estado do match.
// Match ao vivo: mostra link de scouter (marcar) + viewer (acompanhar).
// Match encerrado: mostra só o viewer (mesmo link, agora serve como
// relatório do match — placar final, stats, nota, notas qualitativas).
async function openScoutShareModal(profileId, match) {
  // Usa container próprio appended ao body (não modal-root) pra não
  // destruir o tracking modal que está abaixo.
  const shareRoot = document.createElement('div');
  document.body.appendChild(shareRoot);
  const close = () => { shareRoot.remove(); };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-[60]', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] w-[calc(100%-1rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 92dvh;',
  });
  const finished = match.finished;
  card.appendChild(el('div', { class: 'bg-gradient-to-br from-[#0e3a4d] to-[#1f5b75] text-white px-5 py-3 flex items-center justify-between' },
    el('span', { class: 'font-medium' }, finished ? '🔗 Compartilhar relatório' : '🔗 Compartilhar tracking'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  ));
  const body = el('div', { class: 'px-5 py-4 overflow-y-auto flex-1 space-y-4' });
  card.appendChild(body);
  shareRoot.append(overlay, card);

  body.appendChild(el('div', { class: 'text-xs text-slate-500 italic' }, 'Carregando links…'));

  let tokens;
  try {
    tokens = await api.getLiveMatchTokens(profileId, match.id);
  } catch (err) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'text-sm text-red-600' }, `Erro: ${err.message}`));
    return;
  }
  body.innerHTML = '';

  const origin = window.location.origin;
  const scoutUrl = `${origin}/scout/${tokens.scoutToken}`;
  const viewUrl  = `${origin}/live/${tokens.viewerToken}`;
  const matchLabel = `${match.athleteName} vs ${match.opponentName}`;
  const wppText = (label, url) => encodeURIComponent(`${label} — ${matchLabel}\n${url}`);

  // Scouter — só se match ao vivo
  if (!finished) {
    body.appendChild(el('div', { class: 'border-2 border-amber-300 bg-amber-50/50 rounded-xl p-3' },
      el('div', { class: 'flex items-center gap-2 mb-2' },
        el('span', { class: 'text-lg' }, '📝'),
        el('div', null,
          el('div', { class: 'text-sm font-bold text-amber-900' }, 'Link pra quem vai marcar'),
          el('div', { class: 'text-[11px] text-amber-700' }, 'Sem app, sem login. Quem tem o link pode editar pontos.'),
        ),
      ),
      el('div', { class: 'bg-white border border-amber-200 rounded p-2 mb-2 text-[11px] text-slate-700 font-mono break-all' }, scoutUrl),
      el('div', { class: 'grid grid-cols-2 gap-2' },
        el('a', {
          class: 'text-xs px-3 py-2 rounded bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-center no-underline',
          href: `https://wa.me/?text=${wppText('Vai marcar pra mim?', scoutUrl)}`,
          target: '_blank', rel: 'noopener',
        }, '📱 WhatsApp'),
        copyButton(scoutUrl),
      ),
    ));
  }

  // Viewer — sempre. Vira "relatório" quando match encerra (mesmo link,
  // não expira, mostra placar final + stats + nota + notas).
  body.appendChild(el('div', { class: 'border border-cyan-200 bg-cyan-50/50 rounded-xl p-3' },
    el('div', { class: 'flex items-center gap-2 mb-2' },
      el('span', { class: 'text-lg' }, finished ? '📊' : '👁️'),
      el('div', null,
        el('div', { class: 'text-sm font-bold text-cyan-900' },
          finished ? 'Relatório do match' : 'Link pra acompanhar'),
        el('div', { class: 'text-[11px] text-cyan-700' },
          finished
            ? 'Snapshot do match · placar, stats, nota técnica, notas. Vive pra sempre.'
            : 'Família, escola, amigos — vê em tempo real. O mesmo link vira o relatório quando o match terminar.'),
      ),
    ),
    el('div', { class: 'bg-white border border-cyan-200 rounded p-2 mb-2 text-[11px] text-slate-700 font-mono break-all' }, viewUrl),
    el('div', { class: 'grid grid-cols-2 gap-2' },
      el('a', {
        class: 'text-xs px-3 py-2 rounded bg-cyan-600 hover:bg-cyan-700 text-white font-semibold text-center no-underline',
        href: `https://wa.me/?text=${wppText(finished ? 'Relatório do match' : 'Acompanha o jogo', viewUrl)}`,
        target: '_blank', rel: 'noopener',
      }, '📱 WhatsApp'),
      copyButton(viewUrl),
    ),
  ));
}

function copyButton(text) {
  const btn = el('button', {
    class: 'text-xs px-3 py-2 rounded border border-slate-300 hover:bg-slate-50 font-semibold',
  }, '📋 Copiar');
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✓ Copiado';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch {
      alert('Copie manualmente: ' + text);
    }
  };
  return btn;
}

// Página pública via token — bypass total do login. Usa inline styles
// nos containers raiz pra não depender de Tailwind processar pós-mount.
async function openPublicLiveMatch(kind, token) {
  // Esconde tudo do app normal e cria overlay fullscreen
  document.body.innerHTML = '';
  document.body.className = 'public-match-mode';
  // Gradient começa com mesmo navy-dark do html (#0a2e3d) — sem isso o
  // status bar e o body teriam tons diferentes e cria uma "faixa" feia.
  document.body.style.cssText = 'margin:0; min-height:100vh; color:white; background: linear-gradient(135deg, #0a2e3d 0%, #0e3a4d 100%); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';

  const root = document.createElement('div');
  // Mobile: max 28rem (uma coluna). Desktop (lg+): max 64rem (duas colunas via grid abaixo)
  root.className = 'mx-auto pb-8 min-h-screen max-w-md lg:!max-w-5xl';
  document.body.appendChild(root);

  const setMsg = (html) => { root.innerHTML = html; };

  // Spinner enquanto carrega
  setMsg(`
    <div style="padding: 4rem 1.5rem; text-align: center;">
      <div style="font-size: 2.5rem; margin-bottom: 1rem;">🎾</div>
      <div style="font-weight: 600; opacity: 0.85;">Tennis Flow</div>
      <div style="font-size: 0.875rem; opacity: 0.5; margin-top: 0.5rem;">Carregando match…</div>
    </div>
  `);

  const renderError = (msg) => setMsg(`
    <div style="padding: 4rem 1.5rem; text-align: center;">
      <div style="font-size: 2.5rem; margin-bottom: 1rem;">🎾</div>
      <div style="font-weight: 600;">Tennis Flow</div>
      <div style="color: #fca5a5; font-size: 0.875rem; margin-top: 1rem;">${msg}</div>
      <div style="color: rgba(255,255,255,0.5); font-size: 0.75rem; margin-top: 0.5rem;">O link pode ter expirado ou estar incorreto.</div>
    </div>`);

  let m;
  try {
    m = await api.publicGetMatch(kind, token);
  } catch (err) {
    return renderError(err.message);
  }

  const isScout = kind === 'scout';

  const render = () => {
    try {
      root.innerHTML = '';

      // Header com inline styles
      const header = document.createElement('div');
      header.style.cssText = 'padding: 0.75rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 0.75rem; height: 60px;';
      const liveBadge = m.finished
        ? `<div style="font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:0.05em; color:#cbd5e1;">${m.abandoned ? 'Encerrado' : 'Final'}</div>`
        : `<div style="font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:0.05em; color:#f87171; display:flex; align-items:center; gap:0.375rem;">
             <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ef4444; animation: pulse 1.5s ease-in-out infinite;"></span>
             ${isScout ? 'Você está marcando' : 'Acompanhando'}
           </div>`;
      header.innerHTML = `
        <div style="font-size:1.5rem;">🎾</div>
        <div style="flex:1; min-width:0;">
          ${liveBadge}
          <div style="font-size:0.875rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.athleteName} vs ${m.opponentName}</div>
          ${m.tournamentName ? `<div style="font-size:11px; color:#a5f3fc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.tournamentName}</div>` : ''}
        </div>
        <div style="font-size:10px; color:rgba(255,255,255,0.5);">Tennis Flow</div>
      `;
      root.appendChild(header);

      // Reuso das helpers (já usam el() com Tailwind — funciona pq Tailwind
      // CDN tem MutationObserver e processa dinamicamente)
      root.appendChild(renderScorePanel(m));

      // Desktop: 2 colunas. Mobile: tudo empilhado.
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-1 lg:grid-cols-2 lg:gap-4';
      const leftCol = document.createElement('div');
      leftCol.className = 'flex flex-col';
      const rightCol = document.createElement('div');
      rightCol.className = 'flex flex-col';
      grid.appendChild(leftCol);
      grid.appendChild(rightCol);
      root.appendChild(grid);

      if (isScout && !m.finished) {
        leftCol.appendChild(renderPhaseBanner(m));
        leftCol.appendChild(renderStatButtons(m, null,
          async (winner, stat) => {
            try { m = await api.publicAddPoint(token, winner, stat); render(); }
            catch (err) { alert(err.message); }
          },
          async (stat) => {
            try { m = await api.publicAddMarker(token, stat); render(); }
            catch (err) { alert(err.message); }
          },
        ));
        leftCol.appendChild(renderActions(m, null, async (action) => {
          try {
            if (action === 'undo') {
              m = await api.publicUndoPoint(token); render();
            } else if (action === 'game-manual') {
              const winner = await pickGameWinner(m.athleteName, m.opponentName);
              if (!winner) return;
              m = await api.publicGameManual(token, winner);
              render();
            } else if (action === 'abandon') {
              const result = await pickAbandonSide(m.athleteName, m.opponentName);
              if (!result) return;
              await api.publicAbandonMatch(token, result.side, result.reason);
              window.location.reload();
            }
          } catch (err) {
            alert(err.message);
          }
        }));
        rightCol.appendChild(renderStatsPanel(m));
        rightCol.appendChild(renderMomentumPanel(m));
        rightCol.appendChild(renderNotesPanel(m, {
          onAdd: async (text, tag) => {
            m = await api.publicAddNote(token, text, tag);
            render();
          },
        }));
      } else {
        // Viewer (live ou relatório finalizado): stats à esquerda, momentum+notas à direita
        leftCol.appendChild(renderStatsPanel(m));
        rightCol.appendChild(renderMomentumPanel(m));
        if (isScout) {
          rightCol.appendChild(renderNotesPanel(m, {
            onAdd: async (text, tag) => {
              m = await api.publicAddNote(token, text, tag);
              render();
            },
          }));
        } else {
          // Viewer (coach) pode adicionar notas — funciona ao vivo E pós-jogo.
          rightCol.appendChild(renderNotesPanel(m, {
            onAdd: async (text, tag) => {
              m = await api.publicLiveAddNote(token, text, tag);
              render();
            },
          }));
        }
      }

      if (!isScout && !m.finished) {
        const tip = document.createElement('div');
        tip.style.cssText = 'padding: 0.5rem 1rem; font-size: 11px; color: rgba(255,255,255,0.5); text-align: center;';
        tip.textContent = 'Atualizando a cada 5 segundos…';
        root.appendChild(tip);
      }
    } catch (err) {
      console.error('render error:', err);
      renderError('Erro ao renderizar: ' + (err.message || err));
    }
  };

  // Anima o pulse
  if (!document.getElementById('public-anim-style')) {
    const s = document.createElement('style');
    s.id = 'public-anim-style';
    s.textContent = '@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }';
    document.head.appendChild(s);
  }

  render();

  // Espectador: polling
  if (!isScout && !m.finished) {
    const id = setInterval(async () => {
      try {
        const fresh = await api.publicGetMatch(kind, token);
        m = fresh;
        render();
        if (m.finished) clearInterval(id);
      } catch {}
    }, 5000);
  }
}

function openCompleteReportRequestModal(athleteName) {
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-lg bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
    style: 'max-height: 85vh;',
  });

  const header = el('div', { class: 'bg-[#0e3a4d] text-white px-5 py-3 flex items-center justify-between' },
    el('span', { class: 'font-medium' }, '📊 Solicitar análise completa'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  );

  const body = el('div', { class: 'px-5 py-4 overflow-y-auto flex-1 space-y-3' });

  body.appendChild(el('div', { class: 'text-[13px] text-slate-700 leading-relaxed' },
    'Cada partida revela um padrão. Esse relatório tira tudo a limpo: onde o atleta está, onde evolui e onde focar. Inclui gráficos e leitura narrativa, com interpretação assinada pelo estatístico responsável.',
  ));

  body.appendChild(el('a', {
    class: 'block rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-[13px] text-cyan-800 hover:bg-cyan-100',
    href: '/exemplo-relatorio.pdf',
    target: '_blank',
    rel: 'noopener',
  }, '📄 Veja um exemplo →'));

  const consentBox = el('div', { class: 'rounded-lg border border-amber-200 bg-amber-50 p-3' },
    el('div', { class: 'text-[11px] font-semibold uppercase tracking-wide text-amber-800 mb-1.5' },
      '🔒 Autorização de compartilhamento de dados'),
    el('div', { class: 'text-[12px] text-slate-700 leading-relaxed mb-2' },
      `Para elaborar o relatório, é preciso compartilhar com Alexandre Garcia (alexandre@opiniao.inf.br), estatístico responsável, os dados de identificação e desempenho esportivo de ${athleteName} (resultados, scores, oponentes, datas e categorias dos jogos). O uso é exclusivo para a confecção deste relatório, em conformidade com a LGPD (Lei nº 13.709/2018). Você pode revogar esta autorização a qualquer momento por email.`,
    ),
  );

  const checkbox = el('input', { type: 'checkbox', id: 'lgpd-consent', class: 'mt-0.5' });
  const consentLabel = el('label', {
    class: 'flex items-start gap-2 text-[12px] text-slate-800 cursor-pointer select-none',
    for: 'lgpd-consent',
  },
    checkbox,
    el('span', null, `Autorizo o compartilhamento dos dados de ${athleteName} nos termos acima.`),
  );
  consentBox.appendChild(consentLabel);
  body.appendChild(consentBox);

  const footer = el('div', { class: 'px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2' });
  const cancelBtn = el('button', {
    class: 'px-3 py-1.5 text-sm rounded border border-slate-300 text-slate-700 hover:bg-slate-100',
    onClick: close,
  }, 'Cancelar');
  const sendBtn = el('button', {
    class: 'px-3 py-1.5 text-sm rounded bg-[#0e3a4d] text-white font-medium opacity-50 cursor-not-allowed',
    disabled: true,
    onClick: async () => {
      if (!checkbox.checked) return;
      const consentText =
        `Autorizo o compartilhamento dos dados de identificação e desempenho esportivo de ${athleteName} ` +
        `com Alexandre Garcia (alexandre@opiniao.inf.br), estatístico responsável, exclusivamente para a ` +
        `elaboração do relatório técnico solicitado, em conformidade com a LGPD (Lei nº 13.709/2018). ` +
        `O usuário pode revogar esta autorização a qualquer momento por email.`;
      // Triplica a evidência: registra server-side antes de abrir o mailto.
      // Falha de rede não bloqueia o fluxo — usuário ainda manda o email.
      try {
        await fetch(`/api/profiles/${state.activeProfileId}/report-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consentText, athleteName }),
        });
      } catch {}
      const subject = encodeURIComponent(`Solicito análise completa — ${athleteName}`);
      const lines = [
        `Gostaria de receber o relatório técnico de performance completo de ${athleteName}, assinado pelo estatístico responsável.`,
        '',
        consentText,
        `Data da autorização: ${new Date().toLocaleString('pt-BR')}`,
      ];
      const body2 = encodeURIComponent(lines.join('\n'));
      window.location.href = `mailto:alexandre@opiniao.inf.br?subject=${subject}&body=${body2}`;
      close();
    },
  }, 'Enviar solicitação →');
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      sendBtn.disabled = false;
      sendBtn.className = 'px-3 py-1.5 text-sm rounded bg-[#0e3a4d] text-white font-medium hover:bg-[#16526a]';
    } else {
      sendBtn.disabled = true;
      sendBtn.className = 'px-3 py-1.5 text-sm rounded bg-[#0e3a4d] text-white font-medium opacity-50 cursor-not-allowed';
    }
  });
  footer.append(cancelBtn, sendBtn);

  card.append(header, body, footer);
  root.append(overlay, card);
}

function openCalendarSetup() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  if (!profile) return;
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });
  const card = el('div', {
    class: 'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-2rem)] max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden',
  });
  card.appendChild(el('div', { class: 'shrink-0 bg-[#0e3a4d] text-white px-5 py-3 flex items-center justify-between' },
    el('h3', { class: 'font-medium' }, 'Conectar agenda'),
    el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
  ));
  const body = el('div', { class: 'flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4' });
  card.appendChild(body);
  body.appendChild(el('p', { class: 'text-sm text-slate-600' }, 'Carregando…'));
  root.appendChild(overlay);
  root.appendChild(card);

  (async () => {
    let token = profile.calendarToken;
    if (!token) {
      try {
        const r = await fetch(`/api/profiles/${profile.id}/calendar-token`);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        token = (await r.json()).token;
        profile.calendarToken = token;
      } catch (err) {
        body.innerHTML = '';
        body.appendChild(el('p', { class: 'text-sm text-rose-700' }, 'Erro ao gerar link da agenda: ' + err.message));
        return;
      }
    }
    const httpUrl = `${location.protocol}//${location.host}/calendar/${token}.ics`;
    const webcalUrl = `webcal://${location.host}/calendar/${token}.ics`;
    const starredCount = (state.data?.tournaments || []).filter(t => t.notes?.selected).length;

    body.innerHTML = '';
    body.appendChild(el('p', { class: 'text-sm text-slate-700' },
      `Conecte uma vez — a agenda atualiza sozinha. Inclui ${starredCount} torneio${starredCount === 1 ? '' : 's'} marcado${starredCount === 1 ? '' : 's'} com ⭐.`,
    ));

    // Botões grandes
    body.appendChild(el('div', { class: 'flex flex-col gap-2' },
      el('a', {
        href: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(httpUrl)}`,
        target: '_blank', rel: 'noopener',
        class: 'text-center bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg',
      }, 'Inscrever no Google Calendar'),
      el('a', {
        href: webcalUrl,
        class: 'text-center bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium px-4 py-2.5 rounded-lg',
      }, 'Inscrever no Apple Calendar'),
    ));

    // URL pra copiar (Outlook, Yahoo, ou qualquer app)
    const urlInput = el('input', {
      type: 'text', value: httpUrl, readonly: 'readonly',
      class: 'flex-1 text-xs bg-slate-50 border border-slate-300 rounded px-2 py-1.5 font-mono',
      onClick: (e) => e.target.select(),
    });
    const copyBtn = el('button', {
      type: 'button',
      class: 'shrink-0 text-xs rounded bg-slate-700 hover:bg-slate-800 text-white px-3 py-1.5',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(httpUrl);
          copyBtn.textContent = 'Copiado!';
          setTimeout(() => copyBtn.textContent = 'Copiar', 1500);
        } catch { urlInput.select(); document.execCommand('copy'); }
      },
    }, 'Copiar');
    body.appendChild(el('div', { class: 'pt-2 border-t border-slate-200' },
      el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5' }, 'Outro app de agenda?'),
      el('div', { class: 'flex items-center gap-2' }, urlInput, copyBtn),
      el('p', { class: 'text-[11px] text-slate-500 mt-1' }, 'Cole essa URL na opção "Inscrever em calendário" do seu app (Outlook, Yahoo, Fantastical, etc).'),
    ));

    body.appendChild(el('ul', { class: 'text-xs text-slate-500 space-y-1 pt-2 border-t border-slate-100 list-disc pl-4' },
      el('li', null, 'Torneios marcados com ⭐ entram com alarme 7 dias antes.'),
      el('li', null, 'Boletos pendentes entram com alarme 1 dia antes.'),
      el('li', null, 'No iPhone: Ajustes → Calendário → Contas → Inscritos pra ajustar a frequência de atualização.'),
    ));
  })();
}

async function resetBoardOverrides() {
  if (!state.activeProfileId) return;
  const ok = confirm(
    'Resetar movimentações manuais?\n\n' +
    'Todos os cards voltam pra coluna automática (calculada pelos sinais do TI).\n' +
    'Comentários, etiquetas, anexos, agenda e alertas são mantidos.'
  );
  if (!ok) return;
  try {
    const r = await api.resetBoardOverrides(state.activeProfileId);
    await refreshActive();
    render();
    alert(`Pronto. ${r.cleared} card(s) voltaram para a coluna automática.`);
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function resetAllData() {
  if (!state.activeProfileId) return;
  const ok = confirm(
    'RESETAR TUDO do quadro deste atleta?\n\n' +
    'Apaga: torneios sincronizados, comentários, atividades, ' +
    'movimentações, alertas pendentes.\n\n' +
    'Mantém: a conta, o perfil do atleta e as credenciais do TI.\n\n' +
    'A próxima sincronização vai virar uma "primeira sincronização" ' +
    '(baseline novo).\n\n' +
    'Esta ação não pode ser desfeita.'
  );
  if (!ok) return;
  if (!confirm('Tem certeza absoluta? Vai começar do zero.')) return;
  try {
    await api.resetAll(state.activeProfileId);
    state.data = null;
    state.syncStatus = null;
    render();
    await refreshActive();
    render();
    alert('Pronto. Toque em ⚙︎ → Sincronizar agora pra puxar tudo do TI.');
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

async function syncNow() {
  // Sem perfil cadastrado, sync não faz sentido — aviso explícito e
  // direciona pra cadastro. Antes ficava silencioso ("nada pra sincronizar").
  if (!state.profiles?.length) {
    if (confirm('Você ainda não cadastrou nenhum atleta. Pra sincronizar, é preciso primeiro adicionar um atleta com as credenciais do Tênis Integrado.\n\nQuer adicionar um atleta agora?')) {
      openProfileForm();
    }
    return;
  }
  // Dispara sync pra TODOS os atletas da household. O modal segue
  // mostrando o status do atleta ativo (que é o que o user está vendo).
  state.syncStatus = { state: 'running', startedAt: new Date().toISOString() };
  renderHeader();
  openSyncProgressModal();
  try { await api.syncAll(); } catch {}
  pollSyncStatus();
}

function switchProfile(id) {
  if (id === '__new__') { openProfileForm(); return; }
  state.activeProfileId = id;
  localStorage.setItem('activeProfileId', id);
  state.data = null;
  state.syncStatus = null;
  render();
  refreshActive().then(() => { render(); pollSyncStatus(); });
}

function renderEmptyState() {
  return el('div', { class: 'mt-12 text-center max-w-md mx-auto' },
    el('p', { class: 'text-slate-600 mb-4' }, 'Nenhum perfil cadastrado. Adicione o atleta para começar.'),
    el('button', { class: 'rounded bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700', onClick: () => openProfileForm() }, 'Adicionar atleta'),
  );
}

function renderNeedSync() {
  return el('div', { class: 'mt-12 text-center max-w-md mx-auto' },
    el('p', { class: 'text-slate-100 mb-4' }, 'Ainda não há torneios carregados. Toque no avatar → Sincronizar agora pra puxar a lista do Tênis Integrado.'),
    el('p', { class: 'text-xs text-slate-300' }, 'A sincronização leva ~4 minutos.'),
  );
}

async function giveUpTournament(t) {
  if (!confirm(`Marcar "${t.name}" como desistido?\n\nO torneio vai sair do calendário e o lembrete de boleto será removido.`)) return;
  t.notes = { ...(t.notes || {}), manualGiveUp: true, selected: false };
  rerenderBody();
  try {
    await api.updateNotes(state.activeProfileId, t.id, { manualGiveUp: true, selected: false });
  } catch (err) {
    t.notes.manualGiveUp = false;
    rerenderBody();
    alert('Erro: ' + err.message);
  }
}

async function revertGiveUp(t) {
  t.notes = { ...(t.notes || {}), manualGiveUp: false };
  rerenderBody();
  try {
    await api.updateNotes(state.activeProfileId, t.id, { manualGiveUp: false });
  } catch (err) {
    t.notes.manualGiveUp = true;
    rerenderBody();
    alert('Erro: ' + err.message);
  }
}

async function confirmInscription(t) {
  t.notes = { ...(t.notes || {}), manualInscribed: true };
  if (!t.notes.selected) t.notes.selected = true; // also star (calendar)
  rerenderBody();
  try {
    await api.updateNotes(state.activeProfileId, t.id, { manualInscribed: true, selected: t.notes.selected });
  } catch (err) {
    t.notes.manualInscribed = false;
    rerenderBody();
    alert('Erro: ' + err.message);
  }
}

async function revertManualInscription(t) {
  t.notes = { ...(t.notes || {}), manualInscribed: false };
  rerenderBody();
  try {
    await api.updateNotes(state.activeProfileId, t.id, { manualInscribed: false });
  } catch (err) {
    t.notes.manualInscribed = true;
    rerenderBody();
    alert('Erro: ' + err.message);
  }
}

function receiptsNoteName(t) {
  const slugCity = (t.city || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '').slice(0, 12) || 'cidade';
  // MM-AA do início
  let monthYear = '';
  if (t.startDate) {
    const parts = t.startDate.split('/');
    if (parts.length === 3) monthYear = `${parts[1]}-${parts[2].slice(2)}`;
  }
  return `Tenis-Anna-${monthYear}-${slugCity}`.replace(/-+/g, '-').replace(/-$/, '');
}

// ===== Comprovantes — galeria por torneio com upload, categoria e zip =====
const RECEIPT_CATEGORY_META = {
  food:         { icon: '🍽️', label: 'Alimentação' },
  transport:    { icon: '🚕', label: 'Transporte' },
  lodging:      { icon: '🏨', label: 'Hospedagem' },
  registration: { icon: '💰', label: 'Inscrição' },
  other:        { icon: '📋', label: 'Outros' },
};
const RECEIPT_CATEGORY_ORDER = ['registration', 'lodging', 'transport', 'food', 'other'];

async function compressImage(file, maxWidth = 1600, quality = 0.8) {
  // createImageBitmap respects EXIF orientation on Safari 14+
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(async () => {
    // Fallback for older browsers
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; }
    finally { URL.revokeObjectURL(url); }
  });
  let w = bitmap.width, h = bitmap.height;
  if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Falha na compressão')), 'image/jpeg', quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function receiptsBlock(t) {
  const profileId = state.activeProfileId;
  const wrapper = el('section', null,
    el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, '📂 Comprovantes'),
    el('div', { class: 'rounded border border-slate-200 bg-white p-3 space-y-3', id: `receipts-${t.id}` },
      el('div', { class: 'text-xs text-slate-500' }, 'Carregando...'),
    ),
  );

  // Async load + render
  (async () => {
    const container = wrapper.querySelector(`#receipts-${t.id}`);
    let data;
    try {
      data = await api.listReceipts(profileId, t.id);
    } catch (err) {
      container.innerHTML = '';
      container.appendChild(el('div', { class: 'text-xs text-red-600' }, 'Erro ao carregar: ' + err.message));
      return;
    }
    renderReceiptsGallery(container, t, data);
  })();

  return wrapper;
}

function renderReceiptsGallery(container, t, data) {
  container.innerHTML = '';
  const profileId = state.activeProfileId;
  const receipts = data.receipts || [];
  const grouped = new Map();
  for (const cat of RECEIPT_CATEGORY_ORDER) grouped.set(cat, []);
  for (const r of receipts) {
    if (!grouped.has(r.category)) grouped.set(r.category, []);
    grouped.get(r.category).push(r);
  }

  // Upload row
  const fileCamera = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
  const fileGallery = el('input', { type: 'file', accept: 'image/*,application/pdf', class: 'hidden' });
  fileCamera.onchange = (e) => handleUpload(e.target.files?.[0]);
  fileGallery.onchange = (e) => handleUpload(e.target.files?.[0]);

  async function handleUpload(file) {
    if (!file) return;
    const category = await pickCategory();
    if (!category) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const status = el('div', { class: 'text-xs text-slate-500 mt-1' }, isPdf ? '⬆ Enviando PDF...' : '🔄 Comprimindo...');
    container.appendChild(status);
    try {
      let dataUrl;
      if (isPdf) {
        // PDF não é comprimido — limite de 5MB no backend
        if (file.size > 5 * 1024 * 1024) throw new Error('PDF maior que 5MB');
        dataUrl = await blobToDataUrl(file);
      } else {
        const blob = await compressImage(file);
        status.textContent = '⬆ Enviando...';
        dataUrl = await blobToDataUrl(blob);
      }
      await api.uploadReceipt(profileId, t.id, { category, dataUrl, originalName: file.name });
      patchCardReceiptsCount(t.id, +1);
      // Reload
      const fresh = await api.listReceipts(profileId, t.id);
      renderReceiptsGallery(container, t, fresh);
    } catch (err) {
      status.textContent = '⚠ Erro: ' + err.message;
      status.className = 'text-xs text-red-600 mt-1';
      setTimeout(() => status.remove(), 5000);
    }
    fileCamera.value = '';
    fileGallery.value = '';
  }

  // "Tirar foto" só faz sentido em mobile (precisa de câmera nativa).
  // No desktop, browsers normalmente abrem o seletor de arquivo igual ao "Escolher".
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const buttonsRow = el('div', { class: 'flex flex-wrap gap-2' },
    isMobile && el('button', {
      class: 'text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded',
      onClick: () => fileCamera.click(),
    }, '📸 Tirar foto'),
    el('button', {
      class: 'text-sm bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded',
      onClick: () => fileGallery.click(),
    }, isMobile ? '📁 Escolher do celular' : '📁 Escolher arquivo'),
    receipts.length > 0 && el('a', {
      href: `/api/profiles/${profileId}/tournaments/${t.id}/receipts.zip`,
      download: `comprovantes-${(t.name || 'torneio').replace(/[^\w]+/g, '-').slice(0, 40)}.zip`,
      class: 'ml-auto text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded border border-slate-300',
    }, '📤 Exportar zip'),
    fileCamera, fileGallery,
  );
  container.appendChild(buttonsRow);

  // Cleanup hint when applicable
  if (typeof data.daysUntilCleanup === 'number' && data.daysUntilCleanup >= 0 && data.daysUntilCleanup <= 14 && receipts.length > 0) {
    container.appendChild(el('div', { class: 'text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2' },
      `📦 Comprovantes serão arquivados em ${data.daysUntilCleanup} dia${data.daysUntilCleanup === 1 ? '' : 's'}. Exporte o zip antes se quiser guardar.`,
    ));
  }

  if (receipts.length === 0) {
    container.appendChild(el('p', { class: 'text-xs text-slate-500 italic' }, 'Nenhum comprovante. Use os botões acima pra adicionar.'));
    return;
  }

  // Grouped gallery
  for (const [cat, items] of grouped) {
    if (!items.length) continue;
    const meta = RECEIPT_CATEGORY_META[cat] || { icon: '📋', label: cat };
    const grid = el('div', { class: 'grid grid-cols-3 sm:grid-cols-4 gap-2' });
    for (const r of items) {
      const cell = el('div', {
        class: 'relative group aspect-square overflow-hidden rounded border border-slate-200 hover:border-emerald-400',
      });
      const isPdf = r.mime === 'application/pdf';
      // Imagem (ou placeholder PDF) clicável — abre o viewer
      cell.appendChild(el('button', {
        class: 'block w-full h-full bg-slate-50',
        onClick: () => openReceiptViewer(t, r, items),
      },
        isPdf
          ? el('div', { class: 'w-full h-full flex flex-col items-center justify-center gap-1 text-slate-700 px-1' },
              el('span', { class: 'text-3xl' }, '📄'),
              el('span', { class: 'text-[10px] font-semibold' }, 'PDF'),
            )
          : el('img', { src: r.viewUrl, alt: '', class: 'w-full h-full object-cover', loading: 'lazy' }),
      ));
      // Faixa da categoria (não clicável)
      cell.appendChild(el('div', {
        class: 'absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate pointer-events-none',
      }, meta.icon + ' ' + meta.label.slice(0, 3)));
      // Botão X — exclui o comprovante sem abrir o viewer
      cell.appendChild(el('button', {
        class: 'absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 hover:bg-red-600 text-white text-xs leading-none flex items-center justify-center shadow',
        title: 'Excluir comprovante',
        onClick: async (e) => {
          e.stopPropagation();
          if (!confirm('Excluir este comprovante?')) return;
          try {
            await api.deleteReceipt(profileId, t.id, r.id);
            patchCardReceiptsCount(t.id, -1);
            const fresh = await api.listReceipts(profileId, t.id);
            renderReceiptsGallery(container, t, fresh);
          } catch (err) {
            alert('Erro ao excluir: ' + err.message);
          }
        },
      }, '×'));
      grid.appendChild(cell);
    }
    container.appendChild(el('div', { class: 'space-y-1' },
      el('div', { class: 'text-xs font-medium text-slate-700' }, `${meta.icon} ${meta.label} (${items.length})`),
      grid,
    ));
  }
}

function patchCardReceiptsCount(tid, delta) {
  const t = state.data?.tournaments?.find(x => x.id === tid);
  if (!t) return;
  t.receiptsCount = Math.max(0, (t.receiptsCount || 0) + delta);
  const card = document.querySelector(`[data-tid="${tid}"]`);
  if (!card) return;
  const metaDiv = card.lastElementChild;
  if (!metaDiv) return;
  metaDiv.replaceChild(cardMetaRow(t) || el('span'), metaDiv.firstChild);
}

function pickCategory() {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[60]' });
    const panel = el('div', { class: 'fixed inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center z-[61] p-4' },
      el('div', { class: 'bg-white text-slate-900 rounded-lg shadow-xl w-full max-w-sm sm:mx-auto p-4' },
        el('h3', { class: 'text-base font-semibold mb-3 text-slate-900' }, 'Categoria do comprovante'),
        el('div', { class: 'grid grid-cols-1 gap-2' },
          ...RECEIPT_CATEGORY_ORDER.map(cat => {
            const m = RECEIPT_CATEGORY_META[cat];
            return el('button', {
              class: 'w-full text-left bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 px-4 py-3 rounded text-sm flex items-center gap-3',
              onClick: () => { cleanup(); resolve(cat); },
            }, el('span', { class: 'text-xl' }, m.icon), el('span', { class: 'font-medium' }, m.label));
          }),
          el('button', {
            class: 'w-full text-center text-sm text-slate-500 hover:text-slate-800 underline mt-2',
            onClick: () => { cleanup(); resolve(null); },
          }, 'Cancelar'),
        ),
      ),
    );
    function cleanup() { overlay.remove(); panel.remove(); }
    overlay.onclick = () => { cleanup(); resolve(null); };
    root.appendChild(overlay);
    root.appendChild(panel);
  });
}

function openReceiptViewer(t, current, all) {
  const profileId = state.activeProfileId;
  const root = document.getElementById('modal-root');
  let idx = all.findIndex(r => r.id === current.id);
  if (idx < 0) idx = 0;

  const overlay = el('div', { class: 'fixed inset-0 bg-black/90 z-[60] flex flex-col' });
  // Container do conteúdo — img pra imagem, iframe pra PDF.
  const contentSlot = el('div', { class: 'flex-1 min-h-0 flex items-center justify-center overflow-hidden' });
  const meta = el('div', { class: 'text-white text-sm px-4 py-2 flex items-center justify-between gap-3' });

  function show() {
    const r = all[idx];
    const isPdf = r.mime === 'application/pdf';
    contentSlot.innerHTML = '';
    if (isPdf) {
      // PDF nativo do browser — viewer do iOS Safari/Chrome lida bem
      contentSlot.appendChild(el('iframe', {
        src: r.viewUrl,
        class: 'w-full h-full bg-white',
        style: 'border:0',
      }));
    } else {
      const img = el('img', {
        src: r.viewUrl,
        class: 'max-w-full max-h-full object-contain',
      });
      // Tap esquerda/direita pra navegar — só faz sentido em imagem
      img.onclick = (e) => {
        const rect = img.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < rect.width / 2 && idx > 0) { idx--; show(); }
        else if (x >= rect.width / 2 && idx < all.length - 1) { idx++; show(); }
      };
      contentSlot.appendChild(img);
    }
    const m = RECEIPT_CATEGORY_META[r.category] || { icon: '📋', label: r.category };
    meta.innerHTML = '';
    meta.append(
      el('div', { class: 'flex items-center gap-2 truncate' },
        el('span', null, `${idx + 1} / ${all.length}`),
        el('span', { class: 'text-slate-300' }, '·'),
        el('span', null, `${m.icon} ${m.label}`),
      ),
      el('div', { class: 'flex items-center gap-2 shrink-0' },
        el('button', { class: 'text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded', onClick: async () => {
          const cat = await pickCategory();
          if (!cat || cat === r.category) return;
          await api.updateReceiptCategory(profileId, t.id, r.id, cat);
          all[idx].category = cat;
          show();
        } }, '📂 Categoria'),
        el('button', { class: 'text-xs bg-red-600 hover:bg-red-700 px-2 py-1 rounded', onClick: async () => {
          if (!confirm('Excluir este comprovante?')) return;
          await api.deleteReceipt(profileId, t.id, r.id);
          patchCardReceiptsCount(t.id, -1);
          all.splice(idx, 1);
          if (all.length === 0) { close(); reloadGallery(); return; }
          if (idx >= all.length) idx = all.length - 1;
          show();
          reloadGallery();
        } }, '🗑️'),
        el('button', { class: 'text-2xl leading-none px-2', onClick: () => close() }, '×'),
      ),
    );
  }
  function reloadGallery() {
    const container = document.getElementById(`receipts-${t.id}`);
    if (container) {
      api.listReceipts(profileId, t.id).then(d => renderReceiptsGallery(container, t, d)).catch(() => {});
    }
  }
  function close() { overlay.remove(); }

  overlay.append(meta, contentSlot);
  show();
  root.appendChild(overlay);
}

function tournamentTiers(t) {
  const list = (t.tiers && t.tiers.length) ? t.tiers : (t.tier ? [t.tier] : []);
  const order = new Map(TIER_ORDER.map((x, i) => [x, i]));
  return [...list].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

async function toggleSelected(t) {
  const newVal = !t.notes?.selected;
  const currentNotes = t.notes || {};
  // Quando estrela pela primeira vez sem coluna manual definida, grava a coluna
  // atual pra evitar que mutações de dados (ex: modal de detalhes atualiza datas
  // de inscrição) derivem o card pra outro auto-coluna no próximo render.
  const extra = (newVal && !currentNotes.column) ? { column: effectiveColumnFor(t) } : {};
  t.notes = { ...currentNotes, selected: newVal, ...extra };
  render();
  try {
    await api.updateNotes(state.activeProfileId, t.id, { selected: newVal, ...extra });
  } catch (err) {
    t.notes.selected = !newVal;
    if (extra.column) delete t.notes.column;
    render();
    alert('Erro: ' + err.message);
  }
}

// ===== Tournament detail modal =====
async function openTournament(tid) {
  const t = state.data.tournaments.find(x => x.id === tid);
  if (!t) return;
  const isFuture = t.derivedStatus === 'upcoming' && t.startDate && t.endDate;
  const inscribedFinal = !t.notes?.manualGiveUp && (t.isAnnaInscribed || t.notes?.manualInscribed);
  const boletoExpired = !t.notes?.manualGiveUp && t.pendingPayment && isBoletoExpired(t);
  const registrationClosed = !t.pendingPayment && !t.notes?.manualGiveUp && isRegistrationClosed(t, inscribedFinal);
  const isLost = boletoExpired || (registrationClosed && !inscribedFinal);
  const showTravelTools = isFuture && !isLost;

  // Lazy-fetch detalhes + voo em paralelo — antes era sequencial e dobrava
  // o tempo de abertura do modal (cada um leva ~500-800ms).
  // Passa profileId pro backend persistir a união de tiers em synced.json
  // (corrige o caso de card multi-chave que aparecia com só uma).
  const [details, flightInfo] = await Promise.all([
    isFuture ? api.tournamentDetails(tid, state.activeProfileId).catch(() => null) : Promise.resolve(null),
    showTravelTools ? api.flightUrl(state.activeProfileId, tid).catch(() => ({ error: true })) : Promise.resolve(null),
  ]);
  // Une tiers locais + os detalhes pra etiquetas refletirem todas as chaves
  // imediatamente (sem precisar refresh). Também copia cancelDeadline pra
  // a coluna re-derivar correto quando user fechar o modal.
  if (details) {
    if (Array.isArray(details.tiers) && details.tiers.length) {
      const tierUnion = [...new Set([...(t.tiers || []), ...details.tiers])];
      if (tierUnion.length !== (t.tiers || []).length) {
        t.tiers = tierUnion;
        if (!t.tier) t.tier = tierUnion[0];
      }
    }
    if (details.cancelDeadline && t.cancelDeadline !== details.cancelDeadline) {
      t.cancelDeadline = details.cancelDeadline;
    }
    if (details.registrationOpensAt && t.registrationOpensAt !== details.registrationOpensAt) {
      t.registrationOpensAt = details.registrationOpensAt;
    }
    if (details.registrationDeadline && t.registrationDeadline !== details.registrationDeadline) {
      t.registrationDeadline = details.registrationDeadline;
    }
  }
  const merged = details ? {
    ...t,
    hotels: details.hotels || t.hotels || [],
    venues: details.venues || t.venues || [],
    observations: details.observations || t.observations,
    cancelDeadline: details.cancelDeadline || t.cancelDeadline,
    registrationOpensAt: details.registrationOpensAt || t.registrationOpensAt,
    registrationDeadline: details.registrationDeadline || t.registrationDeadline,
    prices: details.prices || t.prices,
  } : t;

  const notes = t.notes || {};
  const root = $('modal-root');
  root.innerHTML = '';

  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/60 z-40', onClick: close });

  const observationsBlock = merged.observations
    ? el('details', { class: 'group' },
        el('summary', { class: 'cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600 hover:text-slate-900 select-none' },
          'Observações do torneio ▾',
        ),
        el('pre', { class: 'mt-2 text-xs whitespace-pre-wrap bg-slate-50 p-3 rounded border border-slate-200 max-h-64 overflow-auto' }, merged.observations),
      )
    : null;

  const starBtn = el('button', { class: 'text-2xl leading-none transition-colors' }, '');
  const updateStar = () => {
    const sel = !!t.notes?.selected;
    starBtn.textContent = sel ? '★' : '☆';
    starBtn.className = `text-2xl leading-none transition-colors ${sel ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`;
    starBtn.title = sel ? 'Remover da agenda' : 'Adicionar à agenda';
  };
  updateStar();
  starBtn.onclick = async () => {
    const newVal = !t.notes?.selected;
    const currentNotes = t.notes || {};
    const extra = (newVal && !currentNotes.column) ? { column: effectiveColumnFor(t) } : {};
    t.notes = { ...currentNotes, selected: newVal, ...extra };
    updateStar();
    try {
      await api.updateNotes(state.activeProfileId, t.id, { selected: newVal, ...extra });
      render();
    } catch (err) {
      t.notes.selected = !newVal;
      if (extra.column) delete t.notes.column;
      updateStar();
      alert('Erro: ' + err.message);
    }
  };

  // Column dropdown — change current column directly from modal
  const currentCol = effectiveColumnFor(t);
  const colSelect = el('select', {
    class: 'text-sm bg-white/10 hover:bg-white/15 text-white border border-white/20 rounded px-2 py-1 cursor-pointer',
    title: 'Mudar coluna',
  },
    ...orderedKanbanColumns().map(c => el('option', { value: c.id, selected: c.id === currentCol ? 'selected' : false },
      `${c.icon} ${state.columnLabels[c.id] || c.label}`,
    )),
  );
  colSelect.onchange = async () => {
    const newCol = colSelect.value;
    const oldCol = t.notes?.column || null;
    t.notes = { ...(t.notes || {}), column: newCol };
    try {
      await api.moveCard(state.activeProfileId, tid, newCol);
      render();
    } catch (err) {
      t.notes.column = oldCol;
      colSelect.value = currentCol;
      alert('Erro: ' + err.message);
    }
  };

  // Modal panel: centered, wide, 2-column body on md+
  const mainColumn = el('div', { class: 'flex-1 min-w-0 px-5 py-4 space-y-4 md:overflow-y-auto' },
      // Etiquetas (auto + manuais)
      renderLabelsSection(t),

      // Aviso prominente só pra boleto vencido (info nova). "Inscrições
      // encerradas" sozinho já é representado pela etiqueta acima — não
      // duplicar.
      boletoExpired && el('section', { class: 'rounded-lg bg-slate-100 border border-slate-300 p-3' },
        el('div', { class: 'text-sm font-medium text-slate-700' }, '❌ Boleto vencido — inscrição perdida'),
        el('div', { class: 'text-xs text-slate-600 mt-1' },
          'O prazo de pagamento passou. Você não pode mais participar deste torneio.'),
      ),

      t.pendingPayment && el('section', { class: 'rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 flex items-center justify-between gap-3' },
        el('div', { class: 'min-w-0' },
          el('div', { class: 'text-sm font-medium text-amber-900' }, `💰 Vence ${t.pendingPayment.dueDate || '?'} · ${fmtValueNoCents(t.pendingPayment.value)}`),
          t.pendingPayment.category && el('div', { class: 'text-xs text-amber-800 mt-0.5 truncate' }, t.pendingPayment.category),
        ),
      ),

      (() => {
        // Extrai data de encerramento/abertura do registrationStatus do TI
        // (ex: "Aberta até 19/05/2026", "Iniciado", "Encerrada em 14/05/2026")
        const win = getWindowState(merged);
        const regDateText = (t.registrationStatus || '').match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || null;
        const closeDate = merged.registrationDeadline || regDateText || merged.cancelDeadline;
        const opensDate = merged.registrationOpensAt;
        // TI aceita até 16h no dia do registrationDeadline (nosso default
        // mais comum). No fallback cancelDeadline o corte é 23:59.
        const closeHour = merged.registrationDeadline ? '16h' : (merged.cancelDeadline ? '23:59' : null);
        let regLine = null;
        if (win === 'open') {
          regLine = closeDate
            ? `Inscrições abertas até ${closeDate}${closeHour ? ` (${closeHour})` : ''}`
            : 'Inscrições abertas';
        } else if (win === 'closed') {
          regLine = closeDate ? `Inscrições encerraram em ${closeDate}` : 'Inscrições encerradas';
        } else if (win === 'pending') {
          regLine = opensDate ? `Inscrições abrem em ${opensDate}` : 'Inscrições a iniciar';
        } else if (t.registrationStatus) {
          regLine = `Inscrições: ${t.registrationStatus}`;
        }
        // Linha extra do cancelamento (sempre 23:59), só quando relevante
        const cancelLine = (merged.cancelDeadline && win !== 'closed')
          ? `Cancelamento até ${merged.cancelDeadline} (23:59)`
          : (merged.cancelDeadline ? `Cancelamento até ${merged.cancelDeadline}` : null);
        return el('section', null,
          el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, 'Datas'),
          el('p', { class: 'text-sm' }, `${t.startDate || '—'} a ${t.endDate || '—'}`),
          regLine && el('p', { class: 'text-xs text-slate-500 mt-0.5' }, regLine),
          cancelLine && el('p', { class: 'text-xs text-slate-500 mt-0.5' }, cancelLine),
        );
      })(),

      flightInfo && flightInfo.sameCity && el('section', null,
        el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, '🏠 Deslocamento'),
        el('p', { class: 'text-sm text-slate-700' }, `Torneio na mesma cidade do atleta (${flightInfo.origin}) — sem voo.`),
      ),

      flightInfo && !flightInfo.error && !flightInfo.sameCity && flightInfo.arrival && flightInfo.ret && el('section', null,
        el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, '✈ Passagens'),
        el('p', { class: 'text-sm mb-2' }, `${flightInfo.origin} → ${flightInfo.dest}  ·  ida ${flightInfo.arrival}, volta ${flightInfo.ret}`),
        el('div', { class: 'flex flex-wrap gap-2' },
          ...(flightInfo.links || []).map(l => el('a', {
            href: l.url, target: '_blank', rel: 'noopener',
            class: l.primary
              ? 'text-sm bg-emerald-600 text-white px-3 py-1.5 rounded hover:bg-emerald-700'
              : 'text-sm bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded hover:bg-slate-100',
          }, `${l.name} ↗`)),
        ),
      ),

      flightInfo?.error && el('section', null,
        el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, '✈ Passagens'),
        el('p', { class: 'text-xs text-slate-500' }, 'Não foi possível gerar link de busca (cidade sem aeroporto cadastrado).'),
      ),

      showTravelTools && merged.hotels?.length > 0 && !flightInfo?.sameCity && el('section', null,
        el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, `🏨 Hotéis oficiais (${merged.hotels.length})`),
        el('ul', { class: 'space-y-2' },
          ...merged.hotels.map(h => el('li', { class: 'text-sm border border-slate-200 rounded p-2' },
            el('div', { class: 'font-medium' }, h.name),
            h.address && el('div', { class: 'text-xs text-slate-600' }, h.address),
            (h.phone || h.email) && el('div', { class: 'text-xs text-slate-500' }, [h.phone, h.email].filter(Boolean).join(' · ')),
            h.url && el('a', { href: h.url, target: '_blank', rel: 'noopener', class: 'text-xs text-emerald-700 hover:underline break-all' }, h.url),
          )),
        ),
      ),

      showTravelTools && merged.venues?.length > 0 && el('section', null,
        el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, '📍 Locais dos jogos'),
        el('ul', { class: 'space-y-2' },
          ...merged.venues.map(v => el('li', { class: 'text-sm border border-slate-200 rounded p-2' },
            el('div', { class: 'font-medium' }, v.name),
            v.address && el('div', { class: 'text-xs text-slate-600' }, v.address),
            (v.phone || v.surface) && el('div', { class: 'text-xs text-slate-500' }, [v.phone, v.surface].filter(Boolean).join(' · ')),
          )),
        ),
      ),

      observationsBlock,

      receiptsBlock(t),
  );

  // Activity panel (right sidebar on md+, stacked below on mobile)
  const activityPanel = renderActivityPanel(t);

  const panel = el('div', {
    class: 'fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 pointer-events-none',
    // Inline safe-area pra PWA standalone do iPhone — header do modal não
    // pode invadir o notch/status bar nem a área do home indicator. Inline
    // tem prioridade máxima e não depende de match de selector CSS.
    style: 'padding-top: max(0.5rem, env(safe-area-inset-top)); padding-bottom: max(0.5rem, env(safe-area-inset-bottom));',
  },
    el('div', { class: 'pointer-events-auto bg-white text-slate-900 rounded-lg shadow-xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden' },
      // Header bar (dark navy like the kanban background)
      el('div', { class: 'shrink-0 bg-[#0e3a4d] text-white px-4 sm:px-5 py-3 flex items-center justify-between gap-3' },
        el('div', { class: 'flex items-center gap-2 flex-wrap min-w-0' },
          colSelect,
        ),
        el('div', { class: 'flex items-center gap-3 shrink-0' },
          starBtn,
          el('button', { class: 'text-white/70 hover:text-white text-2xl leading-none', onClick: close, title: 'Fechar' }, '×'),
        ),
      ),
      // Title block
      el('div', { class: 'shrink-0 px-5 py-3 border-b border-slate-200' },
        el('div', { class: 'flex items-start gap-3' },
          el('h2', { class: 'text-lg font-semibold leading-snug flex-1 min-w-0' }, t.name),
          t.url && el('a', {
            href: t.url, target: '_blank', rel: 'noopener',
            class: 'shrink-0 text-xs text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap mt-1',
            title: 'Abrir no Tênis Integrado',
          }, 'Ver no Tênis Integrado ↗'),
        ),
        el('p', { class: 'text-sm text-slate-600' }, [t.city, t.state].filter(Boolean).join(' / ') || ''),
      ),
      // Body: 2-column on md+, stacked on small
      el('div', { class: 'flex-1 min-h-0 overflow-y-auto md:overflow-hidden md:flex' },
        mainColumn,
        el('div', { class: 'md:w-80 md:shrink-0 md:overflow-y-auto md:border-l border-t md:border-t-0 border-slate-200 bg-slate-50' },
          activityPanel,
        ),
      ),
    ),
  );

  root.appendChild(overlay);
  root.appendChild(panel);
}

// ===== Atividade & Comentários =====
function renderActivityPanel(t) {
  const wrapper = el('div', { class: 'p-4 space-y-3' },
    el('h3', { class: 'text-sm font-semibold text-slate-700' }, '💬 Atividade & Comentários'),
  );

  // Comment input
  const textarea = el('textarea', {
    class: 'w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500',
    rows: 2,
    placeholder: 'Adicionar comentário…',
  });
  const submitBtn = el('button', {
    type: 'button',
    class: 'bg-slate-900 text-white text-xs px-3 py-1 rounded hover:bg-slate-700 disabled:opacity-50',
  }, 'Comentar');

  const timeline = el('div', { class: 'space-y-2 mt-2' },
    el('div', { class: 'text-xs text-slate-500' }, 'Carregando...'),
  );

  async function reload() {
    try {
      const data = await api.getCardActivity(state.activeProfileId, t.id);
      timeline.innerHTML = '';
      const items = (data.items || []).slice().reverse(); // newest first
      if (!items.length) {
        timeline.appendChild(el('div', { class: 'text-xs text-slate-500 italic' }, 'Nenhuma atividade ainda. Comente acima ou aguarde a próxima sincronização.'));
        return;
      }
      for (const item of items) {
        timeline.appendChild(renderActivityItem(t, item, reload));
      }
    } catch (err) {
      timeline.innerHTML = '';
      timeline.appendChild(el('div', { class: 'text-xs text-red-600' }, 'Erro: ' + err.message));
    }
  }

  submitBtn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) return;
    submitBtn.disabled = true;
    try {
      await api.addComment(state.activeProfileId, t.id, text);
      textarea.value = '';
      await reload();
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      submitBtn.disabled = false;
    }
  };

  wrapper.appendChild(el('div', { class: 'space-y-1' },
    textarea,
    el('div', { class: 'flex justify-end' }, submitBtn),
  ));
  wrapper.appendChild(timeline);

  reload();
  return wrapper;
}

function fmtActivityTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function renderActivityItem(t, item, reload) {
  if (item.kind === 'comment') {
    return el('div', { class: 'bg-white border border-slate-200 rounded p-2 text-sm' },
      el('div', { class: 'flex items-start justify-between gap-2 mb-1' },
        el('span', { class: 'text-xs text-slate-500' }, '💬 ' + fmtActivityTime(item.createdAt)),
        el('div', { class: 'flex gap-2 text-xs' },
          el('button', {
            class: 'text-slate-500 hover:text-slate-800',
            onClick: async () => {
              const next = prompt('Editar comentário:', item.text);
              if (next === null || next.trim() === item.text) return;
              try { await api.editComment(state.activeProfileId, t.id, item.id, next.trim()); await reload(); }
              catch (e) { alert('Erro: ' + e.message); }
            },
          }, 'editar'),
          el('button', {
            class: 'text-red-600 hover:text-red-800',
            onClick: async () => {
              if (!confirm('Excluir comentário?')) return;
              try { await api.deleteComment(state.activeProfileId, t.id, item.id); await reload(); }
              catch (e) { alert('Erro: ' + e.message); }
            },
          }, 'excluir'),
        ),
      ),
      el('div', { class: 'text-sm text-slate-800 whitespace-pre-wrap' }, item.text),
    );
  }
  // System activity
  return el('div', { class: 'flex items-start gap-2 text-xs text-slate-600 px-1' },
    el('span', { class: 'shrink-0 text-slate-400' }, fmtActivityTime(item.createdAt)),
    el('span', { class: 'flex-1' }, item.message),
  );
}

function renderNotesForm(tid, current) {
  const fields = [
    ['flight', 'Voo (cia, número, horários)'],
    ['hotel', 'Hospedagem (nome, reserva, check-in/out)'],
    ['transport', 'Transporte local'],
    ['cost', 'Custos / orçamento'],
    ['general', 'Outras anotações'],
  ];
  const inputs = {};
  const form = el('form', { class: 'space-y-2' });
  for (const [key, label] of fields) {
    const ta = el('textarea', {
      class: 'w-full text-sm border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500',
      rows: 2,
      placeholder: label,
    });
    ta.value = current[key] || '';
    inputs[key] = ta;
    form.appendChild(el('label', { class: 'block' },
      el('span', { class: 'text-xs text-slate-500' }, label),
      ta,
    ));
  }
  const status = el('span', { class: 'text-xs text-slate-500 ml-3' });
  const saveBtn = el('button', {
    type: 'button',
    class: 'mt-2 bg-slate-900 text-white text-sm px-3 py-1.5 rounded hover:bg-slate-700',
    onClick: async () => {
      const body = {};
      for (const [k, ta] of Object.entries(inputs)) body[k] = ta.value;
      saveBtn.disabled = true;
      try {
        await api.updateNotes(state.activeProfileId, tid, body);
        const t = state.data.tournaments.find(x => x.id === tid);
        if (t) t.notes = { ...(t.notes || {}), ...body };
        status.textContent = 'Salvo';
        setTimeout(() => { status.textContent = ''; }, 2000);
      } finally {
        saveBtn.disabled = false;
      }
    },
  }, 'Salvar anotações');
  form.appendChild(el('div', null, saveBtn, status));
  return form;
}

// ===== Profile form =====
function openProfileForm(profile = null) {
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-50', onClick: close });

  const isEdit = !!profile;
  const inputs = {};
  const field = (key, label, type, value, placeholder) => {
    const inp = el('input', {
      type, placeholder: placeholder || '',
      class: 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400',
    });
    inp.value = value || '';
    inputs[key] = inp;
    return el('label', { class: 'block' },
      el('span', { class: 'block text-xs text-slate-600 mb-1 font-medium' }, label),
      inp,
    );
  };

  const errorBox = el('div', { class: 'text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2', style: 'display:none' });
  const showError = (msg) => { errorBox.textContent = msg; errorBox.style.display = 'block'; };

  const submit = async () => {
    errorBox.style.display = 'none';
    const body = {
      tiEmail: inputs.tiEmail.value.trim(),
      tiPassword: inputs.tiPassword.value,
      originAirport: inputs.originAirport.value.trim().toUpperCase() || 'BSB',
      originCity: inputs.originCity.value.trim() || 'Brasília',
    };
    if (isEdit) body.athleteName = profile.athleteName;
    if (!body.tiEmail) { showError('Email do Tênis Integrado é obrigatório'); return; }
    if (!isEdit && !body.tiPassword) { showError('Senha do Tênis Integrado é obrigatória'); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando…';
    try {
      if (isEdit) {
        const patch = { ...body };
        if (!patch.tiPassword) delete patch.tiPassword;
        await api.updateProfile(profile.id, patch);
      } else {
        const created = await api.createProfile(body);
        state.activeProfileId = created.id;
        localStorage.setItem('activeProfileId', created.id);
      }
      state.profiles = await api.listProfiles();
      close();
      state.data = null;
      render();
      await refreshActive();
      render();
    } catch (e) {
      showError(e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? 'Salvar' : 'Adicionar atleta';
    }
  };

  const submitBtn = el('button', {
    class: 'text-sm px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-semibold disabled:opacity-60',
    onClick: submit,
  }, isEdit ? 'Salvar' : 'Adicionar atleta');

  const panel = el('div', { class: 'fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none' },
    el('div', { class: 'pointer-events-auto bg-white text-slate-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[90vh]' },
      el('div', { class: 'shrink-0 bg-[#0e3a4d] text-white px-5 py-3 flex items-center justify-between' },
        el('h3', { class: 'font-medium' }, isEdit ? '✏️ Editar atleta' : '🎾 Adicionar atleta'),
        el('button', { class: 'text-white/70 hover:text-white text-xl leading-none', onClick: close }, '×'),
      ),
      el('div', { class: 'flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3' },
        el('p', { class: 'text-xs text-slate-600' },
          'Vamos buscar os torneios direto no Tênis Integrado. Suas credenciais ficam criptografadas no servidor.',
        ),
        field('tiEmail', 'Email do Tênis Integrado', 'email', profile?.tiEmail, 'voce@email.com'),
        field('tiPassword', isEdit ? 'Nova senha (em branco mantém)' : 'Senha do Tênis Integrado', 'password', '', '••••••••'),
        el('div', { class: 'pt-1' },
          el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2' }, 'Origem do atleta'),
          el('div', { class: 'grid grid-cols-2 gap-2' },
            field('originCity', 'Cidade', 'text', profile?.originCity || 'Brasília', 'Brasília'),
            field('originAirport', 'Aeroporto (IATA)', 'text', profile?.originAirport || 'BSB', 'BSB'),
          ),
          el('p', { class: 'text-[11px] text-slate-500 mt-1' }, 'Usado pra calcular distância e busca de passagens.'),
        ),
        errorBox,
      ),
      el('div', { class: 'shrink-0 px-5 py-3 border-t border-slate-200 flex items-center justify-between bg-slate-50' },
        isEdit
          ? el('button', { class: 'text-sm text-rose-700 hover:underline', onClick: async () => {
              if (!confirm('Excluir este atleta e todos os dados?')) return;
              await api.deleteProfile(profile.id);
              state.profiles = await api.listProfiles();
              if (state.activeProfileId === profile.id) {
                state.activeProfileId = state.profiles[0]?.id || null;
                if (state.activeProfileId) localStorage.setItem('activeProfileId', state.activeProfileId);
                else localStorage.removeItem('activeProfileId');
              }
              close();
              state.data = null;
              render();
              if (state.activeProfileId) { await refreshActive(); render(); }
            } }, 'Excluir atleta')
          : el('span'),
        el('div', { class: 'flex gap-2' },
          el('button', { class: 'text-sm px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-100', onClick: close }, 'Cancelar'),
          submitBtn,
        ),
      ),
    ),
  );

  root.appendChild(overlay);
  root.appendChild(panel);
  setTimeout(() => inputs.tiEmail.focus(), 0);
}


if ('serviceWorker' in navigator) {
  // PWA na home do iPhone fica aberta indefinidamente — sem este check,
  // o app não detecta novas versões (o page lifecycle não recarrega).
  // Solução: quando o app fica visível, força registration.update();
  // se um novo SW assumir (controllerchange), mostra banner pro user
  // decidir quando recarregar.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
    // Check imediato no load (caso a primeira visit ao app já tenha
    // versão nova esperando)
    reg.update().catch(() => {});
    // Polling a cada 5 min — garante que aba aberta sem trocar de foco
    // ainda detecte deploy novo. Custo: ~1KB por request, desprezível.
    setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);
  }).catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Se não havia controller no load inicial, é primeiro registro — não
    // mostra banner. Só notifica quando uma versão substitui outra.
    if (!hadController) return;
    showUpdateBanner();
  });

  // Mensagens vindas do SW — notificação clicada manda 'open-url'.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open-url') {
      if ((e.data.url || '').includes('openAlerts')) {
        if (state.activeProfileId) openAlertsListModal({ onlyUnseen: true });
      }
    }
    if (e.data?.type === 'show-announcement') {
      api.getAnnouncement().then(ann => { if (ann) showAnnouncementBanner(ann); }).catch(() => {});
    }
  });
}

// Se a app foi aberta com ?openAlerts=1 (vindo de uma notificação clicada),
// abre o modal automaticamente após o carregamento dos dados.
function maybeOpenAlertsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('openAlerts') === '1' && state.activeProfileId) {
    setTimeout(() => openAlertsListModal({ onlyUnseen: true }), 400);
    // Limpa o param sem recarregar
    params.delete('openAlerts');
    const q = params.toString();
    history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
  }
}

function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;
  const banner = el('div', {
    id: 'update-banner',
    class: 'fixed inset-x-0 bottom-0 z-[80] bg-cyan-600 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-2xl',
    style: 'padding-bottom: calc(0.75rem + env(safe-area-inset-bottom))',
  },
    el('span', { class: 'text-sm font-medium' }, '🎾 Nova versão disponível'),
    el('div', { class: 'flex gap-2 shrink-0' },
      el('button', {
        class: 'text-sm px-3 py-1.5 rounded bg-white text-cyan-700 font-semibold hover:bg-slate-100',
        onClick: () => window.location.reload(),
      }, 'Atualizar'),
      el('button', {
        class: 'text-white/80 hover:text-white text-xl leading-none px-1',
        onClick: () => banner.remove(),
        title: 'Ignorar',
      }, '×'),
    ),
  );
  document.body.appendChild(banner);
}

function showAnnouncementBanner(ann) {
  if (!ann?.id || !ann?.message) return;
  if (localStorage.getItem(`ann-dismissed-${ann.id}`)) return;
  if (document.getElementById('announcement-banner')) return;
  const dismiss = () => {
    localStorage.setItem(`ann-dismissed-${ann.id}`, '1');
    banner.remove();
    updateAppBadge(0);
  };
  const actions = el('div', { class: 'flex gap-2 shrink-0' });
  if (ann.cta && ann.url) {
    actions.appendChild(el('a', {
      href: ann.url,
      class: 'text-sm px-3 py-1.5 rounded bg-white text-amber-600 font-semibold hover:bg-amber-50',
    }, ann.cta));
  }
  actions.appendChild(el('button', {
    class: 'text-white/80 hover:text-white text-xl leading-none px-1',
    onClick: dismiss,
    title: 'Fechar',
  }, '×'));
  const banner = el('div', {
    id: 'announcement-banner',
    class: 'fixed inset-x-0 bottom-0 z-[79] bg-amber-500 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-2xl',
    style: 'padding-bottom: calc(0.75rem + env(safe-area-inset-bottom))',
  },
    el('div', { class: 'flex flex-col min-w-0' },
      el('span', { class: 'text-sm font-medium' }, ann.message),
      ann.createdAt && el('span', { class: 'text-xs text-white/70 mt-0.5' },
        new Date(ann.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
      ),
    ),
    actions,
  );
  document.body.appendChild(banner);
}

init().catch(err => {
  $('app').innerHTML = `<div class="text-red-600 mt-8">Erro ao carregar: ${err.message}</div>`;
});
