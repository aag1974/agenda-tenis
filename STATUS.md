# Status do projeto — última atualização

Snapshot pra retomar o trabalho no outro Mac. Atualizado em 05/05/2026.

## Onde rodando

- **Produção (24/7):** https://agenda-tenis-integrado.onrender.com
- **GitHub:** https://github.com/aag1974/agenda-tenis (branch `main`)
- **Último commit:** `c2c9bb0` — Comprovantes: remover deep links instáveis
- **Plano Render:** Starter (US$ 7/mês) — necessário pelo disco persistente em `/opt/render/project/src/data`
- **Auto-deploy:** push em `main` dispara deploy automático no Render
- **Service Worker cache:** `agenda-tenis-v28` (frontend/sw.js)

## Arquitetura

- Backend Node Express + scraper HTTP-only (cheerio), auth scrypt + cookie HMAC, storage criptografado AES-GCM
- Frontend SPA + PWA (manifest.webmanifest + sw.js)
- Auto-sync interno a cada 6h pra perfis com torneios estrelados nos próximos 90 dias
- iCal feed em `/calendar/<token>.ics` com eventos de torneio (alarme 7d antes) e boleto (alarme 1d antes)

## Features adicionadas nesta sessão (em ordem cronológica)

1. **Tirar do PC, deploy no Render** com plano Starter
2. **Lista única com seções colapsáveis** (Urgente, Esta semana, Este mês, Próximos meses, Já passaram), zero filtros visíveis no padrão
3. **Cards conversacionais** ("daqui 4 dias", "começa amanhã", etc.)
4. **Header compacto** + menu engrenagem (👤 Sobre o atleta, 📅 Conectar com calendário, ✏️ Editar perfil, 🚪 Sair)
5. **Semáforo de sync** — click mostra status + oferece sync manual via confirm
6. **Múltiplos tiers no card** (G1+, GA, etc.) extraídos de parênteses no panel TI
7. **Filtros UF (multi pills) + Chave (single)** dentro do menu
8. **Card verde/amarelo/rosa/branco** dependendo do estado:
   - Amarelo: boleto pendente
   - Verde: inscrito + futuro
   - Rosa: inscrito + passado (histórico)
   - Branco: não inscrito
9. **Botão "Já me inscrevi"** (override manual) e **"Desisti deste torneio"** (com confirm)
10. **Inscrições encerradas** — botão cinza no modal quando TI não aceita mais
11. **Cidade igual à da atleta** — sem voo nem hotel sugerido
12. **Hotéis sincronizados** pra torneios estrelados (passados ou futuros)
13. **Card "Sobre o atleta"** — Nome/ID/naturalidade, Rankings (Nacional CBT + DF + WTN com data do corte), próximo/último torneio, total inscrito no ano, boletos pendentes
14. **Comprovantes** — seção no modal com nome de nota sugerido pra usar com scanner nativo do iOS Notes (sem armazenamento no app)
15. **iCal** com lista de hotéis na descrição, valores normalizados em padrão BR (vírgula)
16. **Padronização masculina** das strings ("Inscrito" em vez de "Inscrita")
17. **Auto-star reforçado** — boleto pendente sempre liga ⭐ (exceto se manualGiveUp)

## Próximos passos pendentes (de ontem)

- Investigar a divergência de gênero — strings hard-coded no masculino (decidiram padronizar). Caso outro pai use o app pra filha, vão precisar ajustar pontualmente.
- Confirmar que dá pra exportar a nota do Notas como PDF de prestação de contas (fluxo 100% iOS, fora do nosso app).
- Possível futuro: aba "Resultados" com placares dos jogos (já tem código Python que extrai isso, falta portar pra Node).

## Coisa estranha que ficou pendente

- Usuário relatou hyperlink no Notas que "não leva de volta" — ficou ambíguo se era hyperlink no documento ou o "< Safari" do iOS. Removi os deep links `mobilenotes://` e `shareddocuments://` no commit `c2c9bb0` por serem instáveis no iOS. Aguardando o usuário voltar com mais info amanhã.

## Como retomar no outro Mac

```bash
cd "~/Library/Mobile Documents/com~apple~CloudDocs/Pessoal/Anna Luiza/agenda-app"
git pull              # garantir que está em c2c9bb0 ou mais novo
git log --oneline -5  # confirma últimos commits
```

Não precisa de `node`/`npm install` localmente — o Render cuida disso. Edição direta nos arquivos JS, commit + push, Render redeploys em ~2 min.

Pra testar mudanças no celular, sempre bumpar `frontend/sw.js` cache version (`agenda-tenis-vN`).
