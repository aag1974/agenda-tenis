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
  const [d, m, y] = s.split('/');
  return `${y}-${m}-${d}`;
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

const DEFAULT_OPEN_SECTIONS = ['urgent', 'thisWeek', 'thisMonth'];
const TIER_ORDER = ['GA+', 'GA', 'G1+', 'G1', 'G2', 'G3'];
const state = {
  user: null,
  hasUsers: false,
  profiles: [],
  activeProfileId: localStorage.getItem('activeProfileId') || null,
  data: null,
  syncStatus: null,
  openSections: new Set(JSON.parse(localStorage.getItem('openSections') || 'null') || DEFAULT_OPEN_SECTIONS),
  filterUFs: (() => {
    const raw = localStorage.getItem('filterUFs');
    try { const v = JSON.parse(raw); if (Array.isArray(v)) return v; } catch {}
    // migrate old single-value localStorage 'filterUF'
    const old = localStorage.getItem('filterUF');
    if (old && old !== 'all') return [old];
    return [];
  })(),
  filterTier: localStorage.getItem('filterTier') || 'all',
};

const api = {
  async me() { return (await fetch('/api/auth/me')).json(); },
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
  async moveCard(profileId, tid, column, order) {
    const r = await fetch(`/api/profiles/${profileId}/tournaments/${tid}/column`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, order }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
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
};

// ===== Init =====
async function init() {
  const me = await api.me();
  state.user = me.userId ? { id: me.userId, email: me.email } : null;
  state.hasUsers = !!me.hasUsers;

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
  await refreshActive();
  render();
  pollSyncStatus();
}

function renderAuth() {
  const root = $('app');
  root.innerHTML = '';

  const isFirstUser = !state.hasUsers;
  let mode = isFirstUser ? 'signup' : 'login';

  const draw = () => {
    root.innerHTML = '';
    const inputs = {};
    const field = (key, label, type, placeholder) => {
      const inp = el('input', { type, placeholder, class: 'w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500' });
      inputs[key] = inp;
      return el('label', { class: 'block' },
        el('span', { class: 'block text-xs text-slate-500 mb-1' }, label),
        inp,
      );
    };
    const errorBox = el('div', { class: 'text-sm text-red-600' });

    const submit = async () => {
      errorBox.textContent = '';
      const email = inputs.email.value.trim();
      const password = inputs.password.value;
      if (!email || !password) { errorBox.textContent = 'Email e senha são obrigatórios'; return; }
      try {
        if (mode === 'signup') await api.signup(email, password);
        else await api.login(email, password);
        await init();
      } catch (e) { errorBox.textContent = e.message; }
    };

    root.appendChild(el('div', { class: 'max-w-md mx-auto mt-12' },
      el('div', { class: 'flex items-center gap-3 mb-6' },
        el('span', { class: 'text-3xl' }, '🎾'),
        el('h1', { class: 'text-2xl font-semibold' }, 'Agenda Tênis Integrado'),
      ),

      el('div', { class: 'bg-white rounded-lg border border-slate-200 p-6 space-y-4' },
        el('h2', { class: 'text-lg font-semibold' }, mode === 'signup' ? 'Criar conta' : 'Entrar'),

        isFirstUser && mode === 'signup' && el('p', { class: 'text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2' },
          'Primeira instalação detectada. Esta conta será associada a perfis existentes.'
        ),

        field('email', 'Email', 'email', 'voce@email.com'),
        field('password', mode === 'signup' ? 'Senha (mínimo 6 caracteres)' : 'Senha', 'password', '••••••••'),

        errorBox,

        el('button', {
          class: 'w-full rounded bg-emerald-600 text-white text-sm px-4 py-2 hover:bg-emerald-700',
          onClick: submit,
        }, mode === 'signup' ? 'Criar conta' : 'Entrar'),

        !isFirstUser && el('div', { class: 'text-center text-sm text-slate-500' },
          mode === 'signup' ? 'Já tem conta? ' : 'Não tem conta? ',
          el('button', {
            class: 'text-emerald-700 hover:underline',
            onClick: () => { mode = mode === 'signup' ? 'login' : 'signup'; draw(); },
          }, mode === 'signup' ? 'Entrar' : 'Criar conta'),
        ),
      ),

      el('p', { class: 'mt-4 text-xs text-slate-500 text-center' },
        'Senhas armazenadas com criptografia. Suas credenciais do Tênis Integrado ficam isoladas por usuário.'
      ),
    ));
  };
  draw();
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
}

let pollTimer = null;
async function pollSyncStatus() {
  if (pollTimer) clearTimeout(pollTimer);
  if (!state.activeProfileId) return;
  try {
    const s = await api.syncStatus(state.activeProfileId);
    const wasRunning = state.syncStatus?.state === 'running';
    state.syncStatus = s;
    if (wasRunning && s.state !== 'running') {
      await refreshActive();
      render();
    } else {
      renderHeader();
    }
  } catch {}
  pollTimer = setTimeout(pollSyncStatus, state.syncStatus?.state === 'running' ? 2000 : 30000);
}

// ===== Render =====
function render() {
  const root = $('app');
  root.innerHTML = '';
  // Reset kanban mode — renderKanban re-adds it when needed.
  document.body.classList.remove('kanban-mode');
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

function categorizeForTimeline(t) {
  const start = brToDate(t.startDate);
  const end = brToDate(t.endDate) || start;
  const today = startOfToday();
  const inOneWeek = new Date(today.getTime() + 7 * DAY);
  const monthEnd = endOfMonth();

  // Urgent: pending payment due in <=7 days (and tournament not yet ended)
  const pp = t.pendingPayment;
  if (pp?.dueDate) {
    const due = brToDate(pp.dueDate);
    if (due && due >= today && due <= inOneWeek && (!end || end >= today)) return 'urgent';
  }

  if (!start) return 'upcoming';
  if (end < today) return 'past';
  if (start <= inOneWeek) return 'thisWeek';
  if (start <= monthEnd) return 'thisMonth';
  return 'upcoming';
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
  return tournaments.filter(t => {
    if (f.filterUFs.length && !f.filterUFs.includes(t.state)) return false;
    if (f.filterTier !== 'all') {
      const tiers = (t.tiers && t.tiers.length) ? t.tiers : (t.tier ? [t.tier] : []);
      if (!tiers.includes(f.filterTier)) return false;
    }
    return true;
  });
}

// ===== Kanban =====
const KANBAN_COLUMNS = [
  { id: 'inscricoes_abertas', label: 'Inscrições abertas', icon: '🌟' },
  { id: 'torneios',            label: 'Torneios',            icon: '📋' },
  { id: 'vou_jogar',           label: 'Vou jogar',           icon: '⭐' },
  { id: 'pagar_inscricao',     label: 'Pagar inscrição',     icon: '💰' },
  { id: 'confirmado',          label: 'Confirmado',          icon: '✅' },
  { id: 'viagem_comprada',     label: 'Viagem comprada',     icon: '✈️' },
  { id: 'historico',           label: 'Histórico',           icon: '🎾' },
];
const KANBAN_COLUMN_IDS = KANBAN_COLUMNS.map(c => c.id);

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

  // Group by column
  const cardsByColumn = Object.fromEntries(KANBAN_COLUMN_IDS.map(c => [c, []]));
  for (const t of tournaments) {
    const col = effectiveColumnFor(t);
    if (!cardsByColumn[col]) cardsByColumn[col] = [];
    cardsByColumn[col].push(t);
  }
  // Sort within each column: manual cardOrder first, then by start date
  const sortFn = (a, b) => {
    const oa = a.notes?.cardOrder, ob = b.notes?.cardOrder;
    if (typeof oa === 'number' && typeof ob === 'number') return oa - ob;
    if (typeof oa === 'number') return -1;
    if (typeof ob === 'number') return 1;
    return (brToIso(a.startDate) || 'zzzz').localeCompare(brToIso(b.startDate) || 'zzzz');
  };
  for (const col of KANBAN_COLUMN_IDS) cardsByColumn[col].sort(sortFn);

  const container = el('div', { id: 'kanban-board', class: 'mt-4' },
    el('div', { class: 'flex gap-3 overflow-x-auto pb-4 px-1 -mx-1', style: 'scroll-snap-type: x proximity;' },
      ...KANBAN_COLUMNS.map(col => renderKanbanColumn(col, cardsByColumn[col.id] || [])),
    ),
  );

  // Wire SortableJS after render (next tick)
  setTimeout(() => wireKanbanSortable(container), 0);

  return container;
}

function renderKanbanColumn(col, cards) {
  const list = el('div', {
    class: 'kanban-list flex flex-col gap-2 p-2 min-h-[60px]',
    'data-column': col.id,
  });
  for (const t of cards) list.appendChild(renderKanbanCard(t));

  return el('div', {
    class: 'kanban-col rounded-lg shrink-0 w-72 sm:w-80 flex flex-col text-slate-100',
    style: 'scroll-snap-align: start;',
  },
    el('div', { class: 'px-3 py-2 flex items-center justify-between gap-2 border-b border-white/10' },
      el('div', { class: 'flex items-center gap-2 font-medium text-sm' },
        el('span', { class: 'text-base' }, col.icon),
        el('span', null, col.label),
      ),
      el('span', { class: 'text-xs text-white/60' }, String(cards.length)),
    ),
    list,
  );
}

function renderKanbanCard(t) {
  const selected = !!t.notes?.selected;
  const manualInscribed = !!t.notes?.manualInscribed;
  const givenUp = !!t.notes?.manualGiveUp;
  const pp = givenUp ? null : t.pendingPayment;
  const inscribed = givenUp ? false : (t.isAnnaInscribed || manualInscribed);
  const isPast = t.derivedStatus === 'past';
  const boletoExpired = pp && isBoletoExpired(t);
  const isNew = isNewlyAdded(t);
  const tiers = tournamentTiers(t);
  const cityState = [t.city, t.state].filter(Boolean).join(' / ');
  const photoCount = (t.notes?.receiptCount || 0); // we don't always have this — placeholder

  // Tarjas coloridas no topo (Trello-style) — uma cor por tier
  const tierColors = ['bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500'];
  const stripes = tiers.length
    ? el('div', { class: 'flex gap-1 mb-1.5' },
        ...tiers.slice(0, 5).map((_, i) => el('span', {
          class: `h-1.5 w-8 rounded-full ${tierColors[i % tierColors.length]}`,
        })))
    : null;

  return el('article', {
    class: 'kanban-card bg-white text-slate-900 rounded-md p-2.5 shadow-sm cursor-pointer hover:shadow-md',
    'data-tid': t.id,
    onClick: () => openTournament(t.id),
  },
    stripes,

    // Linha 1: badges de status (curtos)
    el('div', { class: 'flex items-center gap-1.5 flex-wrap text-[11px] mb-1' },
      isNew && el('span', { class: 'text-sm leading-none', title: 'Adicionado recentemente' }, '🆕'),
      pp && !boletoExpired && el('span', { class: 'px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium' }, '💰 ' + (pp.dueDate || '')),
      boletoExpired && el('span', { class: 'px-1.5 py-0.5 rounded bg-red-600 text-white font-medium' }, '❌ vencido'),
      inscribed && !pp && el('span', { class: 'px-1.5 py-0.5 rounded bg-emerald-600 text-white font-medium' }, '✓ inscrito'),
      !inscribed && !pp && !isPast && /encerrad/i.test(t.registrationStatus || '') && el('span', { class: 'px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-medium' }, '🔒'),
      ...tiers.slice(0, 3).map(tier =>
        el('span', { class: 'px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-medium' }, tier),
      ),
    ),

    // Linha 2: nome
    el('h3', { class: 'text-sm font-medium leading-snug mb-0.5 line-clamp-2' }, t.name || '(sem nome)'),

    // Linha 3: cidade/UF + datas
    el('div', { class: 'text-xs text-slate-600 flex items-center justify-between gap-2' },
      el('span', { class: 'truncate' }, cityState || '—'),
      el('span', { class: 'shrink-0 text-slate-500' }, t.startDate ? t.startDate.slice(0, 5) : ''),
    ),

    // Linha 4: relativo + estrela
    el('div', { class: 'mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-500' },
      el('span', { class: 'truncate' }, relativeDateLabel(t)),
      el('button', {
        class: `text-base leading-none ${selected ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`,
        title: selected ? 'Remover do calendário' : 'Adicionar ao calendário',
        onClick: (e) => { e.stopPropagation(); toggleSelected(t); },
      }, selected ? '★' : '☆'),
    ),
  );
}

function wireKanbanSortable(container) {
  if (typeof Sortable === 'undefined') return;
  const lists = container.querySelectorAll('.kanban-list');
  for (const list of lists) {
    Sortable.create(list, {
      group: 'kanban',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: async (evt) => {
        const tid = evt.item.dataset.tid;
        const newColumn = evt.to.dataset.column;
        const newIndex = evt.newIndex;
        if (!tid || !newColumn) return;
        const t = state.data?.tournaments?.find(x => x.id === tid);
        if (!t) return;
        // Optimistic: update local notes
        t.notes = { ...(t.notes || {}), column: newColumn, cardOrder: newIndex };
        try {
          await api.moveCard(state.activeProfileId, tid, newColumn, newIndex);
        } catch (err) {
          alert('Erro ao mover: ' + err.message);
          render(); // revert by re-rendering from server state next refresh
        }
      },
    });
  }
}

function renderTimeline(allTournaments) {
  const tournaments = applyHeaderFilters(allTournaments);
  const buckets = { urgent: [], thisWeek: [], thisMonth: [], upcoming: [], past: [] };
  for (const t of tournaments) buckets[categorizeForTimeline(t)].push(t);

  const sortByStart = (a, b) => (brToIso(a.startDate) || 'zzzz').localeCompare(brToIso(b.startDate) || 'zzzz');
  buckets.urgent.sort((a, b) => (brToIso(a.pendingPayment?.dueDate) || 'zzzz').localeCompare(brToIso(b.pendingPayment?.dueDate) || 'zzzz'));
  buckets.thisWeek.sort(sortByStart);
  buckets.thisMonth.sort(sortByStart);
  buckets.upcoming.sort(sortByStart);
  buckets.past.sort((a, b) => (brToIso(b.startDate) || '').localeCompare(brToIso(a.startDate) || ''));

  const sections = [
    { key: 'urgent', title: '⚠️ Urgente', tournaments: buckets.urgent, hideIfEmpty: true },
    { key: 'thisWeek', title: '📌 Esta semana', tournaments: buckets.thisWeek, emptyText: 'Nada nessa semana.' },
    { key: 'thisMonth', title: 'Este mês', tournaments: buckets.thisMonth, emptyText: 'Nada mais esse mês.' },
    { key: 'upcoming', title: 'Próximos meses', tournaments: buckets.upcoming },
    { key: 'past', title: 'Já passaram', tournaments: buckets.past },
  ];

  return el('div', { id: 'timeline-container', class: 'mt-4 space-y-4' },
    ...sections
      .filter(s => !(s.hideIfEmpty && s.tournaments.length === 0))
      .map(renderSection),
  );
}

function renderSection({ key, title, tournaments, emptyText }) {
  const titleNode = el('summary', { class: 'cursor-pointer select-none flex items-center justify-between gap-2 py-2 px-1' },
    el('span', { class: 'font-medium text-slate-800' }, title),
    el('span', { class: 'text-xs text-slate-500' }, tournaments.length ? `${tournaments.length} torneio${tournaments.length === 1 ? '' : 's'}` : ''),
  );

  const body = tournaments.length
    ? el('div', { class: 'grid gap-2 mt-1' }, ...tournaments.map(renderTournamentCard))
    : el('div', { class: 'text-sm text-slate-400 px-1 py-2' }, emptyText || 'Nada por aqui.');

  const attrs = { class: 'border-t border-slate-200 pt-1' };
  if (state.openSections.has(key)) attrs.open = 'open';
  const details = el('details', attrs, titleNode, body);
  details.addEventListener('toggle', () => {
    if (details.open) state.openSections.add(key);
    else state.openSections.delete(key);
    localStorage.setItem('openSections', JSON.stringify([...state.openSections]));
  });
  return details;
}

function renderHeader() {
  const old = $('header-bar');
  if (old) old.replaceWith(renderHeaderEl());
}

function renderHeaderEl() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  const ss = state.syncStatus;

  const profileSelect = state.profiles.length > 0 && el('select', {
    class: 'rounded border border-slate-300 px-3 py-1.5 text-sm bg-white max-w-[60vw] truncate',
    onChange: (e) => switchProfile(e.target.value),
  },
    ...state.profiles.map(p => el('option', { value: p.id, selected: p.id === state.activeProfileId ? 'selected' : false },
      p.athleteName || p.tiEmail || 'Atleta'
    )),
    el('option', { value: '__new__' }, '+ Adicionar atleta…'),
  );

  const isRunning = ss?.state === 'running';
  const icon = isRunning
    ? el('span', { class: 'inline-block animate-spin text-3xl leading-none' }, '↻')
    : el('span', { class: 'inline-block text-3xl leading-none' }, '⚙︎');
  const menuButton = el('button', {
    id: 'gear-button',
    class: 'w-12 h-12 flex items-center justify-center rounded hover:bg-slate-100',
    title: 'Mais opções',
    onClick: (e) => { e.stopPropagation(); toggleGearMenu(); },
  }, icon);

  return el('header', { id: 'header-bar', class: 'flex items-center justify-between gap-2 pb-3 border-b border-slate-200 relative' },
    el('div', { class: 'flex items-center gap-2 min-w-0' },
      el('span', { class: 'text-2xl flex-shrink-0' }, '🎾'),
      profileSelect,
    ),
    el('div', { class: 'flex items-center gap-1' },
      profile && renderSyncIndicator(),
      menuButton,
    ),
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
  if (ss?.state === 'running') {
    alert('🟡 Sincronizando agora…');
    return;
  }
  let header;
  if (ss?.state === 'error') {
    header = `🔴 Última sincronização falhou\n\nErro: ${ss.error || 'desconhecido'}` +
             (lastSync ? `\n\nÚltima OK: ${fmtBR(lastSync)}` : '');
  } else if (lastSync) {
    header = `🟢 Sincronizado em\n${fmtBR(lastSync)}`;
  } else {
    header = '⚫ Ainda não sincronizou.';
  }
  if (confirm(`${header}\n\nSincronizar agora?`)) syncNow();
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

  const actions = [
    profile && { label: '👤 Sobre o atleta', onClick: () => openAthleteCard() },
    profile && { label: '📅 Conectar com calendário', onClick: () => openCalendarSetup() },
    profile && { label: '✏️ Editar perfil', onClick: () => openProfileForm(profile) },
    state.user && { label: '🚪 Sair', onClick: () => logout() },
  ].filter(Boolean);

  const pillRow = (label, options, isSelected, onTogglePill, onClearAll) => {
    const allActive = !options.some(isSelected);
    const pill = (text, active, onClick) => el('button', {
      class: `text-xs px-2.5 py-1 rounded-full border ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`,
      onClick: (e) => { e.preventDefault(); onClick(); },
    }, text);
    return el('div', { class: 'px-3 py-2' },
      el('div', { class: 'text-xs text-slate-600 mb-1.5' }, label),
      el('div', { class: 'flex flex-wrap gap-1.5' },
        pill('Todos', allActive, onClearAll),
        ...options.map(v => pill(v, isSelected(v), () => onTogglePill(v))),
      ),
    );
  };

  const tierSelectRow = el('label', { class: 'block px-3 py-2 text-xs text-slate-600' },
    el('div', { class: 'mb-1.5' }, 'Chave'),
    (() => {
      const select = el('select', {
        class: 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm bg-white',
        onChange: (e) => {
          state.filterTier = e.target.value;
          localStorage.setItem('filterTier', e.target.value);
          rerenderBody();
        },
      },
        el('option', { value: 'all', selected: state.filterTier === 'all' ? 'selected' : false }, 'Todos'),
        ...tierOptions.map(v => el('option', { value: v, selected: state.filterTier === v ? 'selected' : false }, v)),
      );
      return select;
    })(),
  );

  const menu = el('div', {
    id: 'gear-menu',
    class: 'absolute right-0 top-14 z-30 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[260px] max-w-[90vw]',
    onClick: (e) => e.stopPropagation(),
  },
    ...actions.map(it => el('button', {
      class: 'block w-full text-left px-3 py-2 text-sm hover:bg-slate-100',
      onClick: () => { menu.remove(); it.onClick(); },
    }, it.label)),
    profile && el('div', { class: 'border-t border-slate-200 my-1' }),
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
    profile && tierSelectRow,
  );

  $('header-bar').appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
    });
  }, 0);
}

function rerenderBody() {
  const old = $('timeline-container');
  if (!old) { render(); return; }
  const tournaments = state.data?.tournaments || [];
  old.replaceWith(renderTimeline(tournaments));
}

function openAthleteCard() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  const data = state.data;
  if (!profile || !data) return;
  const athlete = data.athlete || {};
  const tournaments = data.tournaments || [];
  const today = startOfToday();

  const future = tournaments
    .filter(t => brToDate(t.startDate) && brToDate(t.startDate) >= today)
    .sort((a, b) => (brToIso(a.startDate) || '').localeCompare(brToIso(b.startDate) || ''));
  const past = tournaments
    .filter(t => brToDate(t.endDate) && brToDate(t.endDate) < today)
    .sort((a, b) => (brToIso(b.endDate) || '').localeCompare(brToIso(a.endDate) || ''));
  const next = future[0];
  const last = past[0];

  const inscribedThisYear = tournaments.filter(t => {
    const d = brToDate(t.startDate);
    return (t.isAnnaInscribed || t.notes?.manualInscribed) && d && d.getFullYear() === today.getFullYear();
  }).length;
  const pendingPayments = tournaments.filter(t => t.pendingPayment);
  const totalPending = pendingPayments.reduce((sum, t) => {
    return sum + parseBrCurrency(t.pendingPayment?.value);
  }, 0);

  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };

  const sectionTitle = (t) => el('div', { class: 'text-xs font-medium text-slate-500 uppercase tracking-wide' }, t);
  const kv = (label, value) => el('div', { class: 'flex justify-between gap-3 py-1' },
    el('span', { class: 'text-sm text-slate-600' }, label),
    el('span', { class: 'text-sm font-medium text-slate-900 text-right' }, value || '—'),
  );

  const card = el('div', { class: 'space-y-4' });

  // Identificação
  card.appendChild(el('div', null,
    el('h2', { class: 'text-xl font-semibold text-slate-900' }, athlete.name || profile.athleteName || 'Atleta'),
    el('div', { class: 'text-xs text-slate-500 mt-0.5' },
      `ID TI ${athlete.id || '—'}`,
      athlete.about ? ` • ${athlete.about}` : '',
    ),
    athlete.profileUrl && el('a', {
      href: athlete.profileUrl, target: '_blank', rel: 'noopener',
      class: 'text-xs text-emerald-700 hover:text-emerald-900 underline',
    }, 'Ver perfil no Tênis Integrado ↗'),
  ));

  // Rankings
  const rankCBT = athlete.rankingNational;
  const rankDF = athlete.rankingDF;
  const wtn = athlete.wtn;
  if (rankCBT || rankDF || wtn) {
    const cutoff = rankDF?.cutoffDate;
    card.appendChild(el('div', { class: 'border-t border-slate-200 pt-3 space-y-1' },
      sectionTitle(cutoff ? `Rankings (${cutoff})` : 'Rankings'),
      rankCBT && kv(`Nacional CBT ${rankCBT.year} ${rankCBT.category}`, `${rankCBT.position}º (${rankCBT.points} pts)`),
      rankDF && rankDF.dfPosition && kv('DF (recorte do nacional)', `${rankDF.dfPosition}º colocado`),
      wtn && kv('WTN', `${wtn.single} simples / ${wtn.double} duplas`),
    ));
  }

  // Próximo / último torneio
  card.appendChild(el('div', { class: 'border-t border-slate-200 pt-3 space-y-2' },
    sectionTitle('Calendário'),
    next
      ? el('div', null,
          el('div', { class: 'text-xs text-slate-500' }, '📅 Próximo torneio'),
          el('div', { class: 'text-sm font-medium' }, next.name),
          el('div', { class: 'text-xs text-slate-600' }, `${[next.city, next.state].filter(Boolean).join(' / ')} • ${relativeDateLabel(next)}`),
        )
      : el('div', { class: 'text-sm text-slate-500' }, 'Sem torneio futuro inscrito.'),
    last && el('div', { class: 'mt-2' },
      el('div', { class: 'text-xs text-slate-500' }, '🏆 Último torneio'),
      el('div', { class: 'text-sm font-medium' }, last.name),
      el('div', { class: 'text-xs text-slate-600' }, `${[last.city, last.state].filter(Boolean).join(' / ')} • ${relativeDateLabel(last)}`),
    ),
  ));

  // Estatísticas
  card.appendChild(el('div', { class: 'border-t border-slate-200 pt-3 space-y-1' },
    sectionTitle(`Resumo ${today.getFullYear()}`),
    kv('Inscrito em', `${inscribedThisYear} torneios`),
    kv('Boletos pendentes', pendingPayments.length
      ? `${pendingPayments.length} (R$ ${totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })})`
      : '0'),
  ));

  // Modal frame
  const overlay = el('div', { class: 'fixed inset-0 bg-black/40 z-40', onClick: close });
  const content = el('div', { class: 'fixed inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 max-h-[90vh] overflow-y-auto bg-white sm:rounded-2xl rounded-t-2xl z-50 max-w-xl w-full p-5 shadow-xl' },
    el('div', { class: 'flex items-center justify-between mb-3' },
      el('h2', { class: 'text-lg font-semibold' }, '👤 Sobre o atleta'),
      el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none px-2', onClick: close }, '×'),
    ),
    card,
  );
  root.appendChild(overlay);
  root.appendChild(content);
}

function openCalendarSetup() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  if (!profile) return;
  const root = $('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/40 z-40', onClick: close });
  const content = el('div', { class: 'fixed inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 max-h-[90vh] overflow-y-auto bg-white sm:rounded-2xl rounded-t-2xl z-50 max-w-xl w-full p-5 shadow-xl' },
    el('div', { class: 'flex items-center justify-between mb-3' },
      el('h2', { class: 'text-lg font-semibold' }, '📅 Conectar com calendário'),
      el('button', { class: 'text-slate-400 hover:text-slate-700 text-2xl leading-none px-2', onClick: close }, '×'),
    ),
    renderCalendarSetupBody(profile),
  );
  root.appendChild(overlay);
  root.appendChild(content);
}

function renderCalendarSetupBody(profile) {
  const wrapper = el('div', { class: 'space-y-3' });
  (async () => {
    let token = profile.calendarToken;
    if (!token) {
      const r = await fetch(`/api/profiles/${profile.id}/calendar-token`);
      token = (await r.json()).token;
      profile.calendarToken = token;
    }
    const httpUrl = `${location.protocol}//${location.host}/calendar/${token}.ics`;
    const webcalUrl = `webcal://${location.host}/calendar/${token}.ics`;
    const starredCount = (state.data?.tournaments || []).filter(t => t.notes?.selected).length;

    wrapper.innerHTML = '';
    wrapper.appendChild(el('p', { class: 'text-sm text-slate-700' },
      `Faça uma vez. Sua agenda nativa puxa as atualizações sozinha. Inclui ${starredCount} torneio${starredCount === 1 ? '' : 's'} marcado${starredCount === 1 ? '' : 's'} ⭐.`,
    ));
    wrapper.appendChild(el('div', { class: 'flex flex-col gap-2' },
      el('a', {
        href: webcalUrl,
        class: 'text-center bg-emerald-600 text-white text-sm px-4 py-2.5 rounded hover:bg-emerald-700',
      }, '📅 Adicionar ao Apple Calendar'),
      el('a', {
        href: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(httpUrl)}`,
        target: '_blank', rel: 'noopener',
        class: 'text-center bg-white border border-slate-300 text-slate-700 text-sm px-4 py-2.5 rounded hover:bg-slate-100',
      }, '🌐 Adicionar ao Google Calendar'),
      el('button', {
        class: 'text-center bg-white border border-slate-300 text-slate-700 text-sm px-4 py-2.5 rounded hover:bg-slate-100',
        onClick: async () => { try { await navigator.clipboard.writeText(httpUrl); alert('URL copiada!'); } catch { alert('Falha ao copiar'); } },
      }, '📋 Copiar URL'),
    ));
    wrapper.appendChild(el('div', { class: 'text-xs text-slate-500 space-y-1 pt-2 border-t border-slate-100' },
      el('p', null, '• 🎾 Eventos de torneio têm alarme 7 dias antes.'),
      el('p', null, '• 💰 Eventos de boleto têm alarme 1 dia antes.'),
      el('p', null, '• Pra editar a frequência de atualização no iPhone: Ajustes → Calendário → Contas → Inscritos.'),
    ));
  })();
  return wrapper;
}

async function syncNow() {
  if (!state.activeProfileId) return;
  state.syncStatus = { state: 'running' };
  renderHeader();
  await api.sync(state.activeProfileId);
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

function renderTournamentCard(t) {
  const selected = !!t.notes?.selected;
  const manualInscribed = !!t.notes?.manualInscribed;
  const givenUp = !!t.notes?.manualGiveUp;
  const pp = givenUp ? null : t.pendingPayment;
  const inscribed = givenUp ? false : (t.isAnnaInscribed || manualInscribed);
  const end = brToDate(t.endDate);
  const isPast = end && end < startOfToday();
  const boletoExpired = pp && isBoletoExpired(t);
  const registrationClosed = !pp && !isPast && isRegistrationClosed(t, inscribed);
  const isNew = isNewlyAdded(t);

  const cardClass = boletoExpired
    ? 'bg-red-50 border-red-300'
    : pp
    ? 'bg-amber-50 border-amber-300'
    : (inscribed && isPast)
    ? 'bg-rose-50 border-rose-300'
    : inscribed
    ? 'bg-emerald-50 border-emerald-300'
    : registrationClosed
    ? 'bg-slate-100 border-slate-300'
    : 'bg-white border-slate-200';

  const cityState = [t.city, t.state].filter(Boolean).join(' / ');
  const canInscribeNow = !pp && !inscribed && !registrationClosed && (() => {
    const start = brToDate(t.startDate);
    return start && start >= startOfToday();
  })();

  return el('article', {
    class: `${cardClass} rounded-lg border p-3 hover:shadow-sm cursor-pointer relative`,
    onClick: () => openTournament(t.id),
  },
    el('button', {
      class: `absolute top-1.5 right-1.5 w-10 h-10 flex items-center justify-center text-2xl leading-none rounded ${selected ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'}`,
      title: selected ? 'Remover do calendário' : 'Adicionar ao calendário',
      onClick: (e) => { e.stopPropagation(); toggleSelected(t); },
    }, selected ? '★' : '☆'),

    el('div', { class: 'pr-10' },
      el('div', { class: 'text-sm font-medium text-slate-700 mb-0.5 flex items-center gap-2 flex-wrap' },
        el('span', null, relativeDateLabel(t)),
        isNew && el('span', { class: 'text-base leading-none', title: 'Adicionado recentemente' }, '🆕'),
        inscribed && !pp && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-emerald-600 text-white font-medium' }, '✓ inscrito'),
        registrationClosed && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-slate-500 text-white font-medium' }, '🔒 Inscrições encerradas'),
        boletoExpired && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-red-600 text-white font-medium' }, '❌ Boleto vencido'),
      ),
      el('h3', { class: 'leading-snug font-medium' },
        ...tournamentTiers(t).map(tier =>
          el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-medium mr-1 align-middle' }, tier),
        ),
        el('span', null, t.name || '(sem nome)'),
      ),
      el('div', { class: 'text-sm text-slate-600 mt-0.5' }, cityState || '—'),
      t.hotels && t.hotels.length > 0 && el('div', { class: 'mt-1 text-xs text-slate-500' },
        `🏨 ${t.hotels[0].name}` + (t.hotels.length > 1 ? ` +${t.hotels.length - 1}` : ''),
      ),
      pp && el('div', { class: 'mt-2 text-sm font-medium text-amber-800' },
        `💰 Boleto vence em ${pp.dueDate}` + (pp.value ? ` — ${fmtValueNoCents(pp.value)}` : ''),
      ),
      canInscribeNow && el('button', {
        class: 'mt-2 text-xs text-emerald-700 hover:text-emerald-900 underline',
        onClick: (e) => { e.stopPropagation(); confirmInscription(t); },
      }, '✓ Já me inscrevi'),
      manualInscribed && !t.isAnnaInscribed && el('div', { class: 'mt-1 text-xs text-emerald-700 italic flex items-center gap-2' },
        el('span', null, '✓ inscrição confirmada manualmente'),
        el('button', {
          class: 'underline hover:text-emerald-900',
          onClick: (e) => { e.stopPropagation(); revertManualInscription(t); },
        }, 'desfazer'),
      ),
      // Quando ainda há pp mostrado (não desistiu), oferecer desistir
      pp && !isPast && el('button', {
        class: 'mt-2 ml-3 text-xs text-slate-500 hover:text-slate-800 underline',
        onClick: (e) => { e.stopPropagation(); giveUpTournament(t); },
      }, '✕ Desisti deste torneio'),
      givenUp && el('div', { class: 'mt-1 text-xs text-slate-500 italic flex items-center gap-2' },
        el('span', null, '✕ marcado como desistido'),
        el('button', {
          class: 'underline hover:text-slate-800',
          onClick: (e) => { e.stopPropagation(); revertGiveUp(t); },
        }, 'desfazer'),
      ),
    ),
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
    el('h3', { class: 'text-xs font-medium uppercase tracking-wide text-slate-500 mb-2' }, '📂 Comprovantes'),
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

  const buttonsRow = el('div', { class: 'flex flex-wrap gap-2' },
    el('button', {
      class: 'text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded',
      onClick: () => fileCamera.click(),
    }, '📸 Tirar foto'),
    el('button', {
      class: 'text-sm bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 px-3 py-1.5 rounded',
      onClick: () => fileGallery.click(),
    }, '📁 Escolher do celular'),
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

  // Lazy-fetch full details (hotels, venues, observations) and merge — only when relevant
  let details = null;
  if (isFuture) {
    try { details = await api.tournamentDetails(tid); } catch {}
  }
  const merged = details ? { ...t, hotels: details.hotels || t.hotels || [], venues: details.venues || t.venues || [], observations: details.observations || t.observations, cancelDeadline: details.cancelDeadline || t.cancelDeadline, prices: details.prices || t.prices } : t;

  const flightInfo = showTravelTools ? await api.flightUrl(state.activeProfileId, tid).catch(err => ({ error: true })) : null;

  const notes = t.notes || {};
  const root = $('modal-root');
  root.innerHTML = '';

  const close = () => { root.innerHTML = ''; };
  const overlay = el('div', { class: 'fixed inset-0 bg-black/40 z-40', onClick: close });

  const observationsBlock = merged.observations
    ? el('details', { class: 'mt-3' },
        el('summary', { class: 'cursor-pointer text-sm text-slate-600 hover:text-slate-900' }, 'Observações do torneio (texto livre)'),
        el('pre', { class: 'mt-2 text-xs whitespace-pre-wrap bg-slate-50 p-3 rounded border border-slate-200 max-h-64 overflow-auto' }, merged.observations),
      )
    : null;

  const status = t.derivedStatus || 'unknown';
  const statusBadge = el('span', { class: `inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[status]}` }, STATUS_LABELS[status]);

  const starBtn = el('button', {
    class: 'text-3xl leading-none transition-colors',
  }, '');
  const updateStar = () => {
    const sel = !!t.notes?.selected;
    starBtn.textContent = sel ? '★' : '☆';
    starBtn.className = `text-3xl leading-none transition-colors ${sel ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500'}`;
    starBtn.title = sel ? 'Remover da agenda' : 'Adicionar à agenda';
  };
  updateStar();
  starBtn.onclick = async () => {
    const newVal = !t.notes?.selected;
    t.notes = { ...(t.notes || {}), selected: newVal };
    updateStar();
    try {
      await api.updateNotes(state.activeProfileId, t.id, { selected: newVal });
      render(); // update card list behind the modal
    } catch (err) {
      t.notes.selected = !newVal;
      updateStar();
      alert('Erro: ' + err.message);
    }
  };

  const panel = el('div', { class: 'fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-xl z-50 overflow-y-auto' },
    el('div', { class: 'sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4' },
      el('div', { class: 'min-w-0' },
        el('div', { class: 'flex items-center gap-2 mb-1 flex-wrap' },
          statusBadge,
          t.tier && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-medium' }, t.tier),
          t.isAnnaInscribed && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-emerald-600 text-white font-medium' }, '✓ inscrito'),
          t.pendingPayment && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-amber-600 text-white font-medium' }, '💰 Não pago'),
        ),
        el('h2', { class: 'text-lg font-semibold' }, t.name),
        el('p', { class: 'text-sm text-slate-600' }, [t.city, t.state].filter(Boolean).join(' / ') || ''),
      ),
      el('div', { class: 'flex items-center gap-3 shrink-0' },
        starBtn,
        el('button', { class: 'text-slate-500 hover:text-slate-900 text-2xl leading-none', onClick: close }, '×'),
      ),
    ),
    el('div', { class: 'px-6 py-4 space-y-4' },
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

      isFuture && !isLost && !t.pendingPayment && !t.isAnnaInscribed && !t.notes?.manualInscribed && t.url && el('section', null,
        el('a', {
          href: t.url, target: '_blank', rel: 'noopener',
          class: 'inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded',
        }, '🎾 Inscrever no Tênis Integrado ↗'),
      ),

      t.pendingPayment && (() => {
        const reminder = buildPaymentReminder(t);
        return el('section', { class: 'rounded-lg bg-amber-50 border border-amber-300 p-3' },
          el('div', { class: 'text-sm font-medium text-amber-900' }, `💰 Pagamento pendente — vence ${t.pendingPayment.dueDate || '?'}`),
          el('div', { class: 'text-xs text-amber-800 mt-0.5' }, `${fmtValueNoCents(t.pendingPayment.value)}${t.pendingPayment.category ? ' · ' + t.pendingPayment.category : ''}`),
          el('div', { class: 'flex flex-wrap gap-2 mt-2' },
            el('a', {
              href: t.url || 'https://www.tenisintegrado.com.br',
              target: '_blank', rel: 'noopener',
              class: 'text-xs bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700',
            }, 'Abrir torneio no TI ↗'),
            reminder && el('button', {
              type: 'button',
              class: 'text-xs bg-white border border-amber-400 text-amber-800 px-2 py-1 rounded hover:bg-amber-100',
              title: `Cria evento em ${reminder.start.toLocaleString('pt-BR')} com alarme 30min antes`,
              onClick: () => downloadIcs(reminder, `pagamento-${(t.name || 'torneio').replace(/[^\w]+/g, '-').slice(0, 40)}.ics`),
            }, '📅 Apple Calendar (.ics)'),
            reminder && el('a', {
              href: googleCalendarUrl(reminder), target: '_blank', rel: 'noopener',
              class: 'text-xs bg-white border border-amber-400 text-amber-800 px-2 py-1 rounded hover:bg-amber-100',
              title: 'Abre Google Calendar com evento pré-preenchido',
            }, '🌐 Google Calendar'),
          ),
          reminder && el('div', { class: 'text-xs text-amber-700 mt-1' }, `Lembrete: ${reminder.start.toLocaleDateString('pt-BR')} às 09:00 (alarme 30min antes)`),
        );
      })(),

      el('section', null,
        el('h3', { class: 'text-xs font-medium uppercase tracking-wide text-slate-500 mb-2' }, 'Datas'),
        el('p', { class: 'text-sm' }, `${t.startDate || '—'} a ${t.endDate || '—'}`),
        merged.cancelDeadline && el('p', { class: 'text-xs text-slate-500 mt-0.5' }, `Cancelamento até ${merged.cancelDeadline}`),
      ),

      flightInfo && flightInfo.sameCity && el('section', null,
        el('h3', { class: 'text-xs font-medium uppercase tracking-wide text-slate-500 mb-2' }, '🏠 Deslocamento'),
        el('p', { class: 'text-sm text-slate-700' }, `Torneio na mesma cidade do atleta (${flightInfo.origin}) — sem voo.`),
      ),

      flightInfo && !flightInfo.error && !flightInfo.sameCity && flightInfo.arrival && flightInfo.ret && el('section', null,
        el('h3', { class: 'text-xs font-medium uppercase tracking-wide text-slate-500 mb-2' }, '✈ Passagens'),
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
        el('h3', { class: 'text-xs font-medium uppercase tracking-wide text-slate-500 mb-2' }, '✈ Passagens'),
        el('p', { class: 'text-xs text-slate-500' }, 'Não foi possível gerar link de busca (cidade sem aeroporto cadastrado).'),
      ),

      showTravelTools && merged.hotels?.length > 0 && !flightInfo?.sameCity && el('section', null,
        el('h3', { class: 'text-xs font-medium uppercase tracking-wide text-slate-500 mb-2' }, `🏨 Hotéis oficiais (${merged.hotels.length})`),
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
        el('h3', { class: 'text-xs font-medium uppercase tracking-wide text-slate-500 mb-2' }, '📍 Locais dos jogos'),
        el('ul', { class: 'space-y-2' },
          ...merged.venues.map(v => el('li', { class: 'text-sm border border-slate-200 rounded p-2' },
            el('div', { class: 'font-medium' }, v.name),
            v.address && el('div', { class: 'text-xs text-slate-600' }, v.address),
            (v.phone || v.surface) && el('div', { class: 'text-xs text-slate-500' }, [v.phone, v.surface].filter(Boolean).join(' · ')),
          )),
        ),
      ),

      observationsBlock,

      el('section', null,
        el('h3', { class: 'text-xs font-medium uppercase tracking-wide text-slate-500 mb-2' }, 'Anotações'),
        renderNotesForm(t.id, notes),
      ),

      receiptsBlock(t),

      !isFuture && t.url && el('div', { class: 'pt-4 border-t border-slate-200 flex gap-3' },
        el('a', { href: t.url, target: '_blank', rel: 'noopener', class: 'text-sm text-slate-600 hover:underline' }, 'Ver no Tênis Integrado ↗'),
      ),
    ),
  );

  root.appendChild(overlay);
  root.appendChild(panel);
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
  const overlay = el('div', { class: 'fixed inset-0 bg-black/40 z-40', onClick: close });

  const isEdit = !!profile;
  const inputs = {};
  const field = (key, label, type = 'text', value = '') => {
    const inp = el('input', { type, class: 'w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500' });
    inp.value = value;
    inputs[key] = inp;
    return el('label', { class: 'block' },
      el('span', { class: 'block text-xs text-slate-500 mb-1' }, label),
      inp,
    );
  };

  const errorBox = el('div', { class: 'text-sm text-red-600' });
  const submit = async () => {
    errorBox.textContent = '';
    const body = {
      athleteName: inputs.athleteName.value.trim() || null,
      tiEmail: inputs.tiEmail.value.trim(),
      tiPassword: inputs.tiPassword.value,
      originAirport: inputs.originAirport.value.trim().toUpperCase() || 'BSB',
      originCity: inputs.originCity.value.trim() || 'Brasília',
    };
    if (!body.tiEmail) { errorBox.textContent = 'Email é obrigatório'; return; }
    if (!isEdit && !body.tiPassword) { errorBox.textContent = 'Senha é obrigatória'; return; }
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
      errorBox.textContent = e.message;
    }
  };

  const panel = el('div', { class: 'fixed inset-0 z-50 flex items-center justify-center p-4' },
    el('div', { class: 'bg-white rounded-lg shadow-xl w-full max-w-md p-6 space-y-3' },
      el('h2', { class: 'text-lg font-semibold' }, isEdit ? 'Editar perfil' : 'Adicionar atleta'),
      el('p', { class: 'text-xs text-slate-500' }, 'As credenciais do Tênis Integrado são guardadas localmente e criptografadas.'),
      field('athleteName', 'Nome do atleta (descoberto no login)', 'text', profile?.athleteName || ''),
      field('tiEmail', 'Email/login do Tênis Integrado', 'email', profile?.tiEmail || ''),
      field('tiPassword', isEdit ? 'Nova senha (em branco mantém)' : 'Senha do Tênis Integrado', 'password'),
      el('div', { class: 'grid grid-cols-2 gap-2' },
        field('originCity', 'Cidade de origem', 'text', profile?.originCity || 'Brasília'),
        field('originAirport', 'Aeroporto (IATA)', 'text', profile?.originAirport || 'BSB'),
      ),
      errorBox,
      el('div', { class: 'flex justify-between pt-2' },
        isEdit
          ? el('button', { class: 'text-sm text-red-600 hover:underline', onClick: async () => {
              if (!confirm('Excluir este perfil e todos os dados?')) return;
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
            } }, 'Excluir perfil')
          : el('span'),
        el('div', { class: 'flex gap-2' },
          el('button', { class: 'text-sm px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-100', onClick: close }, 'Cancelar'),
          el('button', { class: 'text-sm px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700', onClick: submit }, isEdit ? 'Salvar' : 'Criar'),
        ),
      ),
    ),
  );

  root.appendChild(overlay);
  root.appendChild(panel);
}


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init().catch(err => {
  $('app').innerHTML = `<div class="text-red-600 mt-8">Erro ao carregar: ${err.message}</div>`;
});
