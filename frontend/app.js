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

  root.appendChild(renderTimeline(tournaments));
}

// ===== Timeline (single sectioned list) =====
const DAY = 24 * 60 * 60 * 1000;

function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function endOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); }

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
  let msg;
  if (ss?.state === 'running') {
    msg = '🟡 Sincronizando agora…';
  } else if (ss?.state === 'error') {
    msg = `🔴 Última sincronização falhou\n\nErro: ${ss.error || 'desconhecido'}` +
          (lastSync ? `\n\nÚltima OK: ${fmtBR(lastSync)}` : '');
  } else if (lastSync) {
    msg = `🟢 Sincronizado em\n${fmtBR(lastSync)}`;
  } else {
    msg = '⚫ Ainda não sincronizou.';
  }
  alert(msg);
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
    profile && { label: '↻ Sincronizar agora', onClick: () => syncNow() },
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
  const pp = t.pendingPayment;
  const cardClass = pp
    ? 'bg-amber-50 border-amber-300'
    : t.isAnnaInscribed
    ? 'bg-emerald-50 border-emerald-300'
    : 'bg-white border-slate-200';
  const cityState = [t.city, t.state].filter(Boolean).join(' / ');

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
      el('div', { class: 'text-sm font-medium text-slate-700 mb-0.5' }, relativeDateLabel(t)),
      el('h3', { class: 'leading-snug font-medium' },
        ...tournamentTiers(t).map(tier =>
          el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-medium mr-1 align-middle' }, tier),
        ),
        el('span', null, t.name || '(sem nome)'),
      ),
      el('div', { class: 'text-sm text-slate-600 mt-0.5' }, cityState || '—'),
      pp && el('div', { class: 'mt-2 text-sm font-medium text-amber-800' },
        `💰 Boleto vence em ${pp.dueDate}` + (pp.value ? ` — ${fmtValueNoCents(pp.value)}` : ''),
      ),
    ),
  );
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

  // Lazy-fetch full details (hotels, venues, observations) and merge — only for future
  let details = null;
  if (isFuture) {
    try { details = await api.tournamentDetails(tid); } catch {}
  }
  const merged = details ? { ...t, hotels: details.hotels || t.hotels || [], venues: details.venues || t.venues || [], observations: details.observations || t.observations, cancelDeadline: details.cancelDeadline || t.cancelDeadline, prices: details.prices || t.prices } : t;

  const flightInfo = isFuture ? await api.flightUrl(state.activeProfileId, tid).catch(err => ({ error: true })) : null;

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
          t.isAnnaInscribed && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-emerald-600 text-white font-medium' }, '✓ inscrita'),
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
      isFuture && !t.pendingPayment && t.url && el('section', null,
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
              href: t.pendingPayment.boletoUrl || t.url || 'https://www.tenisintegrado.com.br',
              target: '_blank', rel: 'noopener',
              class: 'text-xs bg-amber-600 text-white px-2 py-1 rounded hover:bg-amber-700',
            }, t.pendingPayment.boletoUrl ? 'Abrir boleto ↗' : 'Pagar no TI ↗'),
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

      flightInfo && !flightInfo.error && el('section', null,
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

      isFuture && merged.hotels?.length > 0 && el('section', null,
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

      isFuture && merged.venues?.length > 0 && el('section', null,
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
