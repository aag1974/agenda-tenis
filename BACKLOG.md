# Backlog — Tennis Flow

Ideias e features pendentes, em ordem aproximada de prioridade.

## Priorizadas

### 1. Arquivar cards (3 pontinhos)
Adicionar a opção "Arquivar" no popover de ⋯ do card pra **sumir** o
card do quadro sem apagar dados. Casos de uso:
- Torneios irrelevantes que poluem a coluna "Inscrições Abertas"
- Histórico que não interessa manter à vista (atleta nunca jogou aquele
  circuito, perdeu o boleto e nem quer saber, etc)

**Modelo proposto:**
- Persistir `notes.archived: true` no torneio
- `getTournaments` filtra arquivados por padrão
- Toggle no menu (gear): "Mostrar arquivados" — re-exibe com badge "📦"
- Ação no popover do card arquivado: "Restaurar"
- Sync respeita: se o torneio sumir do TI, o registro fica como arquivado
  (não some de vez)

**Endpoint:** PATCH `/api/profiles/:id/tournaments/:tid/notes` aceita
`{ archived: true/false }` — já funciona, basta wirear o frontend.

### 2. Plano: gating de recursos Pro vs Free
Quando trial expirar, aplicar limites:
- Free vê só 30 dias futuros (filtrar em `getTournaments`)
- Bloquear sync auto, alertas, calendário, household pra plano Free
- Banner "Trial restante: Xd" quando faltarem ≤3 dias
- Modal "Recurso Pro" ao tentar usar feature trancada
- Cadeados visuais nos itens do menu

### 3. Histórico de ranking + gráfico de linha
Persistir snapshot da posição do ranking nacional a cada sync (se mudou).
Renderizar mini line chart no card do atleta. Bonus: capturar cortes
passados do TI no primeiro sync pra inicializar com dados reais ao invés
de gráfico vazio.

### 4. Detalhar enrich tiers em mais torneios
Hoje só ~30 torneios são enriquecidos com detalhes (hotéis/locais/tiers
completos) a cada sync. Isso causa o caso de "card mostra G1+ mas o
torneio é G1+ e GA". Mitigação atual: lazy-merge quando user abre o
modal (persiste no synced.json). Mitigação ideal: enrich incremental
até cobrir todos.

### 5. Colunas customizadas
Permitir o usuário criar colunas próprias além das 7 fixas. Arquitetura
já comporta — `notes.column` por torneio (override), `columnOrder`,
`columnLabels`, `hiddenColumns` já são persistidos via `/api/household/board-config`.

**O que precisa:**
- `state.customColumns: [{id: 'custom_xyz', label, icon}]` persistido
  na board-config do household.
- `KANBAN_COLUMNS` vira `[...DEFAULT_COLUMNS, ...customColumns]` no runtime.
- Botão "+ Criar coluna" na seção Colunas do painel de filtros, abrindo
  form simples: nome + emoji (input de texto, sugestão de 6-8 emojis
  populares: 📋 🏆 ⏰ 🎯 🔥 ⚡ 💪 🎪).
- Lixeira ao lado de cada coluna custom — deletar limpa `notes.column`
  dos cards apontados pra ela (caem pro auto).

**Trade-offs:**
- Colunas custom só recebem cards via drag/drop (sem regra automática).
  Aceitável — usuário decide o uso.
- Colunas são household-wide (todos do household compartilham), coerente
  com columnOrder/columnLabels que já são compartilhados.

Esforço: ~1h30, ~150 linhas.

### 6. Lazy enrichment "card pisca de coluna"
Ao clicar num card, modal busca detalhes (registrationOpensAt, cancelDeadline,
registrationDeadline) que podem mudar o auto-placement. Card move de coluna
visualmente. Mas ⌘+R volta tudo porque o backend só persiste `tiers` no
endpoint de detalhes (linha 4199-4203 do app.js). Resultado: experiência
inconsistente — "card sumiu da Monitorar".

**Fix proposto**: estender `fetchTournamentDetails` no backend pra também
persistir `registrationOpensAt`, `cancelDeadline`, `registrationDeadline`
quando vier no enrichment. Cuidado: precisa decidir se TI mudou o prazo
deve sobrescrever override do usuário ou não.

Detectado por user em 2026-05-08, com card "Copa das Federações 2026" indo
de Monitorar (74d futuro) → Inscrições Abertas após click.

### 7. Indicação visual da coluna na busca
Quando o usuário busca, hoje os cards aparecem nas colunas mas é difícil
saber rapidamente onde cada um está sem rolar a coluna inteira.

**Plano sugerido (1+2 juntos):**
- **Chip da coluna no card** durante busca (já existe no mobile, expandir
  pro desktop): mostra ícone+nome da coluna logo abaixo do título.
- **Contador no header da coluna** durante busca: "Inscrições Abertas · 3
  resultados" — guia o olho pra coluna com mais matches.

(3) "Dim das colunas sem match" foi descartado — estético mas não
acrescenta info que (1)+(2) não cobrem.

### 8. Home page como hub de soluções
Discutido em 2026-05-10. Hoje o app abre direto na Agenda (kanban). Com
Performance ficando muito forte e Scout no roadmap, faz sentido ter
uma **landing interna** que apresente as "soluções" do Tennis Flow e
deixe o usuário escolher onde entrar.

**Visão:**
- Tela inicial (após login + escolha de perfil) mostra cards grandes:
  - 📅 **Agenda** — torneios, inscrições, calendário
  - 📊 **Performance** — análise estatística, relatórios assinados
  - 🎯 **Scout** — adversários, head-to-head (quando implementado)
  - "+ outras soluções a serem implementadas no futuro" — placeholder
    visual reservando espaço pra próximas verticais (boletos? finanças?
    coach view?)
- Cada card resume o que tem dentro + atalho de "última atualização" /
  "novidade" (ex: "1 novo relatório entregue").
- Skip-to-default: pref do usuário pra abrir direto numa das seções
  (config no menu) — quem só usa Agenda não quer 1 clique a mais.

**Por quê:** o app deixou de ser monoproduto (agenda) e virou
plataforma. Hub torna o crescimento explícito pro usuário e reforça
percepção de valor por solução.

**Pendências de design:**
- Mobile: cards stacked vs grid 2x2?
- Onde entra "Atletas / Perfis"? Como filtro global ou seção própria?
- Entrega de relatório passa a notificar via card de Performance no hub
  (badge "1 novo") em vez de só no sino?

**Status atual** (2026-05-10): mockupado em `mockup-hub-pais.html`
(standalone, raiz). User avaliou: *"too many clicks to nothing"* —
adicionar uma tela hub antes do Kanban da Agenda gera fricção de
navegação sem entregar valor proporcional. **Adiado**. Revisitar quando
o portfólio de soluções (Performance, Scouting, Escola) ficar denso a
ponto do hub justificar 1 clique extra. Mockup fica guardado pra essa
hora.

## Tennis Flow Escola — visão de longo prazo

Discutido em 2026-05-10. O app já tem 80% da arquitetura pra suportar o
caso de uso de **escola/academia**: household, perfis múltiplos, roles
(admin/editor/viewer), push, alertas, Performance e Scout. A evolução
natural é empacotar tudo numa SKU **Coach/Escola** quando tiver tração
B2C com famílias.

**Princípio guia:** "previsibilidade traz confiança" (declarado pelo
user em 2026-05-10, ver `feedback_previsibilidade.md` em memory). O app
ganha adoção respondendo dúvida operacional **antes** de a família
precisar ligar na recepção — não com features bonitas. Aplicar em todo
design, copy e cadência.

**Validação feita** (2026-05-10): análise de ~6k mensagens de grupo
real de WhatsApp de uma escola de tênis (Dumont) mostrou os padrões:
- 80% das mensagens são Q&A operacional curto (mudança de quadra,
  horário, "vai ter aula?"). Reposta rápida no app substituiria o grupo
  de WhatsApp e seria o gancho de adoção.
- Mudança de quadra/local é o tipo de aviso mais frequente (quadras do
  clube principal bloqueadas → divide entre 2-3 instalações alternativas).
- Decisões last-minute são comuns ("avisamos pela manhã").
- Inscrições com prazo apertado precisam de push agressivo.
- Reconhecimento público (parabéns por torneio) é categoria à parte.

**Mockup:** `mockup-escola.html` na raiz (standalone, fora do
`frontend/` pra não vazar pro Render). Tem visão geral, atletas,
colaboradores, torneios com Kanban específico (atletas inscritos,
professores escalados, hotel, passagens "escola paga vs família compra",
logística), comunicação rica e quadros livres. Aberto pra iteração.

**Verticais sugeridas pro hub** (item 8 acima evolui pra isso):
- 📅 Agenda · 📊 Performance · 🎯 Scout (atual)
- 🏫 **Escola** — gestão de atletas/colaboradores/turmas/torneios da
  academia, comunicação push pros pais, financeiro
- 👨‍🏫 **Coach** (sub-tier) — profissional autônomo com 5-15 alunos de
  famílias diferentes (não tem CNPJ de escola). Versão lite da Escola.

**⭐ Estratégia de aquisição via autocoleta TI** (insight-chave 2026-05-10):

Inverte o fluxo padrão "escola pede ficha → pai preenche papel → secretaria
digita → erro de cadastro" pra "pai se cadastra no Tennis Flow com email/
senha do TI → aceita compartilhar com a escola → escola recebe cadastro
completo automaticamente". Sem formulário, dado correto, escola monta o
CRM da noite pro dia.

**Mecânica:**
1. Escola decide adotar Tennis Flow → recebe link de convite branded.
2. Pai entra no Tennis Flow, faz login com email/senha do TI (fluxo já
   existe: `syncAthlete({email, password, ...})`).
3. App pede consentimento explícito — toggle: *"Compartilhar dados de
   {atleta} com Dummont Tennis Team"* — texto LGPD claro listando o que
   é compartilhado e por quê.
4. Pai aceita → escola passa a ver, no painel dela: cadastro completo
   do atleta, ranking, jogos, torneios inscritos, próximos boletos.
5. Pai pode revogar a qualquer momento (config do perfil).

**O que precisa tecnicamente:**
- [ ] **Investigar URL/HTML do TI da área autenticada** que mostra o
      cadastro completo do atleta (provavelmente `/perfil2/dados-pessoais/`,
      `/atleta/cadastro/{id}` ou via página de inscrição). Mapear quais
      campos vêm: CPF, nascimento, telefone, email, endereço, responsável,
      convênio.
- [ ] **Estender `scraper.js`** com `fetchAthleteCadastro(client, athleteId)`
      que parseia esses campos. Cliente já está autenticado pelo
      `syncAthlete`, então só precisa de mais 1 GET.
- [ ] **Schema do profile** ganha bloco `cadastro: { cpf, nascimento,
      telefone, email, endereco, responsavel, convenio, … }`. Criptografado
      em disco como já é o `tiPassword` (LGPD).
- [ ] **Toggle de compartilhamento** por escola — no perfil do atleta,
      lista de escolas vinculadas + status (compartilhando / pendente /
      revogado). Persistir em `profile.shares: [{ schoolId, scope, ... }]`.
- [ ] **Endpoint admin da escola** `GET /api/school/:id/atletas` — lista
      cadastros completos dos atletas que consentiram compartilhar.
      Filtra automaticamente quem revogou.
- [ ] **Auditoria** — registro de quem acessou qual cadastro, quando.
      Exportável pra LGPD.

**Por que isso é o gancho de adoção da Escola:**
- **Zero atrito**: pai não preenche nada além do login do TI que já tem.
- **Dado certo**: vem do TI, sem digitação errada, sem desatualização —
  ranking e categorias atualizam automático em cada sync.
- **Reutiliza investimento**: a escola que paga TF tem CRM, comunicação,
  ranking, jogos, performance — tudo num lugar só, sem integração extra.
- **Valor claro pro pai**: ele entra na plataforma pra usar o app
  (Performance, Agenda, push de avisos da escola) — compartilhar é
  natural, não custo separado.
- **LGPD limpa**: dado é do próprio pai (autocoleta da conta dele), e
  o compartilhamento é consentimento explícito, granular, revogável.

**Risco / mitigação:**
- HTML do TI muda → scraper quebra. Mitigação: alerta no painel admin
  da escola quando algum campo "some" no scrape, ela continua usando o
  que já tem em cache.
- Pai não compartilha → escola não tem o cadastro daquele atleta.
  Mitigação: composer da escola pode mandar lembrete no app + email
  pedindo compartilhamento.
- Dado sensível em mãos da escola → criptografia em disco + ACL +
  auditoria + termo escola↔Tennis Flow assinado na contratação.

---

**Stack de features pra MVP de Escola** (em ordem de valor/esforço):
1. **Comunicação push** — composer com tipos pré-definidos, audiência
   segmentada (escola toda / turma / viagem / atleta), histórico com
   taxa de leitura, Q&A 2-vias (pai pergunta, escola responde inline).
   Validar primeiro — é o gancho de adoção.
2. **Agenda da escola** — calendário consolidado de torneios + treinos
   + reuniões + eventos. Push com lead time configurado.
3. **Atletas (CRUD multi-perfil)** — listagem da escola toda, com
   categoria/ranking/professor/responsável. Já existe parcialmente.
4. **Torneios com Kanban de logística** — colunas por torneio: atletas
   inscritos, professores escalados, hotel, passagens, logística no
   local. Diferencia "escola paga" (passagens dos profs) vs "família
   compra" (passagens dos atletas).
5. **Colaboradores** — CRUD de professores/staff, vínculo a turmas e a
   atletas, agenda própria.
6. **Quadros livres** — Kanban genérico tipo Trello pra qualquer
   assunto interno (reforma, captação, eventos sociais).
7. **Turmas** — horários, atletas matriculados, presença, professor.
8. **Financeiro** — mensalidades, boletos, despesas com torneios,
   recebíveis. (Pesado — adiar até validar 1-3.)

**Modelo de negócio sugerido:**
- Free pra famílias (mantém atual).
- Pro pessoal R$297 vitalício (mantém — promessa de fundador).
- **Coach autônomo** R$497-697/mês — múltiplos atletas + dashboard
  agregado.
- **Escola/Academia** R$1.5k-3k/mês conforme volume — multi-coach,
  comunicação push pra pais, financeiro, branding próprio.

**Próximos passos** (não fazer agora — esperar tração com famílias):
- [ ] Validar interesse com 1-2 escolas (Dummont, Iate) sem prometer
      data — entrevista, não venda.
- [ ] Mockup → iterar com escola interessada (anotar ajustes).
- [ ] **Investigação técnica TI**: qual URL/HTML expõe o cadastro
      completo do atleta na área autenticada do pai? Pré-requisito
      pra estratégia de autocoleta acima.
- [ ] Decidir se Comunicação Escola é vendida standalone (R$ baixo,
      adoção fácil) ou só dentro de tier Escola.
- [ ] Schema cross-household (coach vê atletas de N famílias) — hoje
      household = família única, evolução grande.

**Risco principal:** começar a desenhar pra escola agora **dilui** o
foco em famílias. Manter Performance + Scout como prioridade até ter
volume validado, e só então puxar Escola.

Esforço estimado: ~1 dia (UI + roteamento + persistência da preferência
default-route no household-config).

## Performance Analytics — roadmap (visão "Wow")

Discutido e iniciado em 2026-05-08. Pivot estratégico: o user (estatístico) quer
relatório de nível profissional, não dashboard de loja. Mira: rivalizar com
Golden Set Analytics (GSA) na camada **macro** (nível de jogo), já que GSA é
inacessível a juvenil brasileiro.

### Edge cases conhecidos do scraper de matches
- **Torneios por equipes (Interclubes)**: TI lista todos os atletas escalados
  pelo clube como "tendo jogo agendado" mesmo se não jogaram. Aparecem como
  W.O. (sem score) na lista de jogos. User confirmou que Anna NUNCA tomou
  W.O. real, então esses entries são "fantasmas" do TI.
  **Fix Phase 2**: filtrar `wo: true` das análises principais (Glicko, win
  prob). Surface separadamente com flag.
- **Nomes de duplas truncados**: às vezes vem "Nome/" com partner vazio (ex:
  "Amelie Abreu/") quando TI perde dado da partner. Não é bug nosso — é
  lacuna de dados.
- **Filtro de ano do TI**: a página `/perfil2/jogos/{id}` IGNORA `?ano=Y` no
  GET — sempre devolve ano corrente. Filtro real é POST com form-data
  `ano=Y`. Sem isso, scraper retornava 23 matches × 3 anos = 69 entries
  duplicadas. Fixado em 2026-05-08.

### Fase 1 — Foundation ✅ feito (2026-05-08)
- Scraper `/perfil2/jogos/{id}?ano=Y` em `backend/match-scraper.js`
- 1 GET por ano. Backfill 3 anos = 1-2s. Endpoint público no TI, sem auth.
- Storage `matches.json` com `upsertYearMatches` (idempotente)
- Sync-manager decide anos (ano atual sempre + 2 anteriores se nunca scrapeados)
- Endpoint `GET /api/profiles/:id/matches`
- UI placeholder: modal "Histórico de jogos" no card do atleta — agrupado
  por torneio com V/D dot, round, oponente(s), score.
- **Validação**: counts batem 100% (9V/14D em 2026 vs widget Desempenho).
  Sets/games divergem ±5% por formatos exóticos (match-tiebreak only,
  super-tiebreak no 3º set, WO sem score) — toleramos pois Glicko só usa W/L.

### Fase 2 — Skill rating Bayesiano (próxima)
- Glicko-2 puro JS (~200 linhas) com volatilidade σ
- Update a cada match cronologicamente
- Sparkline temporal do rating ±2σ
- "Expected vs Realized" — quantos jogos a Anna deveria ter vencido dado os
  ratings dos oponentes? Forest plot por torneio.
- Destaque "Maior surpresa positiva/negativa"

### Fase 3 — Predição
- Logistic regression `P(W | rating_diff, ganhou_1º_set, em_DF, dias_descanso, round)`
- Calibration plot (reliability diagram) + Brier score
- Monte Carlo de chave futura: 10k simulações, P(QF), P(SF), P(F), P(Campeã)
- Cartões por adversário na chave: `vs X (R32) — P(W)=73%`

### Fase 4 — Análise temporal + Markov
- Decomposição STL (trend + seasonality + residuals) do win rate
- EWMA de forma com half-life ajustado experimentalmente
- Runs test (Wald-Wolfowitz) — testa se streaks são significativas vs ruído
- Markov state diagram: `1set_W` → `Win_in_2`, transições visualizadas
- Diagnóstico tático: "P(reverter | perdeu 1º set) = 12%"

### Fase 5 — Polish + distribuição
- PDF coach-friendly 1 página A4 (Puppeteer ou print CSS)
- Export CSV/JSON: `/api/analytics/{athleteId}/dataset.csv`
- Workbench interativo com filtros (ano, tier, UF, oponente)
- Survival curves Kaplan-Meier por tier

### Fase 6 — Scout ao Vivo (IMPLEMENTADO 2026-05-10)

Tracking ponto-a-ponto durante torneios, padrão internacional iOnCourt.
Implementado em 1 sessão de trabalho — entregue em produção.

**O que está em produção:**

✅ **Engine de pontuação** (`backend/tennis-score.js`, 38 testes):
- best_of_3 · best_of_3_stb · one_set_match_tb · pro_set_8
- Ad ou no-ad, super-tiebreak no 3º set
- Saque automático (troca a cada game, alternância no tiebreak)
- Score em tempo real (game · set · match), undo via replay

✅ **Modelo iOnCourt em 2 fases**:
- Fase SERVE (4 server + 3 returner): Ace · Service Winner · 1st Serve
  Fault · Double Fault · Return Winner · Return Error · Return in Play
- Fase RALLY (3 Anna + 3 Opp): Winner · Forced Error · Unforced Error
- Markers (1st Serve Fault, Return in Play) registram estado sem fechar
  ponto, permitindo derivar % 1º saque, pts no 1º/2º saque, etc.
- Banner de fase: "Anna serving · 1st serve" / "2nd serve" / "Rally"

✅ **Cores fixas por jogador** — Anna cyan (#0891b2), Opp rose (#e11d48).
Não usa gradient por valor (verde/amarelo/vermelho).

✅ **Nota técnica 0-10** (`backend/match-score.js`, 7 testes):
- 25% % pts ganhos · 25% saldo ofensivo · 25% % sacando · 25% % recebendo
- Calculada pros 2 lados (Anna e adv). Peso redistribui se um componente
  falta dados.
- Aparece como 1ª linha da tabela de Stats, destacada.

✅ **Tabela de Stats padrão iOnCourt** (em inglês): Aces · Double Faults
· Service Winners · 1st Serve % · 1st Serve Pts Won · 2nd Serve Pts Won
· Return Winners · Return Errors · Winners · Forced Errors · Unforced
Errors · Total Pts Won.

✅ **Momentum visual** — barras ±1 ponto-a-ponto (Anna acima, adv abaixo).
Escala adaptativa: cabe em qualquer largura sem scroll horizontal.
Contagem total visível no header (Anna · Adv · total N).

✅ **Notas qualitativas** — composer com texto + tag (técnico, tático,
físico, emocional). Timestamp + snapshot do placar do momento. Dono
adiciona/exclui, scouter público adiciona. Voz e sugestões automáticas
contextuais ficaram pra futuro.

✅ **Link público (sem login)** — 1 token por papel:
- **Scout token**: marca pontos. Expira no encerramento do match.
- **Viewer token**: lê tudo (placar + stats + nota + momentum + notas).
  **Nunca expira** — o mesmo link mandado durante o jogo serve como
  relatório depois. 1 link só, semântica unificada.
- Tela do scouter: tracking funcional. Tela do viewer: read-only com
  polling 5s ao vivo, congela quando match encerra.

✅ **Distribuição** — UI de "Copiar link do match" inline no card de
match encerrado. Sem 2 telas, sem "gerar relatório" separado.
WhatsApp/mailto pré-formatados no modal de share durante o jogo.

✅ **Endpoint legacy** `/match-report/<id>` (snapshot HTML estático) —
gerado pré-unificação. Continua servindo URLs antigas. Novos matches
não geram mais.

**Stats: 3/3 suites passam** (38 tennis-score + 7 match-score + 54 tier
detect). SW versão 0.9.65.

---

### Fase 7 — Cap 8 do relatório de Performance (FUTURO)

Adiada pra quando houver volume mínimo de scouts acumulados (~5-15
matches scoutados). Antes disso é estatística com ruído demais.

**O que abre quando tiver volume:**
- **Pontos críticos** — % pts ganhos em deuce, 0-30, 30-30, BP contra.
  Mostra onde a atleta cede sob pressão.
- **Padrão por contexto** — vs atletas mais ranqueadas, em saibro vs
  duro, 1º vs 2º jogo do dia.
- **Estilo do jogo** — proporção winners/UEs ao longo do tempo, padrão
  por set (derrete no 2º? aguenta no 3º?).
- **Tendência da nota 0-10** — média móvel últimos N matches com bandas
  de confiança. Coach paga pra ter esse tipo de leitura.
- **Comparativo com histórico** — nota técnica vs média histórica da
  própria atleta (não vs benchmark genérico).

Threshold: 5 scouts pra estatísticas pontuais aparecerem (com aviso
"amostra pequena"); 10-15 pra entrar como capítulo firme do relatório.

**Não fazer agora — esperar uso real em torneios.** Quando Anna tiver
~5 jogos scoutados, revisitar. Sem volume, não vale o esforço.

---

### Latente pra Scout (futuro, baixa prioridade)

- **Voz nas notas qualitativas** — gravação curta (10s) + transcrição
  (Whisper API ou similar). Mais natural que digitar no celular durante
  o jogo.
- **Sugestões automáticas contextuais** — chip pequeno "💡 anotar
  pressão no saque?" quando app detecta padrão (3 DFs seguidas, etc).
- **Email SMTP automatizado** — hoje usa mailto (cliente do dono). Pra
  envio em massa (ex: agendado semanal pra coach), precisa SMTP.
- **Endpoint do TI pra chave do torneio em curso** — preencheria adver-
  sária do dia automático na criação do match (em vez de o user digitar).
  Pré-requisito também pra Performance/Scout futuros.

### Bonus / Extensões futuras
- **Scouting cross-user (rede)**: lookup `/api/scouting/athlete/{tiId}` que
  consulta matches em todos os profiles do household. Modelo de rede
  alimentado por todos os usuários cadastrados. Identidade canônica =
  `athleteId` do TI. Risco LGPD: tratamento de dados de menores sem
  consentimento dos adversários — exige opt-in mútuo.
- **Multilevel/hierarchical model** (atletas nested em categoria/tier) quando
  houver volume.
- **Bradley-Terry model** pra ranking transitivo no universo da Anna.
- **Tipo de conta "Coach"**: treinador sem atleta, vinculado como Editor aos
  perfis dos alunos.

**Volume**: backfill total ~3 GETs (3 anos), ~1-2s. Cache forever após
torneio terminar.

**Insight chave**: dataset alimenta TODAS as análises — scrape uma vez,
calcula tudo localmente. GSA opera no shot-by-shot (vídeo + tracking). Nós
no game-by-game (placar + contexto). Camada diferente, mas ainda inédita
no mercado juvenil BR.

**Validação pendente Fase 1** (a fazer no próximo teste local):
- [ ] Quantidade total de matches faz sentido? (~37 esperados)
- [ ] Scores batem com perfil TI?
- [ ] Oponentes/IDs corretos?
- [ ] Nada faltando ou duplicado?
- [ ] UI sem quebra mobile/desktop?

**Arquivos tocados na Fase 1**: `backend/match-scraper.js` (novo),
`backend/scraper.js`, `backend/sync-manager.js`, `backend/storage.js`,
`backend/server.js`, `frontend/app.js`. Novo: `data/profile-{id}/matches.json`.

## Dupla checagem dos dados do Tênis Integrado

Insight crítico do user (2026-05-08): **o TI pode errar a categorização das
partidas**. Caso real: o G1 de Belo Horizonte (24/04/2026) — Anna jogou
SIMPLES e DUPLAS no mesmo evento. A partida de simples (vs Luiza Reis)
apareceu no bloco do torneio de duplas, com tier "12FD" (categoria de
duplas). Resultado: nosso parser inicial classificou como duplas — mas o
nome do oponente era "Luiza Reis" (1 nome só, sem `/`).

**Correção aplicada**: parser agora identifica simples vs duplas pelo
formato do nome (`/` = duplas), ignorando o tier do torneio.

**Próximo nível de validação a construir**:
1. **Reconciliação com widget Desempenho do TI** — o /perfil2/inicio/
   mostra "X jogos no ano". Se nossa contagem divergir, flag e alerta.
2. **Cross-check com /perfil2/programa/** — partidas marcadas mas não
   disputadas devem casar com nossos W.O.s.
3. **Auditoria visual no relatório** — seção "Anexos" com matches
   "suspeitos" (categoria 12FD com nome simples, etc) pra revisão manual.
4. **Source of truth ranking** — quando ranking CBT da atleta divergir
   significativamente do que esperaríamos pelos pontos calculados, alerta.

Princípio orientador: **TI é fonte primária mas falível**. Tennis Flow
tem que detectar inconsistências e dar transparência ao usuário, não
propagar erros silenciosamente.

## Estratégia de tier — análise marginal de pontos no ranking

Insight estratégico do user (2026-05-08): o ranking CBT 12F é composto pelos
**4 melhores torneios** da atleta. Cada tier dá pontuação diferente:
- G3: campeã ~50 pts, finalista ~30, SF ~20, R16 ~10
- G2: campeã ~80 pts, finalista ~50, SF ~30, R16 ~15
- G1: campeã ~120 pts, finalista ~80, SF ~50, R16 ~25
- GA+: campeã ~200 pts, finalista ~120, SF ~80

**A consequência tática**: depois que a atleta tem 4 torneios bons em G3, o
**5º G3** só agrega valor se for melhor pontuado que o pior dos 4 atuais. Se o
"piso" da Anna é 30 pts, vencer um G3 (=50 pts) troca por +20. Mas chegar a
QF de G2 (=25 pts) NÃO troca (abaixo do piso).

**Implicação**: quando atinge teto em G3, é hora de subir pra G2/G1. Continuar
em G3 vira "desgaste sem ganho de ranking" — gasto de tempo e dinheiro com
retorno marginal zero.

**Como incrementar o relatório (e Travel ROI):**
1. **Tabela oficial de pontuação CBT 12F** — pesquisar/scrapeai do site da CBT
2. **Pontos retroativos por torneio da atleta** — derivar da última partida
   disputada (a fase máxima atingida = pontos ganhos)
3. **Top 4 contando pro ranking atual** — somar os 4 maiores
4. **"Piso" = menor dos 4** — número-chave da análise marginal
5. **Análise prospectiva** — pra cada torneio futuro no calendário, qual o
   ponto **esperado** baseado em rating Glicko da chave + tier × fase, e se
   isso troca o piso
6. **Recomendação tier-up**: "Anna já maximizou ganhos em G3 — próximos
   investimentos devem ser G2/G1. Mesmo perder R1 em GA+ entrega exposição
   estatística mais valiosa que ganhar G3 do bairro."

**Capítulo novo no relatório**: "Estratégia de tier — onde investir os
próximos torneios". 5-7 páginas. Tabela de pontos, breakdown dos 4 atuais,
recomendação prospectiva.

**Estimativa**: 3-4h (depende de ter a tabela CBT disponível).

**Conexão com Travel ROI**: este cálculo ALIMENTA o "vale a pena viajar"
— viagem cara pra G2 fora do estado tem ROI alto se trocar piso por +30
pts; G3 perto de casa tem ROI baixo se piso já estiver alto.

## Travel ROI — apoio à decisão dos pais sobre quando viajar

Insight do user (2026-05-08): pra família de juvenil, a maior dor é decidir
quando vale a pena viajar pra torneio. Custo é alto (passagem, hotel, taxa
inscrição, alimentação) e "viajar pra perder na 1ª rodada" vira turismo
caríssimo. Pais oscilam entre subestimar (kid perde oportunidade de
crescer) e superestimar (gasto sem retorno).

**Tennis Flow pode ajudar SEM depreciar a atleta** — o framing é crucial.
Não é "seu filho não vai ganhar, economize" — é "veja o que pode esperar
realisticamente, e meça sucesso pelo critério certo".

### Métricas a oferecer pra cada torneio futuro

1. **Probabilidade de avançar por rodada** (Monte Carlo da chave usando
   Glicko da Anna + ratings dos inscritos):
   - P(passa R1), P(QF), P(SF), P(F), P(Campeã)
   - Exemplo: "70% chance de jogar R2; 25% chance de QF; 5% de SF"

2. **Pontos esperados no ranking CBT** (E[pontos] = ΣP(rodada) × pontos
   da rodada). Output: "Expectativa de 12-18 pontos na trip"

3. **Nível de competição** (rating médio dos inscritos). Output: "Esse 
   torneio te coloca contra rating médio 1450 — 175 acima do seu — é
   torneio 'esticador', ótimo pra desenvolvimento mas resultado curto."

4. **Histórico em torneios similares** (mesmo tier + região + tamanho).
   "Em G3 fora do DF, você tem 40% de aproveitamento. Vs 50% em casa."

5. **Categorização do torneio**:
   - **Confronto** — torneio onde você briga por título (rating dela ≈ rating médio)
   - **Crescimento** — você é o "azarão" mas vai ganhar exposição (rating dela < média -100)
   - **Confiança** — torneio onde você é favorita (rating dela > média +100), bom pra fechar pontos
   
6. **"Custo por jogo"** — orientativo: dado o custo da viagem informado
   pelo user, custo dividido pelo n esperado de partidas. "$2000 por 3
   jogos esperados = $670/jogo. É caro, mas o cabeça-de-chave 4 da chave
   é a Letícia (rating 1480) — referência rara em DF."

### Como NÃO depreciar
- Sempre framar como "decisão informada", não "previsão de fracasso"
- Mostrar valor além de pontos (exposure, learning, fitness)
- Comparar com benchmarks da CATEGORIA, não com ideal absoluto
- Incluir histórias positivas: "5 das suas últimas vitórias inesperadas
  foram em torneios fora de casa — viajar abre a janela pro azar bom"
- Linguagem: "decisão de família", "o que esperar", "como medir sucesso"

### Implementação técnica
- Pré-requisito: scraper da chave do torneio (`/torneio_painel_chave/...`)
  pra obter lista de inscritos com IDs
- Glicko-2 cross-user (já no roadmap de scouting) pra ter rating dos
  oponentes; OU usar ranking CBT como proxy de rating quando atleta
  não está no nosso sistema
- UI: card "Análise da viagem" no modal do torneio, com seção destacada
  "Recomendação"

### Quando tem mais sentido entregar
Depois das Fases 2-3 do report (Glicko + Predição + Monte Carlo) — porque
todos os ingredientes estarão prontos. Estimativa: ~3-5 dias de UI + alguns
ajustes no scraper.

### Relação com modelo de monetização
Pode ser feature **PRO** que sustenta o pitch: "R$297 te economiza 
um deslocamento ruim" — facilmente mais que paga o ano.

## Renomear serviço Render (cleanup do nome `agenda-tenis-integrado`)

Render confirmou (2026-05-08) que **o slug `.onrender.com` não pode ser
renomeado depois da criação**. Opções:

**A) Recriar serviço como `tennis-flow.onrender.com`** — exige migrar disco
persistente (`data/` com users, profiles, matches, comprovantes), re-config
env vars (VAPID, DATA_SECRET, ADMIN_TOKEN), reapontar 4 custom domains,
atualizar render.yaml, cutover com downtime curto. ~2-4h trabalho + risco
de data loss.

**B) Manter atual** — cleanup já cobriu o que é user-facing (SW cache, iCal
UIDs, PRODID, comentários, banner boot). Único leak restante é o CNAME
público que resolve pra `agenda-tenis-integrado.onrender.com`, visível só
via `dig www.tennis-flow.com.br`. Mitigação: desligar toggle "Render
Subdomain" na tela de Custom Domains pra `.onrender.com` retornar 404.

**Decisão atual (2026-05-08)**: Opção B. Migrar quando:
- For fazer marketing público de larga escala
- Receber email do TI pedindo explicação
- Hit 50+ usuários e quiser higiene operacional

## Performance / produção

### Pré-compilar Tailwind (sair do CDN)
Hoje usamos `<script src="cdn.tailwindcss.com">` que compila CSS em
runtime. Console mostra warning "should not be used in production".
Pra polir antes do lançamento comercial:
- Adicionar tailwindcss como devDependency
- Build step no Render: `npx tailwindcss -i in.css -o styles.css --minify`
- Trocar `<script>` por `<link rel="stylesheet">`
- Reduz ~3MB JS → ~30KB CSS, melhora Lighthouse e first paint

## Painel administrativo

Conforme o app crescer (múltiplos usuários, suporte), precisamos de uma
interface de admin pro alexandre@opiniao.inf.br controlar e corrigir
problemas que os usuários enfrentam. O que entra:

- **Reset de quadro** (movido pra cá em 07/05/2026): "Resetar movimentações"
  e "Resetar tudo" — endpoints já existem (`/api/profiles/:id/reset-board-overrides`
  e `/api/profiles/:id/reset-all`), só foram tirados do menu do usuário comum
  porque o impacto destrutivo é alto pra quem não entende. No painel admin,
  ficam disponíveis pra qualquer profileId mediante seleção.
- **Listar usuários** (households + profiles), data de cadastro, último login,
  status do plano (trial/free/pro), data de expiração do trial.
- **Forçar upgrade manual de plano** (após receber Pix) — hoje precisa
  editar JSON. Botão "Marcar como Pro vitalício" no admin.
- **Re-enviar email de boas-vindas / reset de senha** quando suporte demandar.
- **Logs de sync por perfil** — debug rápido de "minha sync travou".
- **Gating do acesso**: só email do admin (`alexandre@opiniao.inf.br`)
  vê a rota `/admin`. Middleware backend valida.

Não precisa ser bonito — funcional pra atender suporte.

## Ideias soltas

- Login com Google (OAuth)
- "Esqueci minha senha"
- Pull-to-refresh no mobile
- Dark mode toggle
- Gráfico de gastos com torneios por mês (a partir dos comprovantes)
- Sugestões de viagens compartilhadas (atletas indo pro mesmo torneio)
- Integração com Strava/MyCoach pra correlação treino × torneio
