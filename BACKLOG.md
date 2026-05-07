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

## Performance / produção

### Pré-compilar Tailwind (sair do CDN)
Hoje usamos `<script src="cdn.tailwindcss.com">` que compila CSS em
runtime. Console mostra warning "should not be used in production".
Pra polir antes do lançamento comercial:
- Adicionar tailwindcss como devDependency
- Build step no Render: `npx tailwindcss -i in.css -o styles.css --minify`
- Trocar `<script>` por `<link rel="stylesheet">`
- Reduz ~3MB JS → ~30KB CSS, melhora Lighthouse e first paint

## Ideias soltas

- Login com Google (OAuth)
- "Esqueci minha senha"
- Pull-to-refresh no mobile
- Dark mode toggle
- Gráfico de gastos com torneios por mês (a partir dos comprovantes)
- Sugestões de viagens compartilhadas (atletas indo pro mesmo torneio)
- Integração com Strava/MyCoach pra correlação treino × torneio
