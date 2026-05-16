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
      el('h2', { class: 'text-xl font-semibold' }, '🎾 Tennis Flow Scouting'),
      el('p', { class: 'text-xs text-white/60' }, 'Entrar pra criar links de scout.'),
    ),
    field('email', 'Email', 'email', 'voce@email.com', 'email'),
    field('password', 'Senha', 'password', '••••••••', 'current-password'),
    errBox,
    submitBtn,
  );
  mount(el('div', { class: 'scout-grad min-h-screen flex items-center justify-center px-4' }, card));
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

  const header = el('header', { class: 'bg-slate-900/60 border-b border-white/10 px-4 py-3 flex items-center justify-between' },
    el('div', { class: 'flex items-center gap-2' },
      el('span', { class: 'text-lg' }, '🎾'),
      el('span', { class: 'font-semibold' }, 'Scouting'),
    ),
    el('button', { class: 'text-xs text-white/60 hover:text-white', onClick: onLogout }, 'Sair'),
  );

  // ===== Bloco 1: Criar invite (search incremental) =====
  let selected = null;
  const filterInput = el('input', {
    type: 'text',
    placeholder: 'Digite parte do nome…',
    class: 'w-full bg-white/95 text-slate-900 border border-white/30 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder:text-slate-400',
    autocomplete: 'off',
  });
  const filteredList = el('div', { class: 'mt-2 max-h-64 overflow-y-auto space-y-1' });
  const selectedBox = el('div', { class: 'hidden mt-3 p-3 bg-cyan-900/30 border border-cyan-500/40 rounded-lg' });
  const generateBtn = el('button', {
    class: 'mt-3 w-full bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg',
    disabled: true,
  }, '🔗 Gerar link pro scouter');
  const generatedBox = el('div', { class: 'hidden mt-3' });

  function normalize(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function selectAtleta(a) {
    selected = a;
    selectedBox.innerHTML = '';
    selectedBox.classList.remove('hidden');
    selectedBox.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-cyan-300/70 font-bold' }, 'Selecionado'));
    selectedBox.appendChild(el('div', { class: 'text-base font-semibold' }, a.nome));
    selectedBox.appendChild(el('div', { class: 'text-xs text-white/70' }, [a.categoria, a.clube].filter(Boolean).join(' · ')));
    filterInput.value = '';
    filteredList.innerHTML = '';
    generateBtn.disabled = false;
    generatedBox.classList.add('hidden');
  }

  function renderFiltered(q) {
    filteredList.innerHTML = '';
    if (!q || q.length < 1) return;
    const nq = normalize(q);
    const matches = roster.atletas.filter(a => normalize(a.nome).includes(nq)).slice(0, 20);
    if (!matches.length) {
      filteredList.appendChild(el('div', { class: 'text-xs text-white/50 px-3 py-2' }, 'Nenhum atleta — escolha "Digitar livre" abaixo'));
      filteredList.appendChild(el('button', {
        class: 'w-full text-left px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-sm',
        onClick: () => selectAtleta({ id: null, nome: q.trim(), categoria: null, clube: null }),
      }, `Usar livre: "${q.trim()}"`));
      return;
    }
    for (const a of matches) {
      filteredList.appendChild(el('button', {
        class: 'w-full text-left px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-sm flex items-baseline justify-between gap-2',
        onClick: () => selectAtleta(a),
      },
        el('span', { class: 'font-medium' }, a.nome),
        el('span', { class: 'text-[10px] text-white/50' }, [a.categoria, a.clube].filter(Boolean).join(' · ').slice(0, 40)),
      ));
    }
  }
  filterInput.addEventListener('input', () => renderFiltered(filterInput.value));

  generateBtn.onclick = async () => {
    if (!selected) return;
    generateBtn.disabled = true;
    generateBtn.textContent = '⏳ Gerando…';
    try {
      const invite = await api('POST', '/invites', {
        atletaId: selected.id,
        atletaNome: selected.nome,
        atletaCategoria: selected.categoria,
      });
      const fullUrl = `${window.location.origin}/scouting/start/${invite.token}`;
      generatedBox.innerHTML = '';
      generatedBox.classList.remove('hidden');
      const linkInput = el('input', {
        type: 'text', value: fullUrl, readonly: true,
        class: 'w-full bg-slate-800 text-cyan-200 border border-cyan-500/40 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none',
        onClick: (e) => e.target.select(),
      });
      generatedBox.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-emerald-300 font-bold mb-1' }, '✅ Link pronto'));
      generatedBox.appendChild(linkInput);
      generatedBox.appendChild(el('div', { class: 'flex gap-2 mt-2' },
        el('button', {
          class: 'flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold py-2 rounded-lg',
          onClick: async () => {
            try { await navigator.clipboard.writeText(fullUrl); }
            catch { linkInput.select(); document.execCommand('copy'); }
            generatedBox.querySelector('.copy-feedback').classList.remove('hidden');
            setTimeout(() => generatedBox.querySelector('.copy-feedback')?.classList.add('hidden'), 2000);
          },
        }, '📋 Copiar'),
        el('a', {
          class: 'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold py-2 rounded-lg text-center',
          href: `https://wa.me/?text=${encodeURIComponent(`Scout do atleta ${selected.nome}: ${fullUrl}`)}`,
          target: '_blank',
        }, '💬 WhatsApp'),
      ));
      generatedBox.appendChild(el('div', { class: 'copy-feedback hidden text-xs text-emerald-300 mt-1' }, 'Link copiado!'));
      generateBtn.textContent = '🔗 Gerar link pro scouter';
      generateBtn.disabled = false;
      // Refresh list de invites
      invites = await api('GET', '/invites');
      renderInvitesList();
    } catch (e) {
      alert('Erro: ' + e.message);
      generateBtn.textContent = '🔗 Gerar link pro scouter';
      generateBtn.disabled = false;
    }
  };

  const createCard = el('section', { class: 'bg-slate-900/40 border border-white/10 rounded-xl p-4 space-y-2' },
    el('h3', { class: 'text-sm font-semibold text-cyan-300' }, '+ Nova partida'),
    el('p', { class: 'text-xs text-white/60' }, 'Selecione o atleta e gere o link pro scouter.'),
    filterInput,
    filteredList,
    selectedBox,
    generateBtn,
    generatedBox,
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
      const row = el('div', { class: 'border border-white/10 rounded-lg p-3 bg-white/5' },
        el('div', { class: 'flex items-start justify-between gap-2 mb-1' },
          el('div', { class: 'min-w-0' },
            el('div', { class: 'text-sm font-semibold truncate' },
              `${inv.atletaNome}${m ? ' vs ' + m.opponentName : ''}`,
            ),
            el('div', { class: 'text-[11px] text-white/60' },
              [inv.atletaCategoria, fmtDate(inv.createdAt)].filter(Boolean).join(' · '),
            ),
          ),
          el('span', { class: `text-[10px] font-bold px-2 py-0.5 rounded-full border ${status.cls}` }, status.label),
        ),
        m && el('div', { class: 'text-xs text-white/70' }, renderScore(m)),
        el('div', { class: 'flex gap-2 mt-2' },
          !inv.matchId && el('button', {
            class: 'text-xs bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1.5 rounded',
            onClick: async () => {
              const fullUrl = `${window.location.origin}/scouting/start/${inv.token}`;
              try { await navigator.clipboard.writeText(fullUrl); alert('Link copiado!'); }
              catch { prompt('Copie o link:', fullUrl); }
            },
          }, '📋 Copiar link'),
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
    selectedBox.appendChild(el('div', { class: 'text-[10px] uppercase tracking-wider text-rose-300/70 font-bold' }, 'Adversária'));
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
    btnO.textContent = `🎾 ${selected ? selected.nome.split(' ')[0] : 'Adversária'}`;
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
  const adOn  = el('button', { class: 'flex-1 text-sm px-3 py-2.5 rounded-lg border-2 border-cyan-500 bg-cyan-50 text-cyan-800 font-semibold' }, 'Com vantagem');
  const adOff = el('button', { class: 'flex-1 text-sm px-3 py-2.5 rounded-lg border border-white/30 text-white/80' }, 'Sem ad');
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

  const card = el('div', { class: 'max-w-md mx-auto p-4 space-y-4' },
    el('div', { class: 'space-y-1' },
      el('div', { class: 'text-[10px] uppercase tracking-wider text-cyan-300 font-bold' }, '🎾 Iniciar scout'),
      el('h2', { class: 'text-lg font-semibold' }, inv.atletaNome),
      inv.atletaCategoria && el('div', { class: 'text-xs text-white/60' }, inv.atletaCategoria),
    ),
    el('div', { class: 'space-y-1' },
      el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' }, 'Adversária'),
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
      el('div', { class: 'text-[10px] uppercase tracking-wider text-white/60 font-bold' }, 'Vantagem no deuce'),
      el('div', { class: 'flex gap-2' }, adOn, adOff),
      el('div', { class: 'text-[11px] text-white/50' }, 'Sem ad = no 40-40 o próximo ponto decide.'),
    ),
    submitBtn,
  );
  mount(el('div', { class: 'min-h-screen scout-grad' }, card));
  filterInput.focus();
}

route();
