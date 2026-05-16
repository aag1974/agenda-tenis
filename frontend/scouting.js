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
function mount(node) { clear(); $root.appendChild(node); }

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
      el('p', { class: 'text-xs text-white/60' }, 'Acesse pra criar links de scout.'),
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
      el('p', { class: 'text-sm text-white/70 mt-1' }, 'Marque pontos em tempo real, compartilhe com a família'),
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

  const header = el('header', { class: 'bg-slate-900/60 border-b border-white/10 px-4 py-3 flex items-center justify-between backdrop-blur' },
    el('div', { class: 'flex items-center gap-2' },
      el('span', { class: 'text-xl' }, '🎾'),
      el('span', { class: 'text-lg font-bold tracking-tight' },
        el('span', { class: 'text-white' }, 'Tennis'),
        el('span', { class: 'text-cyan-300 ml-0.5' }, 'Flow'),
        el('span', { class: 'text-white/80 ml-1.5 font-light italic text-base' }, 'Scouting'),
      ),
    ),
    el('button', { class: 'text-xs text-white/60 hover:text-white', onClick: onLogout }, 'Sair'),
  );

  // ===== Bloco 1: Criar invite (search incremental) =====
  function normalize(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Cada slot (atleta + adversário) tem search incremental próprio.
  function makeAtletaPicker({ label, optional, color, helperText, onChange }) {
    let selected = null;
    const input = el('input', {
      type: 'text', placeholder: 'Digite parte do nome…', autocomplete: 'off',
      class: 'w-full bg-white/95 text-slate-900 border border-white/30 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder:text-slate-400',
    });
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
      onChange?.(null);
    }
    function set(a) {
      selected = a;
      selBox.innerHTML = '';
      selBox.classList.remove('hidden');
      const left = el('div', { class: 'min-w-0' },
        el('div', { class: `text-[10px] uppercase tracking-wider ${color.label} font-bold` }, label),
        el('div', { class: 'text-base font-semibold truncate' }, a.nome),
        el('div', { class: 'text-xs text-white/70 truncate' }, [a.categoria, a.clube].filter(Boolean).join(' · ')),
      );
      selBox.appendChild(left);
      selBox.appendChild(clearBtn);
      input.value = '';
      list.innerHTML = '';
      onChange?.(a);
    }
    function render(q) {
      list.innerHTML = '';
      if (!q || q.length < 1) return;
      const nq = normalize(q);
      const matches = roster.atletas.filter(a => normalize(a.nome).includes(nq)).slice(0, 15);
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
    const wrap = el('div', { class: 'space-y-1' },
      el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' },
        label, optional ? el('span', { class: 'text-white/40 ml-1 normal-case' }, '(opcional)') : null,
      ),
      input,
      list,
      selBox,
      helperText ? el('div', { class: 'text-[11px] text-white/50' }, helperText) : null,
    );
    return { node: wrap, get: () => selected, clear };
  }

  const athletePicker = makeAtletaPicker({
    label: 'Atleta',
    color: { bg: 'bg-cyan-900/30', border: 'border-cyan-500/40', label: 'text-cyan-300/70' },
    onChange: () => updateGenerateBtn(),
  });
  const opponentPicker = makeAtletaPicker({
    label: 'Adversário',
    optional: true,
    color: { bg: 'bg-rose-900/30', border: 'border-rose-500/40', label: 'text-rose-300/70' },
    helperText: 'Se não preencher, o scouter completa antes de iniciar.',
  });

  const generateBtn = el('button', {
    class: 'w-full bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg mt-2',
    disabled: true,
  }, '🔗 Gerar link pro scouter');

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
      generateBtn.textContent = '🔗 Gerar link pro scouter';
      invites = await api('GET', '/invites');
      renderInvitesList();
      // Destaque visual rápido no card recém-criado (1º item da lista)
      const first = invitesContainer.querySelector('[data-invite-row]');
      if (first) {
        first.classList.add('ring-2', 'ring-emerald-400');
        setTimeout(() => first.classList.remove('ring-2', 'ring-emerald-400'), 1800);
      }
    } catch (e) {
      alert('Erro: ' + e.message);
      generateBtn.textContent = '🔗 Gerar link pro scouter';
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
      const status = !inv.matchId
        ? { label: 'AGUARDANDO SCOUTER', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' }
        : (m && m.finished)
          ? { label: m.abandoned ? 'ABANDONADO' : 'ENCERRADO', cls: 'bg-slate-500/20 text-slate-300 border-slate-500/40' }
          : { label: 'AO VIVO', cls: 'bg-red-500/20 text-red-300 border-red-500/40' };
      // Adversário: do match em curso > do invite (pré-selecionado pelo coach) > "?"
      const opponentLabel = m?.opponentName || inv.opponentNome || null;
      const fullUrl = `${window.location.origin}/scouting/start/${inv.token}`;
      const waText = opponentLabel
        ? `Scout: ${inv.atletaNome} vs ${opponentLabel} — ${fullUrl}`
        : `Scout do atleta ${inv.atletaNome}: ${fullUrl}`;
      const row = el('div', { 'data-invite-row': true, class: 'border border-white/10 rounded-lg p-3 bg-white/5 transition-shadow' },
        el('div', { class: 'flex items-start justify-between gap-2 mb-1' },
          el('div', { class: 'min-w-0' },
            el('div', { class: 'text-sm font-semibold truncate' },
              `${inv.atletaNome}${opponentLabel ? ' vs ' + opponentLabel : ''}`,
            ),
            el('div', { class: 'text-[11px] text-white/60' },
              [inv.atletaCategoria, fmtDate(inv.createdAt)].filter(Boolean).join(' · '),
            ),
          ),
          el('span', { class: `text-[10px] font-bold px-2 py-0.5 rounded-full border ${status.cls}` }, status.label),
        ),
        m && el('div', { class: 'text-xs text-white/70' }, renderScore(m)),
        el('div', { class: 'flex flex-wrap gap-2 mt-2' },
          !inv.matchId && el('button', {
            class: 'text-xs bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1.5 rounded',
            onClick: async () => {
              try { await navigator.clipboard.writeText(fullUrl); alert('Link copiado!'); }
              catch { prompt('Copie o link:', fullUrl); }
            },
          }, '📋 Copiar link'),
          !inv.matchId && el('a', {
            class: 'text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded',
            href: `https://wa.me/?text=${encodeURIComponent(waText)}`,
            target: '_blank',
          }, '💬 WhatsApp'),
          inv.matchToken && el('a', {
            class: 'text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded',
            href: `/scout/${inv.matchToken}`, target: '_blank',
          }, m && m.finished ? '📊 Ver relatório' : '👀 Acompanhar'),
          el('button', {
            class: 'text-xs bg-white/5 hover:bg-rose-500/30 text-white/70 px-3 py-1.5 rounded ml-auto',
            onClick: async () => {
              if (!confirm('Excluir este invite?')) return;
              try {
                await api('DELETE', `/invites/${inv.token}`);
                invites = await api('GET', '/invites');
                renderInvitesList();
              } catch (e) { alert('Erro: ' + e.message); }
            },
          }, '🗑'),
        ),
      );
      invitesContainer.appendChild(row);
    }
  }

  const main = el('main', { class: 'max-w-2xl mx-auto px-4 py-4' },
    createCard,
    invitesContainer,
  );
  mount(el('div', { class: 'min-h-screen' }, header, main));
  renderInvitesList();
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

  const filterInput = el('input', {
    type: 'text', placeholder: 'Digite o nome…',
    class: 'w-full bg-white/95 text-slate-900 border border-white/30 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder:text-slate-400',
    autocomplete: 'off',
  });
  const filteredList = el('div', { class: 'mt-2 max-h-56 overflow-y-auto space-y-1' });
  const selectedBox = el('div', { class: 'hidden mt-3 p-3 bg-rose-900/30 border border-rose-500/40 rounded-lg' });

  function normalize(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function selectAdv(a) {
    selected = a;
    selectedBox.innerHTML = '';
    selectedBox.classList.remove('hidden');
    selectedBox.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-rose-300/70 font-bold' }, 'Adversário'));
    selectedBox.appendChild(el('div', { class: 'text-base font-semibold' }, a.nome));
    if (a.categoria || a.clube) {
      selectedBox.appendChild(el('div', { class: 'text-xs text-white/70' }, [a.categoria, a.clube].filter(Boolean).join(' · ')));
    }
    filterInput.value = '';
    filteredList.innerHTML = '';
    updateServerBtns();
    submitBtn.disabled = false;
  }

  function renderFiltered(q) {
    filteredList.innerHTML = '';
    if (!q || q.length < 1) return;
    const nq = normalize(q);
    const matches = roster.filter(a => normalize(a.nome).includes(nq)).slice(0, 15);
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
    btnA.textContent = `🎾 ${inv.atletaNome.split(' ')[0]}`;
    btnO.textContent = `🎾 ${selected ? selected.nome.split(' ')[0] : 'Adversário'}`;
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
      alert('Erro: ' + e.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '▶ Iniciar tracking';
    }
  };

  // Se o coach pré-selecionou adversário, pré-preenche o slot
  if (inv.opponentNome) {
    selectAdv({
      id: inv.opponentId || null,
      nome: inv.opponentNome,
      categoria: inv.opponentCategoria || null,
      clube: null,
    });
  }

  const card = el('div', { class: 'max-w-md mx-auto p-4 space-y-4' },
    el('div', { class: 'space-y-1 text-center' },
      el('div', { class: 'inline-flex items-center gap-2 mb-1' },
        el('span', { class: 'text-2xl' }, '🎾'),
        el('span', { class: 'text-xl font-bold tracking-tight' },
          el('span', { class: 'text-white' }, 'Tennis'),
          el('span', { class: 'text-cyan-300 ml-0.5' }, 'Flow'),
          el('span', { class: 'text-white/80 ml-1.5 font-light italic text-base' }, 'Scouting'),
        ),
      ),
      el('div', { class: 'text-[10px] uppercase tracking-wider text-cyan-300 font-bold mt-3' }, 'Iniciar scout'),
      el('h2', { class: 'text-lg font-semibold' }, inv.atletaNome),
      inv.atletaCategoria && el('div', { class: 'text-xs text-white/60' }, inv.atletaCategoria),
    ),
    el('div', { class: 'space-y-1' },
      el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' }, 'Adversário'),
      filterInput,
      filteredList,
      selectedBox,
    ),
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
  filterInput.focus();
}

route();
