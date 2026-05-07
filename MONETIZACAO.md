# Tennis Flow — Plano de Monetização (rascunho)

> Documento de discussão. Nada implementado ainda. Lê, comenta direto no MD ou
> no chat e a gente itera.

## Visão geral

Transformar o Tennis Flow de ferramenta pessoal em produto com 3 níveis:

- **Trial 15 dias** — qualquer um cria conta e ganha 15 dias de Pro completo,
  sem cartão, sem cadastro de pagamento. Período pra experimentar todos os
  recursos sem fricção.
- **Free (pós-trial)** — depois dos 15 dias, se não pagou, vira Free
  degradado. Mantém acesso à conta e a um quadro útil mas limitado.
- **Pro vitalício** — pagamento único via Pix. Preço sugerido: **R$197
  (fundador) / R$297 (regular)** — explico abaixo. Sem mensalidade, sem
  cartão, sem renovação. Garantia de reembolso 15 dias.

Estratégia de aquisição: **virar viral pelo botão Compartilhar**. Quando o
dono compartilha um torneio no WhatsApp, o link abre um **card público lindo**
com CTA "Experimente grátis". Cada compartilhamento vira marketing.

---

## Fase 1 — Planos: gating técnico

### Modelo de dados

`data/users.json` ganha campos por usuário:

```json
{
  "id": "u_abc",
  "email": "...",
  "plan": "trial",           // "trial" | "free" | "pro"
  "trialStartedAt": "...",    // ISO — set no signup
  "planActivatedAt": null,    // ISO — quando virou pro
  "planNote": null            // texto livre — "Pix R$197 em X"
}
```

Lógica `effectivePlan(user)`:
- Se `plan === 'pro'` → Pro
- Se `plan === 'trial'` e dentro de 15 dias do `trialStartedAt` → Pro
- Caso contrário → Free degradado

Default: novos signups entram como `trial` com `trialStartedAt = now`. Após
15 dias, automaticamente caem pra Free. Você ativa `pro` manual via admin
CLI quando confirma o Pix.

### Limites do Free

| Recurso                         | Free                                  | Pro vitalício     |
|---------------------------------|---------------------------------------|-------------------|
| Atletas (perfis)                | 1                                     | Ilimitado         |
| Torneios visíveis               | Encerrados + próximos 30 dias         | Tudo              |
| Sincronização manual            | ✅                                    | ✅                |
| Sincronização automática (6h)   | ❌                                    | ✅                |
| Alertas (regras)                | ❌                                    | ✅                |
| Calendário (iCal/Google)        | ❌                                    | ✅                |
| Household (compartilhar quadro) | ❌                                    | ✅                |
| Compartilhar card (WhatsApp)    | ✅                                    | ✅                |
| Comentários e anexos            | Read-only                             | ✅ Edita          |
| Histórico                       | ✅                                    | ✅                |

**Justificativa do filtro de torneios:**
- "Encerrados + 30 dias à frente" deixa o quadro útil pra avaliar (vê o que
  aconteceu, vê o que vem agora) mas insuficiente pra planejar de verdade.
  Quem joga pra valer precisa ver 60-90+ dias.
- Filtragem é no backend (no `getTournaments`), não na sync — sync continua
  baixando tudo (pra preservar histórico), só não exibe.

**Justificativa de tirar sync auto:**
- É o killer feature pra quem usa de verdade. Sem auto, usuário precisa abrir
  o app e clicar "Sincronizar" pra ver mudanças. Pra atleta sério isso vira
  fricção que justifica o upgrade.

### Onde entra o gating

- `backend/server.js` no `getTournaments`: filtra futuros se `plan === 'free'`
- `backend/sync-manager.js`: pula scheduling auto pra perfis cujo dono é Free
- `backend/server.js` nas rotas `/alert-rules` e `/calendar-token`: 403 se Free
- `backend/server.js` em `createProfile`: 403 se Free e já tem 1 perfil
- Frontend: badge "FREE" no header, banner "Upgrade pra Pro" no menu, items
  bloqueados ficam visíveis mas com cadeado e tooltip "Recurso Pro"

### Migração

- Você (alexandre@opiniao.inf.br) já existe — vai começar como `pro` direto
- Outros usuários atuais (se houver via household) entram como `free`

---

## Fase 2 — Cadastro aberto + Pix manual

### Signup público

- `/signup` (já existe a tela?) precisa virar acessível sem convite
- Captcha leve (honeypot ou "qual a soma de 2+3?") pra não receber bot
- Email de boas-vindas (opcional MVP — pode ser só uma landing pós-cadastro)

### Tela de upgrade (`/upgrade`)

Página explicando o plano vitalício, com:

1. **Recap dos benefícios** (a tabela acima, marketing-style)
2. **Pix copia-e-cola** — chave (sua chave Pix), QR code, valor R$297
3. **Instrução**: "Após pagar, mande o comprovante pra
   alexandre@opiniao.inf.br ou WhatsApp X. Ativo sua conta em até 24h."
4. **FAQ**: "É realmente vitalício?" / "Posso cancelar?" / "Funciona em quantos
   dispositivos?"

### Ativação via admin CLI

`backend/admin-cli.js` ganha:

```bash
node backend/admin-cli.js activate-pro <email> [nota]
node backend/admin-cli.js list-pending-upgrades
```

`activate-pro` seta `plan: 'pro'`, `planActivatedAt: now`, `planNote: ...`.

### Por que Pix manual

- Stripe/Mercado Pago = 30 min de setup + KYC + 4-6% de fee
- No volume inicial (10-50 vendas?), R$297×0.05 = R$15 de fee por venda
- Pix manual = 0 fee, fricção aceitável, valida demanda real
- Se passar de ~50 vendas/mês, vale automatizar (Mercado Pago Pix com webhook)

---

## Fase 3 — O card público (foco da experiência)

Esse é o coração da estratégia viral. Vou detalhar.

### Fluxo

1. Usuário Pro clica em "⋯ → Compartilhar" num card
2. Backend gera (ou reusa) um **token de compartilhamento** pro torneio
3. Mensagem do WhatsApp agora carrega `https://tennisflow.../share/T_abc123`
4. Quem recebe clica → vê uma página pública linda com:
   - Header: logo Tennis Flow + "Compartilhado via Tennis Flow 🎾"
   - **Card hero**: nome do torneio em destaque, datas, cidade/UF, chave,
     status de inscrição
   - Boletos (se houver) sem mostrar valor — só "Boleto disponível no TI"
   - Link "Ver no Tênis Integrado" (botão secundário)
   - **Hero CTA**: "Organize a sua agenda também — comece grátis"
   - Mini-explicação do app em 3 bullets + screenshot/diagrama do Kanban
   - **Segundo CTA**: "Conhecer o app" → `/manual`

### O que NÃO mostrar na página pública

- Nome da atleta (privacidade — só do dono)
- Valor exato do boleto (custo de inscrição é dado quase-privado em contexto)
- Notas/comentários internos
- Membros do household
- Outros torneios

→ A página é **sobre o torneio**, não sobre o atleta. Quem recebe vê o
  torneio público + o app que organiza esse tipo de informação.

### Modelo técnico

**Storage**:
```
data/shared/<token>.json
{
  "token": "T_abc123",
  "profileId": "p_xyz",
  "tournamentId": "t_42",
  "sharedBy": "u_abc",       // só pra estatística interna
  "sharedAt": "2026-..."
}
```

Token = base62, ~10 chars (`T_xxxxxxxx`). Sem expiração no MVP.

**Endpoint**:
- `POST /api/profiles/:id/tournaments/:tid/share` (auth) → gera token, retorna `{ token, url }`
  - Idempotente: se já existe token pra esse `(profileId, tid)`, reusa
- `GET /share/:token` (público) → renderiza HTML standalone com os dados do torneio
  - Resolve token → busca `synced.json` do `profileId` → encontra `tid` → renderiza

**Frontend**:
- `shareCardWhatsApp(t)` agora primeiro chama `POST /share` pra obter URL,
  depois monta a mensagem com o token URL no lugar do `t.url`

### Métricas

Cada `GET /share/:token` incrementa um contador. Você consegue ver no admin
CLI quais cards mais geram cliques ("o pessoal compartilha XYZ mais que ABC")
— sinal de qual tipo de conteúdo viraliza.

---

## Fase 4 — Landing pra novos visitantes

Hoje, abrir `/` deslogado mostra o login. Pra estratégia funcionar, **`/`
deslogado precisa virar landing page com hero + CTA**.

Estrutura proposta da landing:

1. **Hero**: logo + tagline + 2 botões ("Começar grátis", "Ver demo")
2. **Problema** (a citação que tá no manual hoje serve)
3. **Solução em 3 passos** (já tá no manual)
4. **Demo do Kanban** (mini-diagrama do manual)
5. **Tabela de planos** (Free vs Pro)
6. **FAQ**
7. **CTA final** + footer com link pro `/manual`

Pode reaproveitar 70% do `/manual`. A diferença: landing tem botão de
**conversão** (signup), manual é informativo.

URL routing:
- `/` deslogado = landing
- `/` logado = app (como hoje)
- `/manual` continua sendo o documento detalhado
- `/signup` cadastro
- `/upgrade` paywall com Pix
- `/share/:token` card público

---

## O que NÃO entra no MVP

Pra evitar que o escopo exploda:

- ❌ Stripe / Mercado Pago automatizado (Pix manual basta)
- ❌ Trial de 14 dias com Pro completo (Free perpétuo basta)
- ❌ Reembolso automatizado (raro com vitalício barato)
- ❌ Email transacional (Resend/SES) — pode mandar manual no início
- ❌ Painel de afiliados / cupons
- ❌ Multi-idioma
- ❌ App nativo (PWA já cobre 90%)
- ❌ Login com Google (no backlog mas não bloqueia monetização)

---

## Ordem de implementação sugerida

1. **Card público + share token** (Fase 3) — começa pelo motor da estratégia
2. **Gating Free vs Pro** (Fase 1) — destrava a venda
3. **Tela /upgrade com Pix** (Fase 2) — destino dos CTAs
4. **Admin CLI activate-pro** (Fase 2) — fechamento do funil
5. **Signup público + landing** (Fase 4) — abre as portas
6. **Banner upgrade no app** (Fase 1 extra) — converte usuário Free engajado

Cada fase é shippable independente. Pode parar em qualquer ponto e ainda
ter algo útil.

---

## Decisões fechadas

1. **Trial 15 dias** (Pro completo) → vira Free se não pagar.
2. **Reembolso 15 dias** sem perguntas, contados a partir do pagamento Pix.
3. **Convidados household herdam Pro** dentro do quadro do dono. Se um
   convidado quiser quadro próprio (atleta próprio), precisa Pro próprio.
4. **Sem revogação de token** no MVP. Card compartilhado fica público
   indefinidamente. Adicionamos botão "Apagar links" se virar problema.
5. **Preço sugerido: R$197 fundador / R$297 regular**. Detalhes abaixo.

## Estratégia de preço

Não há concorrente direto no Brasil — Tênis Integrado é gratuito mas pra
clubes/jogadores; Letzplay e Tornfy são pra organizadores. Tennis Flow
ocupa nicho vazio: **organização da família/atleta sobre o calendário do TI**.

Preço definido por **valor percebido**, não comparação:
- Família atleta gasta R$2-5k/mês com torneios/viagens
- Perder 1 inscrição = R$200-500
- Multa de boleto = R$50-200
- ROI imediato em 1 boleto evitado

**Recomendação: dois preços públicos com narrativa.**

| Fase                     | Preço público | Quando             |
|--------------------------|---------------|--------------------|
| **Fundador**             | R$197         | Primeiros 100 ou até dez/2026 |
| **Regular**              | R$297         | Depois             |

A transição R$197 → R$297 vira conteúdo de marketing ("estamos crescendo,
preço sobe em janeiro") e cria urgência sem precisar de contador no site.

Alternativa simples: **R$297 firme desde o início** — perde algumas
conversões marginais mas posicionamento é mais sólido. Se você não quer
gerenciar duas fases, vai nessa.

---

## Próximo passo

Você lê isso, comenta o que muda, e a gente faz issue-list ordenada pra
começar a implementar.
