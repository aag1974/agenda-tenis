# Tennis Flow — Playbook do Relatório de Performance

Documento interno. Consolida os aprendizados das 7 sprints de evolução do
Relatório de Performance (8.2 → 9.5/10) pra serem reaplicados em todos os
relatórios futuros sem reabrir cada decisão.

> **Filosofia editorial:** _Sofisticação invisível_. Modelo sofisticado,
> análise sofisticada, **linguagem extremamente simples**. Esse é o padrão
> de produtos esportivos premium.

---

## 1. A voz editorial

**Persona única**: head coach inteligente, que entende estatística mas
fala tênis. Conversa com atleta, pai/mãe e treinador. Nunca acadêmico,
nunca executivo, nunca narrador esportivo enfático.

### Teste definitivo (regra de ouro)

> _"Uma criança de 12 anos entende isso ouvindo uma vez?"_

Se a resposta for "mais ou menos", reescreve.

### Regra complementar

> _"Se o coach não usaria essa frase na quadra, ela não entra."_

### Lista negra (palavras a evitar no corpo principal)

- desvio padrão · stdev · variância · volatilidade
- inferir / inferencial / extrapolar
- magnitude · normalizado · cristalizar
- ilusão estatística
- paradoxal
- direcional / inerente
- ± X (a não ser onde o IC já está rotulado)
- "testes de poder estatístico real"
- nomes de testes (Wald-Wolfowitz, Bonferroni, etc) — vão pro Anexo C

### Substituições canônicas

| Em vez de | Use |
|---|---|
| "Performance em pontos decisivos" | **"Como joga quando o jogo aperta"** |
| "Reação à adversidade" | **"Como reage depois de perder um set"** |
| "Dominância (CDI)" | **"Quanto controla o jogo quando vence"** |
| "stdev 3 games" / "volatilidade alta" | **"Tem dias muito fortes e outros mais instáveis"** |
| "Margem média de 3,4 games" | **"Na maior parte dos jogos, ditou o ritmo sem deixar o adversário entrar na partida"** |
| "Padrão preocupante: poucos sets equilibrados, maioria fechada em desvantagem" | **"Os jogos contra esse rival estão difíceis"** |
| "Atletas em desenvolvimento competitivo, ainda construindo histórico" | **"Já entrou no circuito oficial, agora é jogo a jogo"** |
| "Conclusões são direcionais, não definitivas" | **"Com pouca amostra, qualquer conclusão é direção, não certeza"** |
| "Aviso final" | **"Pra fechar"** |

### Frases-benchmark (manter como referência)

- _"É aí que se ganha rating de verdade."_
- _"Vitórias contra adversários estatisticamente acima dele são as que mais fazem o nível dele subir."_
- _"Tênis é jogo de paciência — o que se constrói agora aparece lá na frente."_
- _"Barreira em aberto."_

---

## 2. Estrutura canônica

```
1. Capa (sóbria, Tennis Flow + nome + categoria + período)
2. Resumo Executivo
   - A FRASE DO ATLETA (assinatura editorial em destaque navy)
   - "Em uma frase" (headline factual)
   - Números-chave + Nível Estimado (sparkline)
   - Três coisas que os dados mostram (3 insights com ícones)
   - Maior conquista (destaque)
   - Aviso de amostra
3. PERFIL COMPETITIVO (player card — coração do produto)
   - Arquétipos como badges navy gradient
   - Radar 5-eixos | 3 cards de métricas
4. Cap 1 — Quem é o atleta
5. Cap 2 — Como esta análise foi feita (1 página, enxuto)
6. Cap 3 — O que foi disputado (cronograma + heatmap calendário + recorrentes + histograma)
7. Cap 4 — O que os dados revelam (rating + forma + buckets + esperado×realizado + h2h + temporais)
8. Cap 5 — Os momentos que se destacaram (3 jogos com lente estatística)
9. Cap 6 — O que aprendemos e o que observar (síntese + perguntas pro coach)
10. Anexos A (lista completa) · B (glossário) · C (notas técnicas) · D (h2h restantes)
```

---

## 3. Métricas proprietárias

São o que diferencia Tennis Flow de relatório de Excel. Sempre escala 0-100,
sempre com explicação ELI5 no card.

### Competitive Dominance Index (CDI)
40% taxa de sets dominantes (≤2 games cedidos) + 30% game-win-rate + 30%
margem média normalizada.
Card: **"Quanto controla o jogo quando vence"**.

### Clutch Score
Média de % vitórias em tie-breaks + super-tiebreaks + sets decisivos
(janelas disponíveis).
Card: **"Como joga quando o jogo aperta"**.

### Resilience Index
Média de % vitórias após perder o 1º set + % comebacks em h2h.
Card: **"Como reage depois de perder um set"**.

### Faixas de cor
- ≥ 65 = forte (verde)
- 45–64 = médio (amarelo)
- < 45 = em desenvolvimento (vermelho)

---

## 4. DNA competitivo (arquétipos do atleta)

Combinação dos índices + buckets + winrate. Até 2 arquétipos mais
distintivos. Cada um aparece como **badge** em destaque.

| Arquétipo | Disparo | Frase no badge |
|---|---|---|
| 🔨 Dominador(a) | CDI ≥ 60 | "Vitórias por margens largas" |
| 🎯 Fechador(a) | Clutch ≥ 60 | "Decide nos pontos que importam" |
| 🛡 Resiliente | Resilience ≥ 50 | "Reage à adversidade" |
| ⛰ Escalador(a) | strongRate ≥ 30% (n≥5) | "Vence acima do nível" |
| ⚙ Triturador(a) de inferiores | weakRate ≥ 85% E evenRate < 45% | "Resolve com sobra os fáceis, falta fechar parelhos" |
| ⚖ Especialista em parelhos | evenRate ≥ 55% (n≥5) | "Sai na frente onde é mais difícil" |
| 📐 Construtor(a) | winRate ≥ 65% E CDI < 45 | "Vence no limite, sem dominar" |
| 🌱 Em construção | analyzed < 30 e nada disparou | "Histórico ainda jovem" |
| 🧭 Perfil em definição | analyzed ≥ 30 e nada disparou | "Padrão dominante ainda não emergiu" |

---

## 5. Arquétipos de H2H (rival)

Cada h2h vira **um arquétipo nominado em bold** no início do parágrafo.
Cria mnemônico — coach lê "Rival em queda" e já tem leitura instantânea.

| Situação | Arquétipos |
|---|---|
| 100% V | **Rival dominado** · **Sob controle** · **Adversário com tarefa** · **Confronto resolvido** |
| 0% V (recente, ≤90d) | **Barreira atual** · **Adversário difícil de quebrar** |
| 0% V (90d–6m) | **Barreira em aberto** · **Rival ainda não vencido** |
| 0% V (>6m) | **Rival do passado** · **Histórico antigo** |
| Virada favorável | **Histórico revertido** · **Rival em queda** |
| Regressão | **Rival em evolução** · **Sinal de atenção** |
| Equilíbrio + último W | **Rivalidade controlada** · **Frente sob domínio** |
| Equilíbrio + último L | **Rival de aproximação** · **Vantagem ameaçada** |
| Saldo negativo + último L | **Rival perigoso** · **Adversário difícil** |
| Saldo negativo + último W | **Rival perigoso, em aproximação** · **Reagindo ao histórico** |
| 0–0 | **Rival de detalhe** · **Confronto sem dono** |

### Filtro do corpo principal

Se há mais de 6 rivais recorrentes, mostrar só os **top 8 por relevância**:
- Recência (≤90d=+50, ≤180d=+30, ≤365d=+15)
- Volume (até +30)
- Saldo negativo (+25)
- Barreiras absolutas (+15)

Os demais vão pro **Anexo D — Demais confrontos recorrentes** (tabela
compacta).

---

## 6. A frase do atleta (assinatura editorial)

Uma frase que combina **maior força + maior gap pro próximo nível**. Aparece
em destaque no resumo executivo (card navy gradient com aspas decorativas).

Memorável, conversável, "explicável em 30 segundos". Vira fala do coach
("Rafael já domina quem está abaixo dele. Próximo salto é fechar parelhos").

### Templates por padrão detectado

| Padrão | Frase |
|---|---|
| Domina inferiores, trava em parelhos | "X já domina quem está abaixo dele. O próximo salto é aprender a fechar os jogos equilibrados." |
| Vence largado, falta clutch | "X sabe vencer com folga. Falta aprender a fechar quando o jogo aperta." |
| Boa em parelhos, perde quando começa atrás | "X segura bem o equilíbrio. O desafio agora é não desligar quando o jogo começa errado." |
| Em ascensão, winRate ainda < 50% | "X entrou em ritmo de evolução. Próximos meses vão dizer se é tendência ou fase." |
| Em ascensão, winRate ≥ 50% | "X está jogando o melhor tênis do histórico. Hora de testar contra adversários mais fortes." |
| strongRate ≥ 40% | "X vem ganhando jogos contra adversários acima do nível dele. Está pedindo torneio mais forte." |
| Clutch alto (≥ 65) | "X é dos que aparecem quando o jogo aperta. Quem encontra ele, sabe que vai sofrer pra fechar." |
| Resiliente alto (≥ 60) | "X é difícil de quebrar. Mesmo perdendo o primeiro set, costuma achar o caminho de volta." |

---

## 7. Caveat inferencial

Quando IC do Glicko é largo (rd ≥ 120), narrativa **não crava**. Em vez
de _"está na elite da categoria"_, escreve _"sinalizando elite, com
cautela inferencial pela amostra atual"_.

---

## 8. Banco narrativo (princípio anti-template)

Para cada situação tática, **mínimo 8–16 variantes** alternadas por hash
estável do nome do oponente. Mesmo opp gera mesma frase entre re-renders;
opps diferentes vêm com texto diferente.

Avaliação 9.5 ainda apontou repetição estrutural — meta pro futuro:
**150–200 microestruturas** distribuídas por situação, com diferentes
tons (imperativo, observação, conselho de quadra, leitura tática).

---

## 9. Visual

### O que está em pé (v15)
- Player card layout (radar | métricas) com badges hero gradient navy
- Heatmap calendário (mês × ano com cor pelo aproveitamento)
- Sparkline de rating Glicko com banda de IC
- Histograma de placares colorido (verde wins, vermelho losses)
- Pneu (6-0) marcado explicitamente

### Pendente pra próximo ciclo (limitação reconhecida na 9.5)
> "O conteúdo já ultrapassou o design"

- Mais espaço em branco
- Mais hierarquia visual
- Mais páginas hero (capítulos com abertura impactante)
- Visual do Perfil Competitivo aproximando de **FIFA Ultimate Team / ATP
  Media Guide / NBA 2K Player Card** (foto opcional, badges grandes,
  stats hero)
- Reduzir 25–30% do texto no h2h

---

## 10. Separação Relatório Coach × Anexo Técnico

Avaliação 9.5 apontou que ainda há "vazamento acadêmico" no Anexo C
(`cutoff ±100 Glicko`, `τ (constraint): 0,5`, etc.). Recomendação não
implementada ainda:

> Separar em **dois PDFs**:
> 1. **Relatório Coach** (corpo principal sem academicês)
> 2. **Anexo Técnico** (entregue separado, sob demanda — pra quem
>    quer auditar o método)

Decisão pendente. Hoje os 2 estão num só PDF.

---

## 11. Trajetória de avaliações (registro)

| Versão | Nota | Maior salto |
|---|---|---|
| v0 (auto-gerado primeiro) | 8.2 | — |
| v1 (pós sprint 1+2: métricas + DNA) | 8.9 | "Estatística virou comportamento competitivo" |
| v2 (pós sprint 3: h2h scouting) | 9.1 | Arquétipos H2H + voz de coach |
| v3 (pós sprint 4: visual + Cap 2 enxuto) | 9.3 | Player card + radar + heatmap |
| v4 (pós sprint 5: refinamento editorial) | 9.5 | Frase do atleta + filtros + zero academicês |

---

## 12. Setup técnico

### Arquivos-chave
- `backend/report.js` — engine de renderização HTML
- `backend/narrative.js` — geração de texto (2ª e 3ª pessoa)
- `backend/competitive-metrics.js` — CDI, Clutch, Resiliência, arquétipos
- `backend/gender.js` — detecção de gênero + flexão
- `backend/charts.js` — radar e heatmap SVG inline
- `scripts/render-report-from-zip.js` — gera HTML local a partir de
  `meta.json + synced.json + matches.json`

### Workflow de novo cliente
1. Cliente clica "Solicitar análise completa" → consentimento LGPD →
   email + push pro admin
2. Admin abre painel → inbox de pedidos → baixa zip
3. Descompacta em `relatorios_atletas/<Nome>/dump/`
4. Roda: `node scripts/render-report-from-zip.js relatorios_atletas/<Nome>/dump 'relatorios_atletas/<Nome>/20-rascunho.html'`
5. Abre HTML no Chrome → revisa narrativas → Cmd+P → salva como PDF
6. Salva PDF na mesma pasta com nome final
7. Marca status do pedido como "delivered" no painel admin

### Arquétipos garantidos automaticamente
- Detecção de gênero (M/F) a partir das categorias de torneio
- Categoria principal (moda dos torneios)
- Filtro de h2h por relevância
- Arquétipo do atleta (DNA)
- Arquétipo de cada h2h
- Frase do atleta
- Caveat inferencial quando IC for largo

### Re-trigger pós-mudança no engine
Após qualquer commit no `report.js`/`narrative.js`/`competitive-metrics.js`,
re-renderizar **todos os atletas** ativos pra distribuir o upgrade:

```bash
for dir in relatorios_atletas/*/dump; do
  out="$(dirname "$dir")/20-rascunho.html"
  node scripts/render-report-from-zip.js "$dir" "$out"
done
```
