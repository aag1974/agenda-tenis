// /scouting — SPA simples com 3 telas: login, dashboard, start/:token.
// Mantra: funciona > bonito. Sem bibliotecas, sem build, só DOM API.

const $root = document.getElementById('root');

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
      else if (typeof v === 'boolean') node[k] = v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch('/api/scouting' + path, opts);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text || `HTTP ${r.status}` }; }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function clear() { $root.innerHTML = ''; }
function mount(node) {
  clear();
  $root.appendChild(node);
  // Toda troca de tela começa no topo (login → dashboard, etc).
  window.scrollTo(0, 0);
}

// Tokens significativos do nome — pula preposições ("de", "da", "do", "dos",
// "das", "e", "di", "du"). "Rafael de Veríssimo Queiroz" → ["Rafael",
// "Veríssimo", "Queiroz"].
const NAME_STOPWORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'di', 'du', 'del', 'della', 'van', 'von', 'la', 'le']);
function nameTokens(name) {
  return (name || '').trim().split(/\s+/).filter(p => p && !NAME_STOPWORDS.has(p.toLowerCase()));
}

// Padrão do TF: depois de identificado, mostra "Nome PrimeiroSobrenome".
// "Rafael de Veríssimo Queiroz" → "Rafael Veríssimo".
// Pra desambiguar 2 atletas homônimos, ver dualShortName().
function shortName(name) {
  const t = nameTokens(name);
  if (t.length <= 1) return t.join(' ');
  return `${t[0]} ${t[1]}`;
}

// Primeiro nome (pula preposições — "de Souza" não vira "de").
function firstName(name) {
  return nameTokens(name)[0] || '';
}

// Recebe 2 nomes; retorna [shortA, shortB] desambiguados.
// Se "Rafael Veríssimo" vs "Rafael Carvalho" — mantém como tá.
// Se "Rafael Veríssimo Queiroz" vs "Rafael Veríssimo Pereira" — encontra
// primeiro sobrenome que diferencia → "Rafael Queiroz" vs "Rafael Pereira".
function dualShortName(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return [shortName(a), shortName(b)];
  // Se primeiro nome difere, o shortName padrão já desambigua.
  if (ta[0].toLowerCase() !== tb[0].toLowerCase()) {
    return [shortName(a), shortName(b)];
  }
  // Mesmo primeiro nome — busca o primeiro sobrenome que diferencia.
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

// ===== Modais customizados (sem alert/confirm/prompt nativos) =====
// Premissa do projeto (CLAUDE.md): toda confirmação usa modal estilizado.
function showModal(content) {
  const overlay = el('div', {
    class: 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm',
  });
  const card = el('div', {
    class: 'w-full max-w-sm bg-slate-900 border border-white/15 rounded-2xl shadow-2xl p-5 space-y-4',
  }, content);
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  function close() { overlay.remove(); }
  return { close, overlay, card };
}

function confirmDialog(message, { danger = false, okLabel = 'Confirmar', cancelLabel = 'Cancelar' } = {}) {
  return new Promise((resolve) => {
    const msg = el('div', { class: 'text-sm text-white/90 whitespace-pre-line' }, message);
    const cancelBtn = el('button', {
      class: 'flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-white/5 hover:bg-white/10 text-white/80',
    }, cancelLabel);
    const okBtn = el('button', {
      class: `flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-white ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-cyan-600 hover:bg-cyan-700'}`,
    }, okLabel);
    const { close } = showModal(el('div', { class: 'space-y-4' },
      msg,
      el('div', { class: 'flex gap-2' }, cancelBtn, okBtn),
    ));
    cancelBtn.onclick = () => { close(); resolve(false); };
    okBtn.onclick = () => { close(); resolve(true); };
  });
}

// Modal "Encerrar partida" pra coach quando scouter sumiu.
// Oferece 2 caminhos: placar final manual OU retirement.
// Retorna { kind: 'sets', sets: [{a,o}] } | { kind: 'ret', side: 'a'|'o' } | null
function pickFinalizeOrRet(athleteName, opponentName) {
  return new Promise((resolve) => {
    let phase = 'choice'; // 'choice' | 'sets' | 'ret'
    const card = el('div', { class: 'space-y-3' });
    const { close } = showModal(card);
    const cancelBtn = (label = 'Cancelar') => el('button', {
      class: 'w-full py-3 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 text-white/80',
      onClick: () => { close(); resolve(null); },
    }, label);
    const back = el('button', {
      class: 'w-full py-2 rounded-xl text-xs text-white/60 hover:text-white underline mt-1',
      onClick: () => renderPhase('choice'),
    }, '← Voltar');

    function renderPhase(p) {
      phase = p;
      card.innerHTML = '';
      if (phase === 'choice') {
        card.appendChild(el('div', { class: 'text-sm font-bold text-center' }, 'Encerrar partida'));
        card.appendChild(el('div', { class: 'text-xs text-white/60 text-center' }, 'Como o jogo terminou?'));
        card.appendChild(el('div', { class: 'flex flex-col gap-2 mt-2' },
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700',
            onClick: () => renderPhase('sets'),
          }, 'Marcar placar final'),
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-amber-700 hover:bg-amber-800',
            onClick: () => renderPhase('ret'),
          }, 'Retirement (alguém parou)'),
          cancelBtn(),
        ));
      } else if (phase === 'sets') {
        card.appendChild(el('div', { class: 'text-sm font-bold text-center' }, 'Placar final'));
        card.appendChild(el('div', { class: 'text-xs text-white/60 text-center' }, 'Games por set. Deixe vazio se não houve.'));
        const inputs = [];
        function makeSetRow(idx) {
          const inA = el('input', {
            type: 'number', min: '0', max: '99', placeholder: '—',
            class: 'w-16 text-center text-base font-bold bg-white text-slate-900 rounded px-2 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-400',
          });
          const inO = el('input', {
            type: 'number', min: '0', max: '99', placeholder: '—',
            class: 'w-16 text-center text-base font-bold bg-white text-slate-900 rounded px-2 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-400',
          });
          inputs.push({ a: inA, o: inO });
          return el('div', { class: 'flex items-center justify-center gap-3' },
            el('div', { class: 'text-[10px] uppercase tracking-wider text-white/50 font-bold w-12 text-right' }, `Set ${idx + 1}`),
            inA,
            el('span', { class: 'text-white/40' }, '·'),
            inO,
          );
        }
        card.appendChild(el('div', { class: 'space-y-2 my-2' },
          el('div', { class: 'flex items-center justify-center gap-3 text-[10px] uppercase tracking-wider' },
            el('div', { class: 'w-12' }),
            el('div', { class: 'w-16 text-center text-cyan-300 font-bold truncate' }, athleteName),
            el('div', { class: 'opacity-0' }, '·'),
            el('div', { class: 'w-16 text-center text-rose-300 font-bold truncate' }, opponentName),
          ),
          makeSetRow(0),
          makeSetRow(1),
          makeSetRow(2),
        ));
        const errBox = el('div', { class: 'hidden text-xs text-rose-300 text-center' });
        card.appendChild(errBox);
        card.appendChild(el('button', {
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
            close();
            resolve({ kind: 'sets', sets });
          },
        }, 'Salvar placar'));
        card.appendChild(back);
      } else if (phase === 'ret') {
        card.appendChild(el('div', { class: 'text-sm font-bold text-center' }, 'Quem parou?'));
        card.appendChild(el('div', { class: 'text-xs text-white/60 text-center' }, 'Encerra como RET (Retirement). O placar atual fica como resultado.'));
        card.appendChild(el('div', { class: 'flex flex-col gap-2 mt-2' },
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700',
            onClick: () => { close(); resolve({ kind: 'ret', side: 'a' }); },
          }, athleteName),
          el('button', {
            class: 'w-full py-3 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700',
            onClick: () => { close(); resolve({ kind: 'ret', side: 'o' }); },
          }, opponentName),
          back,
        ));
      }
    }
    renderPhase('choice');
  });
}

function infoDialog(message, { title = null, kind = 'info' } = {}) {
  return new Promise((resolve) => {
    const kindStyles = {
      info: 'text-cyan-300', success: 'text-emerald-300', error: 'text-rose-300',
    };
    const okBtn = el('button', {
      class: 'w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-700 text-white',
    }, 'OK');
    const { close } = showModal(el('div', { class: 'space-y-4' },
      title ? el('div', { class: `text-sm font-bold ${kindStyles[kind]}` }, title) : null,
      el('div', { class: 'text-sm text-white/90 whitespace-pre-line' }, message),
      okBtn,
    ));
    okBtn.onclick = () => { close(); resolve(true); };
  });
}

// ===== Router super simples =====
function getRoute() {
  const path = window.location.pathname.replace(/^\/scouting\/?/, '') || '';
  if (path.startsWith('start/')) return { name: 'start', token: path.slice('start/'.length) };
  return { name: path || 'home' };
}
function go(path) {
  window.history.pushState({}, '', '/scouting' + (path ? '/' + path : ''));
  route();
}
window.addEventListener('popstate', () => route());

async function route() {
  const r = getRoute();
  if (r.name === 'start') return renderStart(r.token);
  // Pra demais rotas, checa se está logado
  try {
    await api('GET', '/me');
    renderDashboard();
  } catch {
    renderLogin();
  }
}

// ===== Tela 1: Login =====
function renderLogin() {
  const inputs = {};
  const errBox = el('div', { class: 'text-sm text-red-300 bg-red-900/30 border border-red-400/30 rounded px-3 py-2 hidden' });
  const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
  const submit = async () => {
    errBox.classList.add('hidden');
    const email = inputs.email.value.trim();
    const password = inputs.password.value;
    if (!email || !password) return showErr('Preencha email e senha');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando…';
    try {
      await api('POST', '/login', { email, password });
      go('');
    } catch (e) {
      showErr(e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar';
    }
  };
  const submitBtn = el('button', {
    class: 'w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-2.5 rounded-lg',
    onClick: submit,
  }, 'Entrar');
  const field = (key, label, type, placeholder, autocomplete) => {
    inputs[key] = el('input', {
      type, placeholder, autocomplete,
      class: 'w-full bg-white/95 text-slate-900 border border-white/30 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder:text-slate-400',
    });
    inputs[key].addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    return el('label', { class: 'block' },
      el('div', { class: 'text-xs text-white/80 mb-1.5 font-medium' }, label),
      inputs[key],
    );
  };
  const card = el('div', { class: 'w-full max-w-sm bg-slate-900/40 backdrop-blur-md border border-white/15 rounded-2xl shadow-2xl p-7 space-y-5' },
    el('div', { class: 'space-y-1' },
      el('h2', { class: 'text-xl font-semibold' }, 'Entrar'),
      el('p', { class: 'text-xs text-white/60' }, 'Acesse para criar links de scout.'),
    ),
    field('email', 'Email', 'email', 'voce@email.com', 'email'),
    field('password', 'Senha', 'password', '••••••••', 'current-password'),
    errBox,
    submitBtn,
  );
  mount(el('div', { class: 'min-h-screen flex flex-col items-center justify-center px-4 py-8' },
    el('div', { class: 'mb-8 text-center select-none' },
      el('div', { class: 'inline-flex items-center gap-3 mb-2' },
        el('span', { class: 'text-4xl' }, '🎾'),
        el('span', { class: 'text-3xl font-bold tracking-tight' },
          el('span', { class: 'text-white' }, 'Tennis'),
          el('span', { class: 'text-cyan-300 ml-1' }, 'Flow'),
          el('span', { class: 'text-white/80 ml-2 font-light italic' }, 'Scouting'),
        ),
      ),
      el('p', { class: 'text-sm text-white/70 mt-1' }, 'Scout ao vivo. Estatística estruturada. Análise sob demanda.'),
    ),
    card,
  ));
  inputs.email.focus();
}

// ===== Tela 2: Dashboard do coach =====
async function renderDashboard() {
  mount(el('div', { class: 'min-h-screen flex flex-col items-center justify-center text-white/60 text-sm' }, 'Carregando…'));
  let roster, invites;
  try {
    [roster, invites] = await Promise.all([
      api('GET', '/roster'),
      api('GET', '/invites'),
    ]);
  } catch (e) {
    mount(el('div', { class: 'p-6 text-red-400' }, 'Erro: ' + e.message));
    return;
  }

  const onLogout = async () => {
    await api('POST', '/logout');
    go('');
  };

  const header = el('header', { class: 'scout-header border-b border-white/10 px-4 py-3 flex items-center justify-between' },
    el('div', { class: 'flex items-center gap-2' },
      el('span', { class: 'text-xl' }, '🎾'),
      el('span', { class: 'text-lg font-bold tracking-tight' },
        el('span', { class: 'text-white' }, 'Tennis'),
        el('span', { class: 'text-cyan-300 ml-0.5' }, 'Flow'),
        el('span', { class: 'text-white/80 ml-1.5 font-light italic text-base' }, 'Scouting'),
      ),
    ),
    el('div', { class: 'flex items-center gap-3' },
      el('a', { class: 'text-xs text-white/60 hover:text-white', href: '/scouting/manual', target: '_blank' }, 'Manual'),
      el('button', { class: 'text-xs text-white/60 hover:text-white', onClick: onLogout }, 'Sair'),
    ),
  );

  // ===== Bloco 1: Criar invite (search incremental) =====
  function normalize(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Cada slot (atleta + adversário) tem search incremental próprio.
  // setCategoryFilter() restringe os matches a uma categoria — útil pro
  // adversário, que normalmente é da mesma categoria do atleta selecionado.
  function makeAtletaPicker({ label, optional, color, helperText, onChange, source }) {
    let selected = null;
    let categoryFilter = null;
    const input = el('input', {
      type: 'text', placeholder: 'Digite parte do nome…', autocomplete: 'off',
      // text-base (16px) pra evitar zoom automático do iOS Safari em inputs
      // (zoom acontece se font-size < 16px e não desfaz).
      class: 'w-full bg-white/95 text-slate-900 border border-white/30 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder:text-slate-400',
    });
    const filterHint = el('div', { class: 'hidden text-[11px] text-cyan-300 mt-1 flex items-center gap-2' });
    const list = el('div', { class: 'mt-2 max-h-48 overflow-y-auto space-y-1' });
    const selBox = el('div', { class: `hidden mt-2 p-3 ${color.bg} border ${color.border} rounded-lg flex items-start justify-between gap-2` });
    const clearBtn = el('button', {
      class: 'text-white/60 hover:text-white text-sm leading-none',
      title: 'Limpar', onClick: () => clear(),
    }, '×');
    function clear() {
      selected = null;
      selBox.classList.add('hidden');
      selBox.innerHTML = '';
      input.value = '';
      list.innerHTML = '';
      inputBlock.classList.remove('hidden');
      onChange?.(null);
    }
    function set(a) {
      selected = a;
      selBox.innerHTML = '';
      selBox.classList.remove('hidden');
      const left = el('div', { class: 'min-w-0' },
        el('div', { class: `text-[10px] uppercase tracking-wider ${color.label} font-bold` }, label),
        el('div', { class: 'text-base font-semibold truncate' }, shortName(a.nome)),
        el('div', { class: 'text-xs text-white/70 truncate' }, [a.categoria, a.clube].filter(Boolean).join(' · ')),
      );
      selBox.appendChild(left);
      selBox.appendChild(clearBtn);
      // Esconde input + lista + hint: já tem seleção, não precisa buscar.
      inputBlock.classList.add('hidden');
      input.value = '';
      list.innerHTML = '';
      onChange?.(a);
    }
    function setCategoryFilter(cat) {
      categoryFilter = cat || null;
      if (categoryFilter) {
        filterHint.classList.remove('hidden');
        filterHint.innerHTML = '';
        filterHint.appendChild(el('span', null, `🔎 filtrando categoria: ${categoryFilter}`));
        filterHint.appendChild(el('button', {
          class: 'text-white/60 hover:text-white underline',
          onClick: () => setCategoryFilter(null),
        }, 'mostrar todos'));
      } else {
        filterHint.classList.add('hidden');
      }
      // Re-render lista atual
      render(input.value);
    }
    function render(q) {
      list.innerHTML = '';
      if (!q || q.length < 1) return;
      const nq = normalize(q);
      const base = source ? source() : roster.atletas;
      const inCategory = categoryFilter
        ? base.filter(a => a.categoria === categoryFilter)
        : base;
      const matches = inCategory
        .filter(a => normalize(a.nome).includes(nq))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .slice(0, 15);
      if (!matches.length) {
        list.appendChild(el('button', {
          class: 'w-full text-left px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-sm text-white/80',
          onClick: () => set({ id: null, nome: q.trim(), categoria: null, clube: null }),
        }, `+ Usar livre: "${q.trim()}"`));
        return;
      }
      for (const a of matches) {
        list.appendChild(el('button', {
          class: 'w-full text-left px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-sm flex items-baseline justify-between gap-2',
          onClick: () => set(a),
        },
          el('span', { class: 'font-medium' }, a.nome),
          el('span', { class: 'text-[10px] text-white/50' }, [a.categoria, a.clube].filter(Boolean).join(' · ').slice(0, 40)),
        ));
      }
    }
    input.addEventListener('input', () => render(input.value));
    // Enter ou blur com texto e nada selecionado → usa o texto como livre.
    // Evita ter que clicar no "Usar livre" pra confirmar nomes não-cadastrados.
    function commitFreeIfTyped() {
      const v = input.value.trim();
      if (v && !selected) {
        set({ id: null, nome: v, categoria: null, clube: null });
      }
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitFreeIfTyped(); }
    });
    input.addEventListener('blur', () => {
      // Pequeno delay pra não conflitar com clique em item da lista
      setTimeout(commitFreeIfTyped, 150);
    });
    // inputBlock agrupa input+hint+list pra mostrar/esconder juntos
    // quando há / não há seleção.
    const inputBlock = el('div', null, input, filterHint, list);
    const wrap = el('div', { class: 'space-y-1' },
      el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' },
        label, optional ? el('span', { class: 'text-white/40 ml-1 normal-case' }, '(opcional)') : null,
      ),
      inputBlock,
      selBox,
      helperText ? el('div', { class: 'text-[11px] text-white/50' }, helperText) : null,
    );
    return { node: wrap, get: () => selected, clear, setCategoryFilter };
  }

  const athletePicker = makeAtletaPicker({
    label: 'Atleta',
    color: { bg: 'bg-cyan-900/30', border: 'border-cyan-500/40', label: 'text-cyan-300/70' },
    onChange: (a) => {
      updateGenerateBtn();
      // Quando seleciona o atleta, filtra adversários pra mesma categoria.
      // Permite "mostrar todos" se for jogo inter-categoria (raro).
      opponentPicker.setCategoryFilter(a?.categoria || null);
    },
  });
  const opponentPicker = makeAtletaPicker({
    label: 'Adversário',
    optional: true,
    color: { bg: 'bg-rose-900/30', border: 'border-rose-500/40', label: 'text-rose-300/70' },
    helperText: 'Se não preencher, o scouter completa antes de iniciar.',
    source: () => roster.atletas.filter(a => a.id !== athletePicker.get()?.id),
  });

  const generateBtn = el('button', {
    class: 'w-full bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg mt-2',
    disabled: true,
  }, 'Gerar link pro scouter');

  function updateGenerateBtn() {
    generateBtn.disabled = !athletePicker.get();
  }

  generateBtn.onclick = async () => {
    const a = athletePicker.get();
    if (!a) return;
    const o = opponentPicker.get();
    generateBtn.disabled = true;
    generateBtn.textContent = '⏳ Gerando…';
    try {
      await api('POST', '/invites', {
        atletaId: a.id, atletaNome: a.nome, atletaCategoria: a.categoria,
        opponentId: o?.id, opponentNome: o?.nome, opponentCategoria: o?.categoria,
      });
      athletePicker.clear();
      opponentPicker.clear();
      generateBtn.textContent = 'Gerar link pro scouter';
      invites = await api('GET', '/invites');
      renderInvitesList();
      // Destaque visual rápido no card recém-criado (1º item da lista)
      const first = invitesContainer.querySelector('[data-invite-row]');
      if (first) {
        first.classList.add('ring-2', 'ring-emerald-400');
        setTimeout(() => first.classList.remove('ring-2', 'ring-emerald-400'), 1800);
      }
    } catch (e) {
      infoDialog(e.message, { title: 'Erro', kind: 'error' });
      generateBtn.textContent = 'Gerar link pro scouter';
      updateGenerateBtn();
    }
  };

  const createCard = el('section', { class: 'bg-slate-900/40 border border-white/10 rounded-xl p-4 space-y-3' },
    el('h3', { class: 'text-sm font-semibold text-cyan-300' }, '+ Nova partida'),
    athletePicker.node,
    opponentPicker.node,
    generateBtn,
  );

  // ===== Bloco 2: Lista de invites =====
  const invitesContainer = el('section', { class: 'mt-4 bg-slate-900/40 border border-white/10 rounded-xl p-4 space-y-2' });

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderScore(m) {
    if (!m || !m.setsHistory) return '';
    return m.setsHistory.map(s => `${s.a}-${s.o}`).join(' · ');
  }

  function renderInvitesList() {
    invitesContainer.innerHTML = '';
    invitesContainer.appendChild(el('h3', { class: 'text-sm font-semibold text-cyan-300' }, `Partidas (${invites.length})`));
    if (!invites.length) {
      invitesContainer.appendChild(el('div', { class: 'text-xs text-white/50' }, 'Nenhuma partida criada ainda.'));
      return;
    }
    for (const inv of invites) {
      const m = inv.match;
      // Status badge: abandono distingue W.O. (não compareceu) de Ret. (parou).
      const finishedLabel = m && m.abandoned ? 'RET' : 'ENCERRADO';
      const isLive = inv.matchId && m && !m.finished;
      const status = !inv.matchId
        ? { label: 'AGUARDANDO', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' }
        : (m && m.finished)
          ? { label: finishedLabel, cls: 'bg-slate-500/20 text-slate-300 border-slate-500/40' }
          : { label: 'AO VIVO', cls: 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse', live: true };
      // Adversário: do match em curso > do invite (pré-selecionado pelo coach) > "?"
      const opponentLabel = m?.opponentName || inv.opponentNome || null;
      const fullUrl = `${window.location.origin}/scouting/start/${inv.token}`;
      // WhatsApp mantém nome completo (pra quem recebe o link)
      const waText = opponentLabel
        ? `Scout: ${inv.atletaNome} vs ${opponentLabel} — ${fullUrl}`
        : `Scout do atleta ${inv.atletaNome}: ${fullUrl}`;
      const displayTitle = opponentLabel
        ? (() => {
            const [a, b] = dualShortName(inv.atletaNome, opponentLabel);
            return `${a} × ${b}`;
          })()
        : shortName(inv.atletaNome);
      const row = el('div', { 'data-invite-row': true, class: 'border border-white/10 rounded-lg p-3 bg-white/5 transition-shadow' },
        el('div', { class: 'flex items-start justify-between gap-2 mb-1' },
          el('div', { class: 'min-w-0' },
            el('div', { class: 'text-sm font-semibold truncate' }, displayTitle),
            el('div', { class: 'text-[11px] text-white/60' },
              [inv.atletaCategoria, fmtDate(inv.createdAt)].filter(Boolean).join(' · '),
            ),
          ),
          el('span', { class: `text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${status.cls}` },
            status.live ? el('span', { class: 'inline-block w-1.5 h-1.5 rounded-full bg-red-500' }) : null,
            status.label,
          ),
        ),
        m && el('div', { class: 'text-xs text-white/70' }, renderScore(m)),
        el('div', { class: 'flex flex-wrap gap-2 mt-2' },
          // Copiar/WhatsApp do link do scouter ficam SEMPRE disponíveis
          // (até match encerrado o scouter pode precisar reabrir se perdeu).
          // Backend redireciona pro scout existente se o invite já foi usado.
          !m?.finished && el('button', {
            class: 'text-xs bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1.5 rounded',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(fullUrl);
                infoDialog('Link copiado pra área de transferência.', { kind: 'success', title: '✅ Copiado' });
              } catch {
                infoDialog(fullUrl, { title: 'Copie o link', kind: 'info' });
              }
            },
          }, 'Link scouter'),
          !m?.finished && el('a', {
            class: 'text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded',
            href: `https://wa.me/?text=${encodeURIComponent(waText)}`,
            target: '_blank',
          }, 'WhatsApp'),
          (inv.viewerToken || inv.matchToken) && el('a', {
            class: 'text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded',
            // viewerToken (read-only) pro coach acompanhar — não marca pontos.
            href: `/live/${inv.viewerToken || inv.matchToken}`, target: '_blank',
          }, m && m.finished ? 'Ver relatório' : 'Acompanhar'),
          // Encerrar pelo coach (caso scouter suma sem fechar). Só pra match em curso.
          // Oferece marcar placar final manual OU retirement.
          inv.matchToken && m && !m.finished && el('button', {
            class: 'text-xs bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded',
            onClick: async () => {
              const aName = shortName(inv.atletaNome);
              const oName = shortName(inv.opponentNome || m.opponentName || 'Adversário');
              const result = await pickFinalizeOrRet(aName, oName);
              if (!result) return;
              try {
                if (result.kind === 'sets') {
                  await fetch(`/api/scout/${inv.matchToken}/finalize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sets: result.sets }),
                  });
                } else {
                  await fetch(`/api/scout/${inv.matchToken}/abandon`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ side: result.side, reason: 'ret' }),
                  });
                }
                invites = await api('GET', '/invites');
                renderInvitesList();
              } catch (e) {
                infoDialog(e.message, { title: 'Erro', kind: 'error' });
              }
            },
          }, 'Encerrar'),
          el('button', {
            class: 'text-xs bg-white/5 hover:bg-rose-500/30 text-white/70 px-3 py-1.5 rounded ml-auto',
            onClick: async () => {
              const summary = `${inv.atletaNome}${opponentLabel ? ' vs ' + opponentLabel : ''}`;
              const ok = await confirmDialog(
                `Excluir este invite?\n\n${summary}\n\nO link vira inválido e o scouter não consegue mais abrir.`,
                { danger: true, okLabel: 'Excluir' },
              );
              if (!ok) return;
              try {
                await api('DELETE', `/invites/${inv.token}`);
                invites = await api('GET', '/invites');
                renderInvitesList();
              } catch (e) {
                infoDialog(e.message, { title: 'Erro', kind: 'error' });
              }
            },
          }, 'Excluir'),
        ),
      );
      invitesContainer.appendChild(row);
    }
  }

  const main = el('main', { class: 'max-w-2xl mx-auto px-4 pt-6 pb-8' },
    createCard,
    invitesContainer,
  );
  mount(el('div', null, header, main));
  renderInvitesList();

  // Auto-refresh: a cada 5s checa se houve mudança nos invites/matches
  // (scouter iniciou, encerrou, marcou pontos). Só re-renderiza a lista
  // se algo mudou — não atrapalha digitação no campo de cima.
  function snapshotInvites(list) {
    return list.map(inv => {
      const m = inv.match;
      const sets = m?.setsHistory?.map(s => `${s.a}-${s.o}`).join(',') || '';
      return [
        inv.token,
        inv.matchId || '-',
        m?.finished ? '1' : '0',
        m?.abandoned ? '1' : '0',
        m?.abandonReason || '-',
        sets,
        m?.points?.length ?? 0,
      ].join('|');
    }).join('\n');
  }
  let lastSnapshot = snapshotInvites(invites);
  const pollId = setInterval(async () => {
    // Para de pollar se o usuário saiu do dashboard (root mudou).
    if (!document.body.contains(invitesContainer)) {
      clearInterval(pollId);
      return;
    }
    try {
      const fresh = await api('GET', '/invites');
      const snap = snapshotInvites(fresh);
      if (snap !== lastSnapshot) {
        invites = fresh;
        lastSnapshot = snap;
        renderInvitesList();
      }
    } catch {
      // silencioso — rede flutua, próxima tentativa
    }
  }, 5000);
}

// ===== Tela 3: Scouter abre invite =====
async function renderStart(token) {
  mount(el('div', { class: 'min-h-screen flex flex-col items-center justify-center text-white/60 text-sm' }, 'Carregando…'));
  let data;
  try { data = await api('GET', `/start/${token}`); }
  catch (e) {
    mount(el('div', { class: 'min-h-screen flex items-center justify-center p-6 text-center' },
      el('div', null,
        el('div', { class: 'text-4xl mb-3' }, '⚠️'),
        el('div', { class: 'text-red-300 mb-4' }, e.message),
      ),
    ));
    return;
  }
  if (data.alreadyStarted) {
    // Match já criado, redireciona direto
    window.location.href = data.scoutUrl;
    return;
  }
  const inv = data.invite;
  const roster = data.roster || [];

  // ===== Form do scouter =====
  let selected = null;
  let firstServer = 'a';
  let format = 'best_of_3';
  let ad = true;

  // Slot do adversário: input de busca + lista + card do selecionado.
  // Quando selected != null, o input e a lista somem (não precisa buscar
  // de novo) e fica só o card. Botão × no card permite trocar.
  const filterInput = el('input', {
    type: 'text', placeholder: 'Digite o nome…',
    // text-base (16px) pra evitar zoom automático do iOS Safari.
    class: 'w-full bg-white/95 text-slate-900 border border-white/30 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder:text-slate-400',
    autocomplete: 'off',
  });
  const inputWrap = el('div', { class: 'space-y-1' }, filterInput);
  const filteredList = el('div', { class: 'mt-2 max-h-56 overflow-y-auto space-y-1' });
  const selectedBox = el('div', { class: 'hidden mt-1 p-3 bg-rose-900/30 border border-rose-500/40 rounded-lg flex items-start justify-between gap-2' });

  function normalize(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  // Section inteira do adversário (label + input + selectedBox) — toggle
  // via classList. Quando há seleção, fica oculta porque o nome já aparece
  // no header (acima). Botão "trocar adversário" do header chama clearAdv.
  let advSection = null;

  function clearAdv() {
    selected = null;
    selectedBox.classList.add('hidden');
    selectedBox.innerHTML = '';
    inputWrap.classList.remove('hidden');
    filterInput.value = '';
    filteredList.innerHTML = '';
    advSection?.classList.remove('hidden');
    renderHeader();
    updateServerBtns();
    submitBtn.disabled = true;
    filterInput.focus();
  }

  function selectAdv(a) {
    selected = a;
    // Não precisa popular selectedBox — a section toda some quando selecionado.
    selectedBox.innerHTML = '';
    selectedBox.classList.add('hidden');
    inputWrap.classList.add('hidden');
    filterInput.value = '';
    filteredList.innerHTML = '';
    advSection?.classList.add('hidden');
    renderHeader();
    updateServerBtns();
    submitBtn.disabled = false;
  }

  // Filtro por categoria: se o invite veio com categoria do atleta,
  // assume mesma categoria pro adversário (default razoável).
  let categoryFilter = inv.atletaCategoria || null;
  const filterHint = el('div', { class: 'hidden text-[11px] text-cyan-300 mt-1 flex items-center gap-2' });
  function renderFilterHint() {
    if (categoryFilter) {
      filterHint.classList.remove('hidden');
      filterHint.innerHTML = '';
      filterHint.appendChild(el('span', null, `🔎 filtrando categoria: ${categoryFilter}`));
      filterHint.appendChild(el('button', {
        class: 'text-white/60 hover:text-white underline',
        onClick: () => { categoryFilter = null; renderFilterHint(); renderFiltered(filterInput.value); },
      }, 'mostrar todos'));
    } else {
      filterHint.classList.add('hidden');
    }
  }

  function renderFiltered(q) {
    filteredList.innerHTML = '';
    if (!q || q.length < 1) return;
    const nq = normalize(q);
    const base = categoryFilter ? roster.filter(a => a.categoria === categoryFilter) : roster;
    const matches = base
      .filter(a => normalize(a.nome).includes(nq))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, 15);
    if (!matches.length) {
      filteredList.appendChild(el('div', { class: 'text-xs text-white/50 px-3 py-2' }, 'Não tá na lista? Usa livre:'));
      filteredList.appendChild(el('button', {
        class: 'w-full text-left px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-sm',
        onClick: () => selectAdv({ id: null, nome: q.trim(), categoria: null, clube: null }),
      }, `Usar livre: "${q.trim()}"`));
      return;
    }
    for (const a of matches) {
      filteredList.appendChild(el('button', {
        class: 'w-full text-left px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-sm flex items-baseline justify-between gap-2',
        onClick: () => selectAdv(a),
      },
        el('span', { class: 'font-medium' }, a.nome),
        el('span', { class: 'text-[10px] text-white/50' }, [a.categoria, a.clube].filter(Boolean).join(' · ').slice(0, 40)),
      ));
    }
  }
  filterInput.addEventListener('input', () => renderFiltered(filterInput.value));

  // Quem saca
  const btnA = el('button', { class: 'flex-1' });
  const btnO = el('button', { class: 'flex-1' });
  function updateServerBtns() {
    const sel  = 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    const unsel = 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-white/30 text-white/80';
    btnA.className = firstServer === 'a' ? sel : unsel;
    btnO.className = firstServer === 'o' ? sel : unsel;
    // Se atleta e adversário têm o mesmo primeiro nome, mostra "Nome
    // Sobrenome" pra diferenciar; caso contrário, só primeiro nome.
    let labelA = firstName(inv.atletaNome);
    let labelO = selected ? firstName(selected.nome) : 'Adversário';
    if (selected && labelA && labelO && labelA.toLowerCase() === labelO.toLowerCase()) {
      [labelA, labelO] = dualShortName(inv.atletaNome, selected.nome);
    }
    btnA.textContent = `🎾 ${labelA}`;
    btnO.textContent = `🎾 ${labelO}`;
  }
  btnA.onclick = () => { firstServer = 'a'; updateServerBtns(); };
  btnO.onclick = () => { firstServer = 'o'; updateServerBtns(); };
  updateServerBtns();

  // Formato
  const formats = [
    ['best_of_3', 'Melhor de 3'],
    ['best_of_3_stb', 'Melhor de 3 + super-TB'],
    ['one_set_match_tb', '1 set + match TB'],
    ['pro_set_8', 'Pro-set 8 games'],
  ];
  const fmtBtns = formats.map(([key, label]) => {
    const b = el('button', { class: 'text-xs px-3 py-2 rounded-lg border border-white/30 text-white/80' }, label);
    b.dataset.key = key;
    b.onclick = () => {
      format = key;
      fmtBtns.forEach(x => x.className = 'text-xs px-3 py-2 rounded-lg border border-white/30 text-white/80');
      b.className = 'text-xs px-3 py-2 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    };
    return b;
  });
  fmtBtns[0].className = 'text-xs px-3 py-2 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';

  // Ad
  const adOn  = el('button', { class: 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold' }, 'Ad');
  const adOff = el('button', { class: 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-white/30 text-white/80' }, 'No Ad');
  adOn.onclick = () => {
    ad = true;
    adOn.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    adOff.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-white/30 text-white/80';
  };
  adOff.onclick = () => {
    ad = false;
    adOff.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold';
    adOn.className = 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-white/30 text-white/80';
  };

  const submitBtn = el('button', {
    class: 'w-full bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white font-bold py-3 rounded-lg',
    disabled: true,
  }, '▶ Iniciar tracking');
  submitBtn.onclick = async () => {
    if (!selected) return;
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Criando…';
    try {
      const r = await api('POST', `/start/${token}/begin`, {
        opponentId: selected.id,
        opponentName: selected.nome,
        config: { format, ad, firstServer },
      });
      window.location.href = r.scoutUrl;
    } catch (e) {
      infoDialog(e.message, { title: 'Erro', kind: 'error' });
      submitBtn.disabled = false;
      submitBtn.textContent = '▶ Iniciar tracking';
    }
  };

  // Header dinâmico: "Atleta" sozinho ou "Atleta × Adversário" se já tem
  // adversário selecionado (vindo do invite ou que o scouter acabou de escolher).
  const headerBox = el('div', { class: 'space-y-1 text-center' });
  function renderHeader() {
    headerBox.innerHTML = '';
    headerBox.appendChild(el('div', { class: 'inline-flex items-center gap-2 mb-1' },
      el('span', { class: 'text-2xl' }, '🎾'),
      el('span', { class: 'text-xl font-bold tracking-tight' },
        el('span', { class: 'text-white' }, 'Tennis'),
        el('span', { class: 'text-cyan-300 ml-0.5' }, 'Flow'),
        el('span', { class: 'text-white/80 ml-1.5 font-light italic text-base' }, 'Scouting'),
      ),
    ));
    headerBox.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-cyan-300 font-bold mt-3' }, 'Iniciar scout'));
    if (selected) {
      // Confronto: Atleta × Adversário [trocar]
      // Usa dualShortName pra desambiguar caso primeiro nome bata.
      const [shortA, shortB] = dualShortName(inv.atletaNome, selected.nome);
      headerBox.appendChild(el('div', { class: 'flex items-center justify-center gap-3 mt-1' },
        el('div', { class: 'text-base font-semibold text-cyan-200 text-right max-w-[40%] truncate' }, shortA),
        el('div', { class: 'text-xl font-extrabold text-white/50' }, '×'),
        el('div', { class: 'text-base font-semibold text-rose-200 text-left max-w-[40%] truncate' }, shortB),
      ));
      if (inv.atletaCategoria) {
        headerBox.appendChild(el('div', { class: 'text-xs text-white/60' }, inv.atletaCategoria));
      }
      headerBox.appendChild(el('button', {
        class: 'text-xs text-cyan-300 hover:text-cyan-200 font-semibold underline underline-offset-2 mt-2 px-3 py-1',
        onClick: clearAdv,
      }, '↻ Trocar adversário'));
    } else {
      headerBox.appendChild(el('h2', { class: 'text-lg font-semibold' }, shortName(inv.atletaNome)));
      if (inv.atletaCategoria) {
        headerBox.appendChild(el('div', { class: 'text-xs text-white/60' }, inv.atletaCategoria));
      }
    }
  }

  // Se o coach pré-selecionou adversário, pré-preenche o slot
  if (inv.opponentNome) {
    selectAdv({
      id: inv.opponentId || null,
      nome: inv.opponentNome,
      categoria: inv.opponentCategoria || null,
      clube: null,
    });
  } else {
    renderHeader();
  }

  // Slot adversário: input visível só enquanto não há seleção.
  // Quando há seleção, mostra só o card (selectedBox) com botão × pra trocar.
  inputWrap.appendChild(filterHint);
  inputWrap.appendChild(filteredList);

  advSection = el('div', { class: 'space-y-1' },
    el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' }, 'Adversário'),
    inputWrap,
    selectedBox,
  );
  // Se já tem adversário pré-selecionado (do invite), esconde a section
  if (selected) advSection.classList.add('hidden');

  const card = el('div', { class: 'max-w-md mx-auto p-4 space-y-4' },
    headerBox,
    advSection,
    el('div', { class: 'space-y-2' },
      el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' }, 'Quem começa sacando?'),
      el('div', { class: 'flex gap-2' }, btnA, btnO),
    ),
    el('div', { class: 'space-y-2' },
      el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' }, 'Formato'),
      el('div', { class: 'grid grid-cols-2 gap-2' }, ...fmtBtns),
    ),
    el('div', { class: 'space-y-2' },
      el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' }, 'Vantagem'),
      el('div', { class: 'flex gap-2' }, adOn, adOff),
      el('div', { class: 'text-[11px] text-white/50' }, 'No Ad = no 40-40 o próximo ponto decide.'),
    ),
    submitBtn,
  );
  mount(el('div', { class: 'min-h-screen' }, card));
  renderFilterHint();
  filterInput.focus();
}

route();
