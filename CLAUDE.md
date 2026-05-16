# Premissas do projeto

Regras de design e UX que se aplicam a todo o app (TennisFlow e /scouting).
Toda nova feature deve respeitar essas regras sem precisar ser lembrada.

## UX

### Diálogos sempre estilizados (não nativos)
Nunca use `alert()`, `confirm()` ou `prompt()` do navegador. Sempre usar
modal customizado no padrão visual do app (fundo escuro, card com `bg-slate-*`,
border radius, botões cyan/rose conforme contexto).

- TennisFlow tem `confirmDialog()` em `frontend/app.js`
- /scouting tem `confirmDialog()` em `frontend/scouting.js`
- Mensagens de erro/sucesso: usar caixa inline (`.text-red-300 bg-red-900/30 …`)
  em vez de `alert()`

### Copy sempre masculino genérico
"Atleta", "Adversário", "Scouter" — não usar feminino mesmo quando o usuário
é mulher. Padrão definido pra coerência cross-public.

### Sempre "você", nunca "tu"
Em copy do app (e em conversa com o usuário). "tu" é dialeto regional
(Sul/Nordeste), soa estranho pra quem não é dali. Pode omitir o pronome
quando ficar natural.

### Identidade visual TennisFlow
Cor primária `cyan-500` / `cyan-600` / `cyan-300` (acento). Fundo escuro
gradient (`--ti-navy-dark` → `--ti-navy` → `--ti-board-bg`). Logo sempre
"Tennis" (branco) + "Flow" (cyan-300). Sub-produtos vêm em italic ao lado
(ex: "Scouting").

## Backend

### Tokens de uso público
Operações públicas (sem auth de usuário) usam tokens hex de 32 chars.
Padrão: `live-match-tokens.json` (scout/viewer), `invites.json` (/scouting).

### Storage por produto
Cada produto tem sua pasta:
- TennisFlow: `data/profile-<id>/`, `data/profiles.json`, `data/users.json`
- /scouting: `data/scouting/` (rosters, invites separados)

### Versão e cache
- `package.json` e `frontend/sw.js` devem ter a mesma versão.
- Bumpar a cada mudança visível ao usuário pra invalidar cache do SW.

## Git/Deploy

- `git push origin main` → Render auto-deploya em 1-2min.
- Cada commit é deployado, então testes locais via tunnel antes de push.
- Bump versão (SW + package.json) junto com mudanças no frontend.
