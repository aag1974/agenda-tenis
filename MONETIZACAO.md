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
- **Pro vitalício** — pagamento único via Pix. Preço definido: **R$297
  (fundador) / R$597 (regular)** — explico abaixo. Sem mensalidade, sem
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
3. Mensagem do WhatsApp agora carrega `https://tennis-flow.com/share/T_abc123`
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
5. **Preço definido: R$297 fundador / R$597 regular**. Detalhes abaixo.

## Estratégia de preço

### Posicionamento (a comparação certa)

Não há concorrente direto. TI é gratuito mas é **infraestrutura** (transações,
ranking, autoridade). TF é **camada de gestão** sobre essa infraestrutura.

Analogia: TI está pra TF assim como **banco** está pra **Mobills/Organizze**.
Banco é gratuito, faz transações, mantém saldo. Mobills cobra ~R$60/ano
(~R$500 vitalício efetivo) pra organizar, alertar, dashboard. Tennis Flow
é o equivalente disso pro mercado de torneios juvenis/profissionais.

Comparar preço de TF com preço do TI é como comparar preço de Mobills
com preço da conta corrente — categorias diferentes.

### Valor real entregue

- Família atleta gasta R$2-5k/mês com torneios/viagens
- Perder 1 inscrição = R$200-500 (boleto + chance perdida)
- Multa de boleto = R$50-200
- 2-3h/semana organizando manualmente = R$200-600/mês de tempo
- ROI imediato em 1 boleto evitado ou 1 inscrição não-perdida

### Anchors do mercado brasileiro vitalício

- Cursos vitalícios profissionais: R$497-R$1.997 (Asimov R$1.997)
- Apps de produtividade nicho: R$497-R$997 normal
- Fronteiras psicológicas:
  - <R$500 = decisão impulsiva
  - R$500-R$1.000 = decisão consciente individual
  - \>R$1.000 = decisão familiar/discutida

### Decisão final

| Fase                     | Preço    | Quando                          |
|--------------------------|----------|---------------------------------|
| **Fundador**             | **R$297**| Primeiros 100 ou até dez/2026   |
| **Regular**              | **R$597**| Depois                          |

Gap fundador → regular = 2.01x. Está dentro do range aceitável de
mercado (campanhas típicas vão de 1.5-2x). Funciona porque:

1. **R$297 é zona de impulso (sub-300).** Maximiza conversão na
   validação. Em fase early, learning > receita por unidade.
2. **R$597 é zona "decisão consciente" mas ainda sub-R$1k.** Não vira
   reunião familiar.
3. **História "antes e depois" é forte.** "Comprei por R$297 quando ainda
   era fundador, hoje custa R$597" vira boca-a-boca.
4. **Risco mitigado pelo cap claro.** "Primeiros 100" ou "até dez/2026" —
   um critério, cumprido. Sem promoção eterna.

### Condições de execução (essas precisam acontecer)

1. **Cap rígido.** 100 clientes ou data fixa. Não relaxar.
2. **Comunicar transição com antecedência.** Banner 30 dias antes:
   "Restam 12 vagas fundador" ou "Fundador encerra em DD/MM".
3. **Landing/produto na régua de R$597.** Quem chega na fase regular
   julga pelo que vê. Manual, UX, atendimento — qualidade alta.
4. **Garantia 15 dias amortece tensão.** Quem paga R$597 vendo que
   outros pagaram R$297 pode resistir; reembolso amplo compensa.

### Por que NÃO R$197 ou R$497 fundador

- **R$197**: dá impressão de hobby, mata a justificativa do R$597 depois.
- **R$497**: gap fica 1.4x, narrativa do "fundador" fica fraca.
- **R$297** equilibra: zona de impulso + gap suficiente pra história
  do "antes e depois" valer.

---

## Riscos — relação com o Tênis Integrado

O produto depende inteiramente do TI como fonte de dados. Isso é um risco
estratégico que precisa ser gerenciado.

### As 3 camadas de risco

**1. Técnico:** TI muda HTML do site → scraper quebra → produto fica fora
até correção. Acontece naturalmente. Mitigação: manutenção contínua.

**2. Operacional:** TI detecta acesso automatizado, bloqueia conta do
usuário ou IP do servidor. Pode ser ativo (eles miram) ou passivo
(rate-limit anti-bot).

**3. Legal/comercial:** TI alega violação de termos, manda cease & desist,
ou lança feature concorrente.

### O que a arquitetura já protege

- **Cada usuário usa as próprias credenciais TI.** Bloqueio é sempre
  individual, nunca afeta o produto inteiro. Não existe "user master".
- **Sync auto a cada 6h é educado.** Não é hammering, não chama atenção.
- **Acesso aos dados do próprio usuário.** Defesa legal forte (Marco
  Civil + LGPD favorecem agência do usuário sobre os próprios dados).

### Curva de visibilidade

- 10-50 clientes: provavelmente nem notam
- 100-500: aparece nos logs, podem perguntar
- 1.000+: você está visível, eles agem

A janela pra conversar **antes** de virar problema é entre 50 e 200
clientes. Depois disso, vira negociação tensa.

### Plano de comunicação com TI

**Quando:** ao bater ~50 clientes pagantes (ou se o produto começar a
crescer rápido). Decisão do Alex: "se ver que o negócio vai pegar".

**Quem procurar:** área comercial / parcerias do TI, não suporte técnico.

**Mensagem-base** (rascunho — adapta antes de mandar):

```
Assunto: Tennis Flow — ferramenta complementar de calendário

Olá,

Sou Alexandre Garcia, desenvolvedor. Construí uma ferramenta chamada
Tennis Flow que organiza a agenda de torneios pra famílias e atletas
que usam o Tênis Integrado.

A ferramenta funciona com as credenciais do próprio usuário (cada um
loga com sua conta TI), faz uma sincronização a cada 6h e organiza os
torneios num quadro Kanban com alertas, agenda integrada e
compartilhamento familiar. Não compete com o TI — pelo contrário,
aumenta engajamento (usuários pagam boletos mais cedo, registram mais
inscrições, decidem com mais informação).

Estou validando o produto com algumas dezenas de clientes e quis abrir
um canal com vocês antes de crescer mais. Algumas opções pra discutir:

1. Vocês têm interesse em alguma forma de parceria formal (API,
   atribuição visível, programa de afiliados)?
2. Existe alguma diretriz de uso técnico que eu precise respeitar
   (rate limit, User-Agent declarado, etc)?
3. Há interesse em conversar sobre como ferramentas como essa se
   encaixam na visão de produto de vocês?

Posso mandar mais detalhes técnicos, números, ou marcar uma call
quando for melhor pra vocês.

Abraço,
Alexandre
alexandre@opiniao.inf.br
```

### Mitigações pelo caminho

- **User-Agent transparente** no scraper:
  `Tennis-Flow/1.0 (+contato: alexandre@opiniao.inf.br)`
- **Marketing sem implicação de parceria.** "Lê dados do Tênis
  Integrado" (descritivo, OK) ≠ "Parceiro oficial do Tênis Integrado"
  (falsa associação, problema).
- **Plano B documentado:** "Se o TI ficar fora ou bloquear sua conta,
  sua assinatura pausa e a gente devolve proporcional." Reduz a
  ansiedade do "e se?" no cliente.
- **Diversificação futura** (fase 2+): entrada manual de torneios,
  scraping de federações estaduais, integração com sites de inscrição
  alternativos. Não é prioridade agora.

### Decisão atual do Alex

> "Se eu ver que o negócio vai pegar, eu procuro o TI."

Linha registrada. Implícito: até ~50 clientes pagantes, opera de
forma educada e sob o radar; daí em diante, abre o canal.

---

## Próximo passo

Você lê isso, comenta o que muda, e a gente faz issue-list ordenada pra
começar a implementar.
