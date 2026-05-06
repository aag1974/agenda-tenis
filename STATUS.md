# Status do projeto — última atualização

Snapshot pra retomar o trabalho em qualquer máquina. Atualizado em 06/05/2026.

## Onde rodando

- **Produção (24/7):** https://agenda-tenis-integrado.onrender.com
- **GitHub:** https://github.com/aag1974/agenda-tenis (branch `main`)
- **Último commit:** `07086a3` — Kanban Fase 1.3: frontend board com SortableJS + paleta TI
- **Plano Render:** Starter (US$ 7/mês) — necessário pelo disco persistente em `/opt/render/project/src/data`
- **Auto-deploy:** push em `main` dispara deploy automático no Render
- **Service Worker cache:** `agenda-tenis-v33` (frontend/sw.js)

## Arquitetura

- Backend Node Express + scraper HTTP-only (cheerio), auth scrypt + cookie HMAC, storage criptografado AES-GCM
- Frontend SPA + PWA (manifest.webmanifest + sw.js)
- Auto-sync interno a cada 6h pra perfis com torneios estrelados nos próximos 90 dias
- iCal feed em `/calendar/<token>.ics` com eventos de torneio (alarme 7d antes) e boleto (alarme 1d antes)
- **Tela principal: Kanban com 7 colunas** (substituiu a lista cronológica em 06/05)

## Pivot do Kanban (decisões 06/05)

App pivotou de "lista cronológica" pra **quadro Kanban estilo Trello** com paleta visual do Tênis Integrado (navy escuro + cyan/azul). Decisões registradas:

- **7 colunas fixas** no MVP: Inscrições abertas → Torneios → Vou jogar → Pagar inscrição → Confirmado → Viagem comprada → Histórico
- **Auto-placement** baseado em estado (TI manda); usuário pode arrastar livremente entre colunas, override persiste
- **Histórico sempre força** (passados sempre vão pra Histórico, mesmo com override)
- **Card pequeno (4-5 linhas)** com tarjas coloridas (uma por tier), badges curtos (boleto, inscrito, etc.), nome, cidade, relativo, estrela
- **Multi-categoria do atleta**: scraper detecta Juvenil/Pro/Senior/Beach/Kids via rankings na página de perfil; sync paralelo das categorias detectadas
- **Sem mobile** no MVP — foco desktop. Mobile fica pra Fase 2.

## Cor por estado (do mais antigo, mantido no Kanban)

- 🟡 Amarelo: boleto pendente, prazo futuro
- 🔴 Vermelho: boleto vencido (`pendingPayment.dueDate < hoje`)
- 🌸 Rosa: inscrito + passado
- 🟢 Verde: inscrito + futuro/presente
- ⚫ Cinza: inscrições encerradas + não inscrito (`registrationStatus = encerrad…` ou `cancelDeadline < hoje` ou início < hoje)
- ⚪ Branco: default

## Features adicionadas nesta sessão (06/05, em ordem cronológica)

1. **Estados novos** (commit `134206b`): cinza (🔒 Inscrições encerradas), vermelho (❌ Boleto vencido), pílula azul "🆕 Novo" pra torneios novos no sync
2. **🆕 ícone-only + detector de migração** (`ba45034`): pílula virou só emoji `🆕`; lógica detecta clusters de `firstSeenAt` em janela 5min e zera tudo (= sync de baseline)
3. **Badge ✓ inscrito também no card** (`3e1cc82`): replicado do modal pro card
4. **Comprovantes redesign** (`e807b38`): substitui o fluxo "criar nota no iOS" por **galeria server-side**:
   - 5 categorias: 🍽️ Alimentação, 🚕 Transporte, 🏨 Hospedagem, 💰 Inscrição, 📋 Outros
   - Upload via câmera ou galeria do celular, compressão client-side (1600px max, JPG 80%)
   - Quota 200MB por usuário (com aviso aos 150MB)
   - Cleanup automático: torneios com `endDate + 90 dias` no passado têm comprovantes apagados
   - Aviso âmbar a partir de 14 dias antes do arquivamento
   - Botão "📤 Exportar zip" (archiver) com pastas por categoria
   - Endpoints: list, upload, view, patch (categoria), delete, exportar zip, quota info
5. **Kanban Fase 1.1 — backend foundations** (`d3adc47`): 
   - `backend/board.js`: 7 colunas, `computeAutoColumn`, `effectiveColumn`, `diffTournamentForActivity`
   - `backend/storage.js`: `setCardColumn`, `addCardComment`, `getCardActivity`, `addAutoActivity`
   - Endpoints: GET `/board/columns`, GET `/profiles/:id/board`, PATCH `/column`, GET `/activity`, POST/PATCH/DELETE `/comments`
   - Sync-manager: diff entre snapshots gera atividade automática (boleto detectado, pagamento confirmado, etc.); skip durante baseline establishment
6. **Kanban Fase 1.2 — multi-categoria** (`0aaa9e3`):
   - `TI_CATEGORIES` exportada (Juvenil=2, Profissional=17, Senior=5, Beach=24, Kids=29)
   - `getAthleteInfo` lê rankings e identifica via regex
   - `syncAthlete` busca todas categorias detectadas em paralelo (Promise.all)
   - Pra Anna (Juvenil) → comportamento idêntico, 1 categoria
7. **Kanban Fase 1.3 — frontend board** (`07086a3`):
   - SortableJS via CDN
   - `body.kanban-mode` com paleta TI (navy + dark theme no header)
   - `renderKanban` substituiu `renderTimeline` em `render()`
   - Card Trello-style (tarjas coloridas, badges curtos, scroll snap por coluna)
   - Drag-drop wired no PATCH `/column`, otimista no client

## Fases pendentes do Kanban

- ⏳ **Fase 1.4 — Modal Trello-like** (~3h): redesenho do modal de detalhes com layout Trello (capa, dropdown coluna, etiquetas auto, datas com countdown, checklist fixo de 5 itens auto-marcados pelo TI, painel de atividade + comentários manuais)
- ⏳ **Fase 1.5 — Polish + migração** (~2h): "de-para" de notas existentes, mobile fallback ("use desktop por enquanto"), limpeza de código morto da timeline antiga

## Decisões pra Fase 2 (não MVP)

- Etiquetas customizáveis (criar/aplicar com cor + nome)
- Checklist com itens custom
- Multi-board (vários quadros por usuário, ex: 1 por filho)
- Reordenar colunas
- Mobile (lista vertical ou versão simplificada do Kanban)
- Capa do card via Google Places API ou similar

## Próximos passos pendentes anteriores (não bloqueantes)

- Investigar divergência de gênero — strings hard-coded no masculino. Pais de meninas usando o app vão precisar ajustar pontualmente.
- Possível futuro: aba "Resultados" com placares dos jogos (já tem código Python que extrai isso, falta portar pra Node).

## Como retomar

```bash
cd "~/Library/Mobile Documents/com~apple~CloudDocs/Pessoal/Anna Luiza/agenda-app"
git pull              # garantir que está em 07086a3 ou mais novo
git log --oneline -5  # confirma últimos commits
```

Não precisa de `node`/`npm install` localmente — o Render cuida disso. Edição direta nos arquivos JS, commit + push, Render redeploys em ~2 min.

Pra testar mudanças no celular, sempre bumpar `frontend/sw.js` cache version (`agenda-tenis-vN`).

**Pra retomar o Kanban:** próxima é Fase 1.4 — redesenhar o modal pra ficar Trello-like (capa, etiquetas, checklist fixo, painel de atividade+comentários).
