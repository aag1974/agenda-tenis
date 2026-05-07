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

### 6. Indicação visual da coluna na busca
Quando o usuário busca, hoje os cards aparecem nas colunas mas é difícil
saber rapidamente onde cada um está sem rolar a coluna inteira.

**Plano sugerido (1+2 juntos):**
- **Chip da coluna no card** durante busca (já existe no mobile, expandir
  pro desktop): mostra ícone+nome da coluna logo abaixo do título.
- **Contador no header da coluna** durante busca: "Inscrições Abertas · 3
  resultados" — guia o olho pra coluna com mais matches.

(3) "Dim das colunas sem match" foi descartado — estético mas não
acrescenta info que (1)+(2) não cobrem.

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
