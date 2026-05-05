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

function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
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
function fmtRelative(iso) {
  if (!iso) return 'nunca';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
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

const TIERS = ['GA', 'G1+', 'G1', 'G2', 'G3', 'Federações'];

const state = {
  user: null,
  hasUsers: false,
  profiles: [],
  activeProfileId: localStorage.getItem('activeProfileId') || null,
  data: null,
  syncStatus: null,
  filters: {
    year: 'all',
    uf: 'all',
    status: 'all',
    tier: 'all',
    onlyAnna: false,
    onlyStarred: false,
    onlyPending: false,
  },
  view: localStorage.getItem('view') || 'list',
  calendarMonth: monthStart(new Date()),
};
// Drop legacy calendar view state
if (state.view === 'calendar') state.view = 'list';

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
  async shutdown() { return fetch('/api/shutdown', { method: 'POST' }); },
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

  root.appendChild(renderViewToggle());

  if (state.view === 'subscribe') {
    root.appendChild(renderSubscribe());
  } else {
    root.appendChild(renderFilters(tournaments));
    root.appendChild(renderTournaments(tournaments));
  }
}

function renderSubscribe() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  if (!profile) return el('div', null);

  const baseUrl = `${location.protocol}//${location.host}`;
  const isLocal = location.hostname === 'localhost' || location.hostname.startsWith('192.168.') || location.hostname.startsWith('10.') || location.hostname.startsWith('127.');

  const wrapper = el('div', { class: 'mt-4 space-y-4' });

  (async () => {
    let token = profile.calendarToken;
    if (!token) {
      const r = await fetch(`/api/profiles/${profile.id}/calendar-token`);
      const d = await r.json();
      token = d.token;
      profile.calendarToken = token;
    }
    const httpUrl = `${baseUrl}/calendar/${token}.ics`;
    const webcalUrl = `webcal://${location.host}/calendar/${token}.ics`;

    wrapper.innerHTML = '';

    const starredCount = (state.data?.tournaments || []).filter(t => t.notes?.selected).length;
    const pendingCount = (state.data?.tournaments || []).filter(t => t.pendingPayment).length;

    wrapper.appendChild(el('div', { class: 'bg-emerald-50 border border-emerald-200 rounded-lg p-4' },
      el('h2', { class: 'text-lg font-semibold text-emerald-900 mb-1' }, '📅 Sincronizar com a agenda do celular'),
      el('p', { class: 'text-sm text-emerald-800' }, `Faça uma vez. Sua agenda nativa puxa atualizações sozinha. Inclui ${starredCount} torneio${starredCount === 1 ? '' : 's'} marcado${starredCount === 1 ? '' : 's'} ⭐ e ${pendingCount} lembrete${pendingCount === 1 ? '' : 's'} de pagamento.`),
    ));

    wrapper.appendChild(el('div', { class: 'bg-white rounded-lg border border-slate-200 p-4 space-y-3' },
      el('h3', { class: 'font-medium' }, 'Opção 1: Inscrição automática (recomendado)'),
      el('p', { class: 'text-sm text-slate-600' }, 'A agenda nativa puxa atualizações de hora em hora. Quando você marcar/desmarcar ⭐ aqui, sincroniza sozinho.'),

      isLocal && el('div', { class: 'rounded bg-amber-50 border border-amber-300 p-3 text-sm text-amber-900' },
        el('strong', null, '⚠️ Você está rodando local'),
        el('p', { class: 'mt-1 text-xs' }, 'A inscrição só funciona enquanto seu Mac está ligado E na mesma WiFi. Pra usar de qualquer lugar (3G/4G), o próximo passo do projeto é hospedar na nuvem.'),
      ),

      el('div', null,
        el('label', { class: 'block text-xs text-slate-500 mb-1' }, 'URL para inscrever:'),
        (() => {
          const inp = el('input', {
            type: 'text', readonly: 'readonly',
            class: 'w-full font-mono text-xs px-2 py-1.5 border border-slate-300 rounded bg-slate-50',
          });
          inp.value = httpUrl;
          inp.onclick = () => inp.select();
          return inp;
        })(),
      ),

      el('div', { class: 'flex flex-wrap gap-2' },
        el('a', {
          href: webcalUrl,
          class: 'inline-flex items-center gap-1 bg-emerald-600 text-white text-sm px-3 py-1.5 rounded hover:bg-emerald-700',
        }, '📅 Abrir no Apple Calendar'),
        el('a', {
          href: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(httpUrl)}`,
          target: '_blank', rel: 'noopener',
          class: 'inline-flex items-center gap-1 bg-white border border-slate-300 text-slate-700 text-sm px-3 py-1.5 rounded hover:bg-slate-100',
        }, '🌐 Adicionar no Google Calendar'),
        el('button', {
          class: 'inline-flex items-center gap-1 bg-white border border-slate-300 text-slate-700 text-sm px-3 py-1.5 rounded hover:bg-slate-100',
          onClick: async () => { try { await navigator.clipboard.writeText(httpUrl); alert('URL copiada!'); } catch { alert('Falha ao copiar — selecione manualmente'); } },
        }, '📋 Copiar URL'),
      ),
    ));

    wrapper.appendChild(el('div', { class: 'bg-white rounded-lg border border-slate-200 p-4 space-y-2' },
      el('h3', { class: 'font-medium' }, 'Opção 2: Baixar uma vez (não atualiza sozinho)'),
      el('p', { class: 'text-sm text-slate-600' }, 'Baixa um arquivo .ics, importa na agenda. Pra ver mudanças depois, baixa de novo.'),
      el('a', {
        href: httpUrl,
        download: 'agenda-tenis.ics',
        class: 'inline-block bg-slate-100 border border-slate-300 text-slate-700 text-sm px-3 py-1.5 rounded hover:bg-slate-200',
      }, '⬇️ Baixar .ics'),
    ));

    wrapper.appendChild(el('div', { class: 'bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-600 space-y-1' },
      el('p', { class: 'font-medium text-slate-700' }, 'Como vai ficar no celular:'),
      el('p', null, '• iPhone: toca em "Abrir no Apple Calendar" → "Inscrever". Frequência de atualização em Ajustes → Calendário → Contas → Inscritos.'),
      el('p', null, '• Android: "Adicionar no Google Calendar". Sincroniza automaticamente.'),
      el('p', null, '• Eventos verdes 🎾 = torneios marcados ⭐. Eventos amarelos 💰 = lembretes de pagamento (1 dia antes às 9h, com alarme).'),
    ));
  })();

  return wrapper;
}

function renderHeader() {
  const old = $('header-bar');
  if (old) old.replaceWith(renderHeaderEl());
}

function renderHeaderEl() {
  const profile = state.profiles.find(p => p.id === state.activeProfileId);
  const ss = state.syncStatus;
  const lastSync = state.data?.syncedAt;

  const syncLabel = ss?.state === 'running' ? '↻ Sincronizando…'
    : ss?.state === 'error' ? `⚠ ${ss.error}`
    : `Sincronizado ${fmtRelative(lastSync)}`;

  const profileSelect = state.profiles.length > 0 && el('select', {
    class: 'rounded border border-slate-300 px-3 py-1.5 text-sm bg-white',
    onChange: (e) => switchProfile(e.target.value),
  },
    ...state.profiles.map(p => el('option', { value: p.id, selected: p.id === state.activeProfileId ? 'selected' : false },
      `${p.athleteName || 'Atleta'} (${p.tiEmail})`
    )),
    el('option', { value: '__new__' }, '+ Adicionar atleta…'),
  );

  return el('header', { id: 'header-bar', class: 'flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200' },
    el('div', { class: 'flex items-center gap-3' },
      el('span', { class: 'text-2xl' }, '🎾'),
      el('h1', { class: 'text-xl font-semibold' }, 'Agenda Tênis Integrado'),
    ),
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      profileSelect,
      profile && el('button', {
        class: 'hidden sm:inline text-xs text-slate-500 hover:text-slate-800 underline',
        onClick: () => openProfileForm(profile),
      }, 'editar'),
      profile && el('span', { class: `hidden sm:inline text-xs ${ss?.state === 'error' ? 'text-red-600' : 'text-slate-500'}` }, syncLabel),
      profile && el('button', {
        class: 'rounded bg-slate-900 text-white text-sm px-3 py-1.5 hover:bg-slate-700 disabled:opacity-50',
        disabled: ss?.state === 'running' ? 'disabled' : false,
        onClick: () => syncNow(),
      }, ss?.state === 'running' ? '↻' : 'Sincronizar'),
      state.user && el('button', {
        class: 'hidden sm:inline text-xs text-slate-500 hover:text-slate-800 underline',
        title: state.user.email,
        onClick: () => logout(),
      }, 'Sair'),
      el('button', {
        class: 'hidden sm:inline rounded bg-slate-100 text-slate-700 text-sm px-3 py-1.5 hover:bg-slate-200 border border-slate-300',
        onClick: () => shutdownApp(),
      }, 'Encerrar'),
    ),
  );
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
    el('p', { class: 'text-slate-600 mb-4' }, 'Ainda não há torneios carregados. Clique em "Sincronizar" no topo para puxar a lista do Tênis Integrado.'),
    el('p', { class: 'text-xs text-slate-500' }, 'A sincronização leva ~30 segundos (faz login, baixa o catálogo Juvenil e identifica os torneios da atleta).'),
  );
}

function renderViewToggle() {
  const views = [['list', '📋 Lista'], ['subscribe', '📅 Sincronizar com agenda']];
  return el('div', { class: 'mt-4 flex gap-2 flex-wrap' },
    ...views.map(([key, label]) => el('button', {
      class: `px-3 py-1.5 rounded text-sm ${state.view === key ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-300 hover:bg-slate-100'}`,
      onClick: () => { state.view = key; localStorage.setItem('view', key); render(); },
    }, label)),
  );
}

// ===== Filters =====
function renderFilters(tournaments) {
  // Compute available years and UFs from data
  const years = [...new Set(tournaments
    .map(t => t.startDate?.slice(-4))
    .filter(Boolean))]
    .sort();
  const ufs = [...new Set(tournaments.map(t => t.state).filter(Boolean))].sort();
  const tiers = [...new Set(tournaments.map(t => t.tier).filter(Boolean))];

  const make = (key, label, options) => el('label', { class: 'flex items-center gap-1.5 text-sm' },
    el('span', { class: 'text-slate-500' }, label + ':'),
    el('select', {
      class: 'rounded border border-slate-300 px-2 py-1 text-sm bg-white',
      onChange: (e) => { state.filters[key] = e.target.value; render(); },
    },
      ...options.map(([v, t]) => el('option', { value: v, selected: state.filters[key] === v ? 'selected' : false }, t)),
    ),
  );

  return el('div', { class: 'mt-3 bg-white rounded-lg border border-slate-200 p-3 flex flex-wrap items-center gap-3' },
    make('year', 'Ano', [['all', 'Todos'], ...years.map(y => [y, y])]),
    make('uf', 'UF', [['all', 'Todas'], ...ufs.map(u => [u, u])]),
    make('status', 'Status', [
      ['all', 'Todos'],
      ['upcoming', 'Futuros'],
      ['ongoing', 'Em andamento'],
      ['past', 'Passados'],
    ]),
    make('tier', 'Nível', [['all', 'Todos'], ...TIERS.filter(t => tiers.includes(t)).map(t => [t, t])]),
    el('label', { class: 'flex items-center gap-1.5 text-sm cursor-pointer' },
      (() => { const cb = el('input', { type: 'checkbox' }); cb.checked = state.filters.onlyAnna; cb.onchange = () => { state.filters.onlyAnna = cb.checked; render(); }; return cb; })(),
      el('span', null, 'Só inscritos'),
    ),
    el('label', { class: 'flex items-center gap-1.5 text-sm cursor-pointer' },
      (() => { const cb = el('input', { type: 'checkbox' }); cb.checked = state.filters.onlyStarred; cb.onchange = () => { state.filters.onlyStarred = cb.checked; render(); }; return cb; })(),
      el('span', null, 'Só ⭐'),
    ),
    el('label', { class: 'flex items-center gap-1.5 text-sm cursor-pointer' },
      (() => { const cb = el('input', { type: 'checkbox' }); cb.checked = state.filters.onlyPending; cb.onchange = () => { state.filters.onlyPending = cb.checked; render(); }; return cb; })(),
      el('span', { class: 'text-amber-800 font-medium' }, '💰 Pendentes'),
    ),
    el('button', {
      class: 'ml-auto text-xs text-slate-500 hover:text-slate-800 underline',
      onClick: () => { state.filters = { year: 'all', uf: 'all', status: 'all', tier: 'all', onlyAnna: false, onlyStarred: false, onlyPending: false }; render(); },
    }, 'limpar filtros'),
  );
}

function applyFilters(tournaments) {
  return tournaments.filter(t => {
    const f = state.filters;
    if (f.year !== 'all' && !(t.startDate || '').endsWith('/' + f.year)) return false;
    if (f.uf !== 'all' && t.state !== f.uf) return false;
    if (f.status !== 'all' && t.derivedStatus !== f.status) return false;
    if (f.tier !== 'all' && t.tier !== f.tier) return false;
    if (f.onlyAnna && !t.isAnnaInscribed) return false;
    if (f.onlyStarred && !t.notes?.selected) return false;
    if (f.onlyPending && !t.pendingPayment) return false;
    return true;
  });
}

// ===== List =====
function renderTournaments(tournaments) {
  const list = applyFilters(tournaments);
  list.sort((a, b) => (brToIso(a.startDate) || 'zzzz').localeCompare(brToIso(b.startDate) || 'zzzz'));

  if (!list.length) {
    return el('div', { class: 'mt-4 text-slate-500 text-sm bg-slate-100 rounded p-4 text-center' }, 'Nenhum torneio com esses filtros.');
  }

  return el('div', { class: 'mt-3' },
    el('div', { class: 'text-xs text-slate-500 mb-2' }, `${list.length} torneio${list.length === 1 ? '' : 's'}`),
    el('div', { class: 'grid gap-3' }, ...list.map(renderTournamentCard)),
  );
}

function renderTournamentCard(t) {
  const selected = !!t.notes?.selected;
  const status = t.derivedStatus || 'unknown';
  const pp = t.pendingPayment;
  const cardClass = pp
    ? 'bg-amber-50 border-amber-300'
    : 'bg-white border-slate-200';
  return el('article', {
    class: `${cardClass} rounded-lg border p-4 hover:shadow-sm cursor-pointer relative`,
    onClick: () => openTournament(t.id),
  },
    el('button', {
      class: `absolute top-2 right-2 w-11 h-11 flex items-center justify-center text-2xl leading-none rounded ${selected ? 'text-amber-500' : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'}`,
      title: selected ? 'Remover da agenda' : 'Adicionar à agenda',
      onClick: (e) => { e.stopPropagation(); toggleSelected(t); },
    }, selected ? '★' : '☆'),

    el('div', { class: 'pr-8' },
      el('div', { class: 'flex flex-wrap items-center gap-2 mb-1' },
        el('span', { class: `inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[status]}` }, STATUS_LABELS[status]),
        el('span', { class: 'text-xs text-slate-500' }, `${t.startDate || '?'} → ${t.endDate || '?'}`),
        t.tier && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-medium' }, t.tier),
        t.isAnnaInscribed && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-emerald-600 text-white font-medium' }, '✓ inscrita'),
        pp && el('span', { class: 'text-xs px-1.5 py-0.5 rounded bg-amber-600 text-white font-medium' }, `💰 Pagar até ${pp.dueDate || '?'}`),
      ),
      el('h3', { class: 'font-medium leading-snug' }, t.name || '(sem nome)'),
      el('div', { class: 'text-sm text-slate-600 mt-1 flex flex-wrap gap-x-3' },
        el('span', null, [t.city, t.state].filter(Boolean).join(' / ') || '—'),
        pp && el('span', { class: 'text-amber-800 font-medium' }, `${pp.value || ''}${pp.category ? ' · ' + pp.category : ''}`),
      ),
    ),
  );
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
          el('div', { class: 'text-xs text-amber-800 mt-0.5' }, `${t.pendingPayment.value || ''}${t.pendingPayment.category ? ' · ' + t.pendingPayment.category : ''}`),
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

async function shutdownApp() {
  if (!confirm('Encerrar o app? O servidor vai parar e a janela do terminal pode ser fechada.')) return;
  try { await api.shutdown(); } catch {}
  document.body.innerHTML = `
    <div class="max-w-md mx-auto mt-24 text-center text-slate-700">
      <h2 class="text-xl font-semibold mb-2">App encerrado</h2>
      <p class="text-sm text-slate-500">Pode fechar esta aba e a janela do terminal.</p>
    </div>`;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init().catch(err => {
  $('app').innerHTML = `<div class="text-red-600 mt-8">Erro ao carregar: ${err.message}</div>`;
});
