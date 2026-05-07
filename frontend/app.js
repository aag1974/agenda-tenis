// Agenda Tênis Integrado — vanilla JS SPA, no build step

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
    'PRODID:-//AgendaTenis//PT-BR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:agenda-tenis-${Date.now()}-${Math.random().toString(36).slice(2)}@local`,
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
};

const api = {
  async me() { return (await fetch('/api/auth/me')).json(); },
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
  async createInvite(label) {
    const r = await fetch('/api/household/invites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }),
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
  async signup(email, password) {
    const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
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
  async syncStatus(id) { return (await fetch(`/api/profiles/${id}/sync-status`)).json(); },
  async updateNotes(profileId, tid, body) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/notes`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  },
  async flightUrl(profileId, tid) { return (await fetch(`/api/profiles/${profileId}/tournaments/${tid}/flight-url`)).json(); },
  async tournamentDetails(tid) { return (await fetch(`/api/tournament-details/${tid}`)).json(); },
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
  async createShareLink(profileId, tid) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/share`, { method: 'POST' });
    if (!r.ok) throw new Error('Erro ao gerar link');
    return r.json();
  },
};

// ===== Init =====
async function init() {
  // Captura token de convite na URL (compartilhado por WhatsApp/email)
  const urlInviteToken = new URLSearchParams(window.location.search).get('invite');

  const me = await api.me();
  state.user = me.userId ? {
    id: me.userId, email: me.email,
    householdId: me.householdId, members: me.members || [],
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
      submitBtn.disabled = true;
      submitBtn.textContent = mode === 'signup' ? 'Criando…' : 'Entrando…';
      try {
        if (mode === 'signup') await api.signup(email, password);
        else await api.login(email, password);
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

  const renderBody = async () => {
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'text-sm text-slate-600' },
      'Pessoas convidadas enxergam todos os atletas da sua família e podem editar tudo. Mande o link por WhatsApp, email ou SMS.'));

    // Form pra criar novo convite
    const labelInput = el('input', {
      type: 'text', placeholder: 'Apelido (opcional, ex: "Maria")',
      class: 'flex-1 text-sm rounded border border-slate-300 px-2 py-1.5 outline-none focus:border-cyan-400',
    });
    const createBtn = el('button', {
      type: 'button',
      class: 'shrink-0 text-sm rounded bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-3 py-1.5',
      onClick: async () => {
        createBtn.disabled = true; createBtn.textContent = 'Gerando…';
        try {
          await api.createInvite(labelInput.value.trim() || null);
          await renderBody();
        } catch (err) {
          alert('Erro: ' + err.message);
          createBtn.disabled = false; createBtn.textContent = 'Gerar link';
        }
      },
    }, 'Gerar link');
    body.appendChild(el('div', { class: 'flex items-center gap-2' }, labelInput, createBtn));

    // Membros atuais
    const meRes = await api.me();
    state.user.members = meRes.members || [];
    if (state.user.members.length > 1) {
      const isFounder = !!state.user.members.find(m => m.id === state.user.id && m.isFounder);
      body.appendChild(el('div', { class: 'pt-3 border-t border-slate-200' },
        el('h4', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2' }, 'Membros atuais'),
        el('ul', { class: 'space-y-1' },
          ...state.user.members.map(m => el('li', { class: 'flex items-center gap-2 text-sm py-1' },
            el('span', { class: 'w-7 h-7 rounded-full bg-cyan-600 text-white text-[10px] font-semibold flex items-center justify-center shrink-0' }, userInitials(m.email || m.name)),
            el('span', { class: 'truncate flex-1' }, m.email || m.name || 'membro'),
            m.id === state.user.id && el('span', { class: 'text-xs text-slate-400' }, 'você'),
            m.isFounder && m.id !== state.user.id && el('span', { class: 'text-xs text-slate-400' }, 'dono'),
            isFounder && !m.isFounder && el('button', {
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
          )),
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
            return el('li', null,
              inv.label && el('div', { class: 'text-xs text-slate-600 mb-1' }, inv.label),
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
    if (typeof s.unseenAlerts === 'number') state.unseenAlertsCount = s.unseenAlerts;
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
    root.appendChild(el('div', { class: 'mt-8 text-center text-slate-500' }, 'Carregando...'));
    return;
  }

  const tournaments = state.data.tournaments || [];

  if (tournaments.length === 0) {
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

function isRegistrationClosed(t, inscribed) {
  // Already inscribed → not "missed it"
  if (inscribed) return false;
  // TI explicit signal in catalog row
  if (/encerrad/i.test(t.registrationStatus || '')) return true;
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

function applyHeaderFilters(tournaments) {
  const f = state;
  const q = (f.searchQuery || '').trim().toLowerCase();
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
      const haystack = [
        t.name, t.city, t.state,
        ...(t.tiers || []), t.tier,
        ...(t.labels || []).map(L => L.name),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!terms.every(term => haystack.includes(term))) return false;
    }
    return true;
  });
}

// ===== Kanban =====
const KANBAN_COLUMNS = [
  { id: 'torneios',            label: 'Inscrições Encerradas', icon: '🔒' },
  { id: 'inscricoes_abertas', label: 'Inscrições Abertas',   icon: '🌟' },
  { id: 'vou_jogar',           label: 'No radar',            icon: '⭐' },
  { id: 'pagar_inscricao',     label: 'Pagar inscrição',     icon: '💰' },
  { id: 'confirmado',          label: 'Confirmado',          icon: '✅' },
  { id: 'viagem_comprada',     label: 'Viagem comprada',     icon: '✈️' },
  { id: 'historico',           label: 'Encerrados',          icon: '🎾' },
];
const KANBAN_COLUMN_IDS = KANBAN_COLUMNS.map(c => c.id);

function orderedKanbanColumns() {
  const order = state.columnOrder;
  if (!Array.isArray(order) || !order.length) return KANBAN_COLUMNS;
  const ordered = order.map(id => KANBAN_COLUMNS.find(c => c.id === id)).filter(Boolean);
  const remaining = KANBAN_COLUMNS.filter(c => !order.includes(c.id));
  return [...ordered, ...remaining];
}

function autoColumnFor(t) {
  const status = t.derivedStatus || 'unknown';
  if (status === 'past') return 'historico';
  const givenUp = !!t.notes?.manualGiveUp;
  const pp = givenUp ? null : t.pendingPayment;
  const inscribed = givenUp ? false : (t.isAnnaInscribed || t.notes?.manualInscribed);
  if (pp) return 'pagar_inscricao';
  if (inscribed) return 'confirmado';
  if (/Aberto|aberta/i.test(t.registrationStatus || '')) return 'inscricoes_abertas';
  return 'torneios';
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

  // Resolve a ordem das colunas conforme preferência do usuário
  const orderedColumns = state.columnOrder
    ? [
        ...state.columnOrder.map(id => KANBAN_COLUMNS.find(c => c.id === id)).filter(Boolean),
        ...KANBAN_COLUMNS.filter(c => !state.columnOrder.includes(c.id)),
      ]
    : KANBAN_COLUMNS;

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

function buildShareText(t, shareUrl) {
  // Mensagem propositalmente sem emojis no corpo — alguns dispositivos
  // renderizam como "?" e prejudicam a leitura. WhatsApp gera o preview
  // bonito a partir das og:tags da página /share, então o texto pode ser
  // simples e direto.
  const tiers = (t.tiers && t.tiers.length) ? t.tiers : (t.tier ? [t.tier] : []);
  const where = [t.city, t.state].filter(Boolean).join(' / ');
  const dates = t.startDate
    ? (t.endDate && t.endDate !== t.startDate ? `${t.startDate} a ${t.endDate}` : t.startDate)
    : null;
  const meta = [dates, tiers.join(' · ')].filter(Boolean).join(' · ');
  const regStatus = t.registrationStatus || '';
  const regDate = regStatus.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || null;
  const regOpen = /Aberto|aberta/i.test(regStatus);
  const regLine = regDate
    ? (regOpen ? `Inscrições até ${regDate}` : `Inscrições encerraram em ${regDate}`)
    : (regStatus || null);
  const lines = [];
  lines.push(`*${t.name || 'Torneio'}*`);
  if (where) lines.push(where);
  if (meta) lines.push(meta);
  if (regLine) lines.push(regLine);
  lines.push('');
  if (shareUrl) {
    lines.push(`Abrir torneio: ${shareUrl}`);
  } else if (t.url) {
    lines.push(`Abrir torneio: ${t.url}`);
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
  const text = buildShareText(t, shareUrl);
  const shareData = {
    title: `${t.name || 'Torneio'} — Tennis Flow`,
    text,
    ...(shareUrl ? { url: shareUrl } : {}),
  };
  // Web Share API quando disponível (iPhone, Android) → sheet nativo
  if (navigator.share) {
    try { await navigator.share(shareData); return; }
    catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  // Fallback: WhatsApp Web/desktop
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

    el('h3', { class: 'text-sm font-medium leading-snug mb-0.5 line-clamp-2 pr-12' }, t.name || '(sem nome)'),

    el('div', { class: 'text-xs text-slate-600 flex items-center justify-between gap-2' },
      el('span', { class: 'truncate' }, cityState || '—'),
      el('span', { class: 'shrink-0 text-slate-500' }, formatCardDate(t)),
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
    el('h3', { class: 'text-sm font-semibold' }, '🏷️ Etiquetas'),
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
      el('h4', { class: 'text-sm font-semibold' }, isEdit ? 'Editar etiqueta' : 'Nova etiqueta'),
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
  // Em mobile (telas <640px) o drag-drop do touchscreen briga com o
  // scroll/swipe natural. Pula o wiring inteiro — usuário move card
  // via dropdown "Mudar coluna" no header do modal e reorganiza colunas
  // via desktop. Detecção é dinâmica (atualiza em resize).
  if (window.matchMedia('(max-width: 640px)').matches) return;

  // SortableJS pra cards (drag entre colunas)
  const lists = container.querySelectorAll('.kanban-list');
  for (const list of lists) {
    Sortable.create(list, {
      group: 'kanban',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      // Touch: segurar 300ms imóvel pra iniciar drag. Qualquer movimento
       // dentro do delay cancela e libera scroll/swipe nativos.
      delay: 300,
      delayOnTouchOnly: true,
      touchStartThreshold: 0,
      onEnd: async (evt) => {
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
  const colRow = container.querySelector('#kanban-col-row');
  if (colRow) {
    Sortable.create(colRow, {
      group: 'kanban-cols',
      animation: 150,
      handle: '.kanban-col-header',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      draggable: '.kanban-col',
      delay: 300,
      delayOnTouchOnly: true,
      touchStartThreshold: 0,
      onEnd: async () => {
        const ids = [...colRow.querySelectorAll('.kanban-col')].map(c => c.dataset.columnId).filter(Boolean);
        state.columnOrder = ids;
        try { await api.updateBoardConfig({ columnOrder: ids }); }
        catch (err) { alert('Erro ao salvar ordem: ' + err.message); }
      },
    });
  }
}


function renderHeader() {
  const old = $('header-bar');
  if (old) old.replaceWith(renderHeaderEl());
}

function userInitials(emailOrName) {
  if (!emailOrName) return '?';
  const s = emailOrName.trim();
  // If it's an email, take the first 2 letters before @
  const local = s.includes('@') ? s.split('@')[0] : s;
  // Split on common separators and take initials
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

  const initials = userInitials(state.user?.email || state.user?.name || profile?.athleteName);
  const avatarButton = state.user && el('button', {
    id: 'avatar-button',
    class: 'w-9 h-9 rounded-full bg-cyan-600 text-white text-xs font-semibold flex items-center justify-center hover:bg-cyan-700 shrink-0',
    title: state.user.email || 'Conta',
    onClick: (e) => { e.stopPropagation(); toggleGearMenu(); },
  }, initials);

  // Bolinhas dos membros + botão "+" — só desktop (mobile usa item do menu)
  const otherMembers = (state.user?.members || []).filter(m => m.id !== state.user?.id);
  const memberStack = state.user && el('div', { class: 'hidden md:flex items-center -space-x-2 shrink-0' },
    ...otherMembers.slice(0, 4).map(m => el('button', {
      class: 'w-8 h-8 rounded-full bg-emerald-600 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-[#0e3a4d] hover:bg-emerald-500',
      title: m.email,
      onClick: (e) => { e.stopPropagation(); openInviteModal(); },
    }, userInitials(m.email || m.name))),
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

  // Busca livre — vive no header e filtra por nome/cidade/UF/etiqueta/chave
  const searchInput = profile && el('input', {
    id: 'header-search',
    type: 'search',
    placeholder: 'Buscar…',
    value: state.searchQuery || '',
    class: 'w-full text-sm bg-white/10 hover:bg-white/15 focus:bg-white/20 text-white placeholder-white/50 border border-white/20 rounded px-3 py-1.5 outline-none focus:border-cyan-300',
  });
  if (searchInput) {
    searchInput.oninput = (e) => {
      state.searchQuery = e.target.value;
      rerenderBody();
      const live = $('header-search');
      if (live && document.activeElement !== live) live.focus();
    };
  }

  return el('header', { id: 'header-bar', class: 'flex items-center gap-2 sm:gap-3 pb-2 border-b border-slate-200 relative' },
    logo,
    profile && el('div', { class: 'flex-1 min-w-0 max-w-md mx-auto' }, searchInput),
    el('div', { class: 'flex items-center gap-1 sm:gap-2 shrink-0' },
      memberStack,
      profile && renderAlertsBell(),
      profile && renderSyncIndicator(),
      avatarButton,
    ),
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

  if (!ss || ss.state === 'running') {
    dot.className = 'inline-block w-3 h-3 rounded-full bg-amber-400 animate-pulse';
    const startedAt = ss?.startedAt ? new Date(ss.startedAt).getTime() : Date.now();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    body.appendChild(el('div', { class: 'flex items-center gap-3 mb-3' },
      el('div', { class: 'w-8 h-8 rounded-full border-4 border-slate-200 border-t-[#00a3e0] animate-spin' }),
      el('div', null,
        el('div', { class: 'font-semibold' }, 'Sincronizando…'),
        el('div', { class: 'text-xs text-slate-500' }, `Decorrido: ${elapsedSec}s · costuma levar ~30s`),
      ),
    ));
    body.appendChild(el('p', { class: 'text-sm text-slate-600' },
      'Buscando torneios, inscrições e boletos no Tênis Integrado. Pode deixar essa janela aberta — vou mostrar aqui o que mudou quando terminar.'));
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
    footer.appendChild(el('button', {
      type: 'button',
      class: 'px-3 py-1.5 text-sm rounded bg-[#00a3e0] hover:bg-[#0090c7] text-white font-medium',
      onClick: () => { close(); syncNow(); },
    }, 'Tentar de novo'));
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
    const evList = el('div', { class: 'space-y-1 mb-3' },
      evLine('💰', ec.boleto_detected || 0, 'boletos novos detectados'),
      evLine('✅', ec.boleto_cleared || 0, 'pagamentos confirmados'),
      evLine('✓',  ec.inscribed || 0,      'inscrições confirmadas no TI'),
      evLine('↩︎', ec.uninscribed || 0,    'inscrições removidas no TI'),
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
      !runningOnly && el('button', {
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
    style: 'max-height: 85vh;',
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
    const events = await api.listAlerts(state.activeProfileId, { unseen: onlyUnseen });

    if (events.length === 0) {
      body.appendChild(el('div', { class: 'text-sm text-slate-500 italic py-6 text-center' },
        onlyUnseen ? 'Nenhum alerta novo.' : 'Nenhum alerta ainda. Configure regras em Criar alertas.'));
    } else {
      const list = el('ul', { class: 'space-y-2' });
      for (const e of events) {
        const tournament = state.data?.tournaments?.find(t => t.id === e.tournamentId);
        list.appendChild(el('li', { class: `border rounded-lg p-3 ${e.seen ? 'bg-slate-50 border-slate-200' : 'bg-white border-amber-300'}` },
          el('div', { class: 'flex items-start justify-between gap-2' },
            el('div', { class: 'flex-1 min-w-0' },
              el('div', { class: `text-sm ${e.seen ? 'text-slate-600' : 'font-medium'}` }, e.message),
              el('div', { class: 'text-xs text-slate-500 mt-0.5' }, new Date(e.createdAt).toLocaleString('pt-BR')),
            ),
            !e.seen && el('button', {
              class: 'text-xs px-2 py-1 rounded text-slate-500 hover:bg-slate-100 shrink-0',
              onClick: async () => {
                await api.markAlertsSeen(state.activeProfileId, [e.id]);
                state.unseenAlertsCount = Math.max(0, (state.unseenAlertsCount || 0) - 1);
                renderHeader();
                reload();
              },
            }, 'Vi'),
            tournament && el('button', {
              class: 'text-xs px-2 py-1 rounded text-cyan-700 hover:bg-cyan-50 shrink-0',
              onClick: () => { close(); openTournament(tournament.id); },
            }, 'Ver'),
          ),
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
          renderHeader();
          close();
        },
      }, 'Marcar todos como vistos'));
    }
  };

  reload();
}

function toggleGearMenu() {
  const existing = $('gear-menu');
  if (existing) { existing.remove(); return; }
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  const tournaments = state.data?.tournaments || [];
  const ufs = [...new Set(tournaments.map(t => t.state).filter(Boolean))].sort();
  const tiersInData = new Set();
  for (const t of tournaments) {
    for (const tier of (t.tiers && t.tiers.length ? t.tiers : (t.tier ? [t.tier] : []))) tiersInData.add(tier);
  }
  const tierOptions = TIER_ORDER.filter(x => tiersInData.has(x));
  const yearOptions = [...new Set(tournaments.map(t => startYearOf(t)).filter(Boolean))].sort();

  const pillRow = (label, options, isSelected, onTogglePill, onClearAll) => {
    const allActive = !options.some(isSelected);
    const pill = (text, active, onClick) => el('button', {
      class: `text-xs px-2.5 py-1 rounded-full border ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`,
      onClick: (e) => { e.preventDefault(); onClick(); },
    }, text);
    return el('div', { class: 'px-3 py-2' },
      el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5' }, label),
      el('div', { class: 'flex flex-wrap gap-1.5' },
        pill('Todos', allActive, onClearAll),
        ...options.map(v => pill(v, isSelected(v), () => onTogglePill(v))),
      ),
    );
  };

  const yearPillRow = yearOptions.length > 1 && pillRow(
    'Ano',
    yearOptions.map(String),
    (y) => state.filterYears.includes(Number(y)),
    (y) => {
      const yn = Number(y);
      const idx = state.filterYears.indexOf(yn);
      if (idx >= 0) state.filterYears.splice(idx, 1);
      else state.filterYears.push(yn);
      localStorage.setItem('filterYears', JSON.stringify(state.filterYears));
      rerenderBody();
      const oldMenu = $('gear-menu');
      if (oldMenu) { oldMenu.remove(); toggleGearMenu(); }
    },
    () => {
      state.filterYears = [];
      localStorage.setItem('filterYears', '[]');
      rerenderBody();
      const oldMenu = $('gear-menu');
      if (oldMenu) { oldMenu.remove(); toggleGearMenu(); }
    },
  );

  const tierPillRow = pillRow(
    'Chave',
    tierOptions,
    (t) => state.filterTiers.includes(t),
    (t) => {
      const idx = state.filterTiers.indexOf(t);
      if (idx >= 0) state.filterTiers.splice(idx, 1);
      else state.filterTiers.push(t);
      localStorage.setItem('filterTiers', JSON.stringify(state.filterTiers));
      rerenderBody();
      const oldMenu = $('gear-menu');
      if (oldMenu) { oldMenu.remove(); toggleGearMenu(); }
    },
    () => {
      state.filterTiers = [];
      localStorage.setItem('filterTiers', '[]');
      rerenderBody();
      const oldMenu = $('gear-menu');
      if (oldMenu) { oldMenu.remove(); toggleGearMenu(); }
    },
  );

  // Cabeçalho do menu (estilo Trello): avatar + nome + email
  const initials = userInitials(state.user?.email || state.user?.name || profile?.athleteName);
  const displayName = state.user?.name && state.user.name !== state.user.email ? state.user.name : null;
  const userHeader = state.user && el('div', { class: 'px-3 py-3 border-b border-slate-200 flex items-center gap-3 bg-slate-50' },
    el('span', { class: 'w-10 h-10 rounded-full bg-cyan-600 text-white text-sm font-semibold flex items-center justify-center shrink-0' }, initials),
    el('div', { class: 'min-w-0 flex-1' },
      displayName && el('div', { class: 'text-sm font-medium text-slate-800 truncate' }, displayName),
      el('div', { class: `${displayName ? 'text-xs text-slate-500' : 'text-sm text-slate-700'} truncate` }, state.user.email || 'Conta'),
    ),
  );

  // Bloco do atleta — clique abre submenu pra trocar/adicionar
  const reopen = () => { const m = $('gear-menu'); if (m) { m.remove(); toggleGearMenu(); } };
  const athleteHeader = profile && el('div', { class: 'px-3 py-2.5 border-b border-slate-200' },
    el('div', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1' }, 'Atleta'),
    el('button', {
      class: 'w-full flex items-center justify-between gap-2 text-left rounded px-2 py-1.5 hover:bg-slate-100',
      onClick: () => { state.athleteSwitcherOpen = !state.athleteSwitcherOpen; reopen(); },
    },
      el('span', { class: 'text-xs font-normal uppercase tracking-wide text-slate-900 truncate' }, profile.athleteName || profile.tiEmail || 'Atleta'),
      el('span', { class: 'text-xs text-slate-400 shrink-0' }, state.athleteSwitcherOpen ? '▴' : '▾'),
    ),
    state.athleteSwitcherOpen && el('div', { class: 'mt-1 space-y-0.5' },
      ...state.profiles.map(p => el('button', {
        class: `w-full text-left text-sm px-2 py-1.5 rounded flex items-center gap-2 ${p.id === state.activeProfileId ? 'bg-cyan-50 text-cyan-900' : 'hover:bg-slate-100 text-slate-700'}`,
        onClick: () => {
          state.athleteSwitcherOpen = false;
          const m = $('gear-menu'); if (m) m.remove();
          switchProfile(p.id);
        },
      },
        el('span', { class: 'shrink-0 w-4 text-center' }, p.id === state.activeProfileId ? '✓' : ''),
        el('span', { class: 'truncate' }, p.athleteName || p.tiEmail || 'Atleta'),
      )),
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
    { label: `Sobre ${athleteFirstName}`, onClick: () => openAthleteCard() },
    { label: `TI de ${athleteFirstName}`, onClick: () => openProfileForm(profile) },
  ] : [];
  // Mobile: "Convidar membro" no menu. Desktop: "+" no header (memberStack)
  const isMobile = window.matchMedia('(max-width: 640px)').matches;
  const accountActions = state.user ? [
    isMobile && { label: 'Convidar membro', onClick: () => openInviteModal() },
    profile && { label: 'Criar alertas', onClick: () => openAlertRulesModal() },
    profile && { label: 'Conectar agenda', onClick: () => openCalendarSetup() },
    { label: 'Manual', onClick: () => window.open('/manual', '_blank') },
    { label: 'Sair', onClick: () => logout() },
  ].filter(Boolean) : [];

  const menu = el('div', {
    id: 'gear-menu',
    // bg-white inline style pra não sofrer override do tema kanban-dark
    style: 'background:#fff; color:#0f172a;',
    class: 'fixed z-50 border border-slate-200 rounded-lg shadow-xl py-1 w-72 max-w-[calc(100vw-1rem)] overflow-hidden',
    onClick: (e) => e.stopPropagation(),
  },
    userHeader,
    athleteHeader,
    athleteActions.length > 0 && el('div', { class: 'py-1' },
      ...athleteActions.map(it => el('button', {
        class: 'block w-full text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#1f5b75] hover:bg-slate-100',
        onClick: () => { menu.remove(); it.onClick(); },
      }, it.label)),
    ),
    profile && el('div', { class: 'border-t border-slate-200' }),
    profile && pillRow(
      'UF',
      ufs,
      (uf) => state.filterUFs.includes(uf),
      (uf) => {
        const idx = state.filterUFs.indexOf(uf);
        if (idx >= 0) state.filterUFs.splice(idx, 1);
        else state.filterUFs.push(uf);
        localStorage.setItem('filterUFs', JSON.stringify(state.filterUFs));
        rerenderBody();
        // re-render the menu to update the pill colors
        const oldMenu = $('gear-menu');
        if (oldMenu) { oldMenu.remove(); toggleGearMenu(); }
      },
      () => {
        state.filterUFs = [];
        localStorage.setItem('filterUFs', '[]');
        rerenderBody();
        const oldMenu = $('gear-menu');
        if (oldMenu) { oldMenu.remove(); toggleGearMenu(); }
      },
    ),
    profile && yearPillRow,
    profile && tierPillRow,
    accountActions.length > 0 && el('div', { class: 'border-t border-slate-200 py-1' },
      ...accountActions.map(it => el('button', {
        class: 'block w-full text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#1f5b75] hover:bg-slate-100',
        onClick: () => { menu.remove(); it.onClick(); },
      }, it.label)),
    ),
  );

  // Anexa ao body (fora do #header-bar pra escapar dos overrides do tema kanban)
  document.body.appendChild(menu);

  // Posiciona logo abaixo do botão avatar, alinhado à direita
  const anchor = $('avatar-button');
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  }

  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target) && e.target.id !== 'avatar-button') { menu.remove(); document.removeEventListener('click', close); }
    });
  }, 0);
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

  const inscribedThisYear = tournaments.filter(t => {
    const d = brToDate(t.startDate);
    return (t.isAnnaInscribed || t.notes?.manualInscribed) && d && d.getFullYear() === today.getFullYear();
  }).length;
  const pendingPayments = tournaments.filter(t => t.pendingPayment);
  const totalPending = pendingPayments.reduce((sum, t) => sum + parseBrCurrency(t.pendingPayment?.value), 0);

  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };

  const name = athlete.name || profile.athleteName || 'Atleta';
  const initials = userInitials(name);
  const rankCBT = athlete.rankingNational;
  const rankDF = athlete.rankingDF;
  const wtn = athlete.wtn;
  const cutoff = rankDF?.cutoffDate;

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

  const statsGrid = el('div', { class: 'grid grid-cols-2 gap-2' },
    tile('Inscrito em ' + today.getFullYear(), String(inscribedThisYear), inscribedThisYear === 1 ? 'torneio' : 'torneios', 'cyan'),
    tile('Boletos pendentes',
      String(pendingPayments.length),
      pendingPayments.length
        ? `R$ ${totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : 'tudo em dia',
      pendingPayments.length ? 'amber' : 'emerald',
    ),
  );

  const rankingTiles = (rankCBT || rankDF?.dfPosition || wtn) && el('div', null,
    sectionHeader(cutoff ? `Rankings · recorte ${cutoff}` : 'Rankings'),
    el('div', { class: 'grid grid-cols-2 gap-2' },
      rankCBT && tile(
        `CBT ${rankCBT.year} ${rankCBT.category}`,
        `${rankCBT.position}º`,
        `${rankCBT.points} pts`,
        'slate',
      ),
      rankDF?.dfPosition && tile('Recorte DF', `${rankDF.dfPosition}º`, 'no recorte do nacional', 'slate'),
      wtn && tile('WTN simples', wtn.single, 'world tennis number', 'slate'),
      wtn && tile('WTN duplas', wtn.double, 'world tennis number', 'slate'),
    ),
  );

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
            athlete.about && el('div', { class: 'text-xs text-white/70 truncate mt-0.5' }, athlete.about),
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
      statsGrid,
      rankingTiles,
      calendarBlock,
      noTournaments,
    ),
  );
  root.appendChild(overlay);
  root.appendChild(card);
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

async function syncNow() {
  if (!state.activeProfileId) return;
  state.syncStatus = { state: 'running', startedAt: new Date().toISOString() };
  renderHeader();
  openSyncProgressModal();
  try { await api.sync(state.activeProfileId); } catch {}
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
    el('p', { class: 'text-slate-600 mb-4' }, 'Ainda não há torneios carregados. Toque em ⚙︎ → Sincronizar agora pra puxar a lista do Tênis Integrado.'),
    el('p', { class: 'text-xs text-slate-500' }, 'A sincronização leva ~30 segundos.'),
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
  const fileGallery = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  fileCamera.onchange = (e) => handleUpload(e.target.files?.[0]);
  fileGallery.onchange = (e) => handleUpload(e.target.files?.[0]);

  async function handleUpload(file) {
    if (!file) return;
    const category = await pickCategory();
    if (!category) return;
    const status = el('div', { class: 'text-xs text-slate-500 mt-1' }, '🔄 Comprimindo...');
    container.appendChild(status);
    try {
      const blob = await compressImage(file);
      status.textContent = '⬆ Enviando...';
      const dataUrl = await blobToDataUrl(blob);
      await api.uploadReceipt(profileId, t.id, { category, dataUrl, originalName: file.name });
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
      grid.appendChild(el('button', {
        class: 'relative group aspect-square overflow-hidden rounded border border-slate-200 hover:border-emerald-400',
        onClick: () => openReceiptViewer(t, r, items),
      },
        el('img', { src: r.viewUrl, alt: '', class: 'w-full h-full object-cover', loading: 'lazy' }),
        el('div', { class: 'absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate' }, meta.icon + ' ' + meta.label.slice(0, 3)),
      ));
    }
    container.appendChild(el('div', { class: 'space-y-1' },
      el('div', { class: 'text-xs font-medium text-slate-700' }, `${meta.icon} ${meta.label} (${items.length})`),
      grid,
    ));
  }
}

function pickCategory() {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const overlay = el('div', { class: 'fixed inset-0 bg-black/50 z-[60]' });
    const panel = el('div', { class: 'fixed inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center z-[61] p-4' },
      el('div', { class: 'bg-white rounded-lg shadow-xl w-full max-w-sm sm:mx-auto p-4' },
        el('h3', { class: 'text-base font-semibold mb-3' }, 'Categoria do comprovante'),
        el('div', { class: 'grid grid-cols-1 gap-2' },
          ...RECEIPT_CATEGORY_ORDER.map(cat => {
            const m = RECEIPT_CATEGORY_META[cat];
            return el('button', {
              class: 'w-full text-left bg-white border border-slate-300 hover:bg-slate-50 px-4 py-3 rounded text-sm flex items-center gap-3',
              onClick: () => { cleanup(); resolve(cat); },
            }, el('span', { class: 'text-xl' }, m.icon), el('span', null, m.label));
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
  const img = el('img', { class: 'flex-1 min-h-0 max-w-full max-h-full object-contain' });
  const meta = el('div', { class: 'text-white text-sm px-4 py-2 flex items-center justify-between gap-3' });

  function show() {
    const r = all[idx];
    img.src = r.viewUrl;
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

  overlay.append(meta, img);
  // Tap left/right halves to navigate
  img.onclick = (e) => {
    const rect = img.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 2 && idx > 0) { idx--; show(); }
    else if (x >= rect.width / 2 && idx < all.length - 1) { idx++; show(); }
  };
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
  t.notes = { ...(t.notes || {}), selected: newVal };
  render();
  try {
    await api.updateNotes(state.activeProfileId, t.id, { selected: newVal });
  } catch (err) {
    t.notes.selected = !newVal;
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
  const [details, flightInfo] = await Promise.all([
    isFuture ? api.tournamentDetails(tid).catch(() => null) : Promise.resolve(null),
    showTravelTools ? api.flightUrl(state.activeProfileId, tid).catch(() => ({ error: true })) : Promise.resolve(null),
  ]);
  const merged = details ? { ...t, hotels: details.hotels || t.hotels || [], venues: details.venues || t.venues || [], observations: details.observations || t.observations, cancelDeadline: details.cancelDeadline || t.cancelDeadline, prices: details.prices || t.prices } : t;

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
    t.notes = { ...(t.notes || {}), selected: newVal };
    updateStar();
    try {
      await api.updateNotes(state.activeProfileId, t.id, { selected: newVal });
      render();
    } catch (err) {
      t.notes.selected = !newVal;
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

      // Aviso prominente quando o torneio foi "perdido"
      isLost && el('section', { class: 'rounded-lg bg-slate-100 border border-slate-300 p-3' },
        el('div', { class: 'text-sm font-medium text-slate-700' },
          boletoExpired ? '❌ Boleto vencido — inscrição perdida' : '🔒 Inscrições encerradas',
        ),
        el('div', { class: 'text-xs text-slate-600 mt-1' },
          boletoExpired
            ? 'O prazo de pagamento passou. Você não pode mais participar deste torneio.'
            : 'O TI não aceita mais novas inscrições neste torneio.',
        ),
      ),

      t.pendingPayment && el('section', { class: 'rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 flex items-center justify-between gap-3' },
        el('div', { class: 'min-w-0' },
          el('div', { class: 'text-sm font-medium text-amber-900' }, `💰 Vence ${t.pendingPayment.dueDate || '?'} · ${fmtValueNoCents(t.pendingPayment.value)}`),
          t.pendingPayment.category && el('div', { class: 'text-xs text-amber-800 mt-0.5 truncate' }, t.pendingPayment.category),
        ),
      ),

      (() => {
        // Extrai data de encerramento/abertura do registrationStatus do TI
        // (ex: "Aberto até 19/05/2026", "Encerrada em 14/05/2026")
        const regStatus = t.registrationStatus || '';
        const regDate = regStatus.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || null;
        const isOpen = /Aberto|aberta/i.test(regStatus);
        let regLine = null;
        if (regDate) {
          regLine = isOpen ? `Inscrições abertas até ${regDate}` : `Inscrições encerraram em ${regDate}`;
        } else if (regStatus) {
          regLine = `Inscrições: ${regStatus}`;
        }
        return el('section', null,
          el('h3', { class: 'text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2' }, 'Datas'),
          el('p', { class: 'text-sm' }, `${t.startDate || '—'} a ${t.endDate || '—'}`),
          regLine && el('p', { class: 'text-xs text-slate-500 mt-0.5' }, regLine),
          merged.cancelDeadline && el('p', { class: 'text-xs text-slate-500 mt-0.5' }, `Cancelamento até ${merged.cancelDeadline}`),
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

  const panel = el('div', { class: 'fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 pointer-events-none' },
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
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init().catch(err => {
  $('app').innerHTML = `<div class="text-red-600 mt-8">Erro ao carregar: ${err.message}</div>`;
});
