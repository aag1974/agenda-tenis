#!/usr/bin/env python3
"""
Simula a Etapa 4 sem aplicar mudanças. Aplica o filtro de escopo
(CBT tiers + federações UF) sobre a base do TI e compara com o
painel atual da Anna pra mostrar o delta esperado.
"""

import json
from datetime import date
from collections import Counter

PROFILE_ID = 'b06bcc2b14b6e149'

def load_json(path):
    with open(path) as f: return json.load(f)

# ── Inputs ──
base = load_json('data/ti-catalogo-base.json')
profile = next(p for p in load_json('data/profiles.json') if p['id'] == PROFILE_ID)
synced = load_json(f'data/profile-{PROFILE_ID}/synced.json')

scope = profile.get('scope', {})
cbt_tiers = set(scope.get('cbt', {}).get('tiers', []))
fed_ufs = set(scope.get('federacoes_uf', []))
current_cat = synced.get('athlete', {}).get('rankingNational', {}).get('category')

print(f'━━━ SIMULAÇÃO ETAPA 4 — Anna ({current_cat}, UF {synced["athlete"]["rankingRegional"]["uf"]}) ━━━')
print(f'Scope: CBT={sorted(cbt_tiers)}  Federações={sorted(fed_ufs)}\n')

# ── Universo na base ──
tournaments = list(base['tournaments'].values())
print(f'Base TI (compartilhada): {len(tournaments)} torneios totais')

# Só juvenis e só 2026 (foco do painel)
juvenis_26 = [
    t for t in tournaments
    if t.get('audience') == 'juvenil'
    and t.get('kind') == 'tennis'
    and t.get('startDate', '').endswith('/2026')
]
print(f'  Juvenis Tênis 2026: {len(juvenis_26)}\n')

# ── Aplicar filtro de escopo proposto ──
# CBT: tem tier no conjunto
# Federações: sem tier (regional) e estado no fed_ufs
filtered = []
for t in juvenis_26:
    tiers = t.get('tiers') or []
    primary = tiers[0] if tiers else None
    is_cbt = primary in cbt_tiers
    is_fed_uf = (not tiers) and (t.get('state') in fed_ufs)
    if is_cbt or is_fed_uf:
        filtered.append({**t, '_via': 'CBT' if is_cbt else 'FED'})

print(f'━━━ COM FILTRO DE ESCOPO (cenário Etapa 4) ━━━')
print(f'Torneios visíveis: {len(filtered)}')
print(f'  Via CBT (tier oficial): {sum(1 for t in filtered if t["_via"]=="CBT")}')
print(f'  Via Federação ({"/".join(sorted(fed_ufs))}): {sum(1 for t in filtered if t["_via"]=="FED")}')

# ── Painel atual da Anna ──
anna_ids = {t['id'] for t in synced['tournaments']}
anna_26_ids = {t['id'] for t in synced['tournaments'] if t.get('startDate','').endswith('/2026')}
print(f'\n━━━ PAINEL ATUAL DA ANNA ━━━')
print(f'Total: {len(anna_ids)} torneios ({len(anna_26_ids)} em 2026)')

# ── DELTA ──
filtered_ids = {t['id'] for t in filtered}
adds = filtered_ids - anna_26_ids
removes = anna_26_ids - filtered_ids
keeps = filtered_ids & anna_26_ids

print(f'\n━━━ DELTA (2026 só) ━━━')
print(f'Mantém: {len(keeps)} torneios')
print(f'Adiciona: {len(adds)} torneios novos')
print(f'Remove: {len(removes)} torneios atuais')

# Detalhe dos removidos (o cliente perde visibilidade)
print(f'\n━━━ Torneios que ANNA PERDE (removidos do painel) ━━━')
synced_by_id = {t['id']: t for t in synced['tournaments']}
removed_list = [synced_by_id[i] for i in removes if i in synced_by_id]
removed_list.sort(key=lambda t: t.get('startDate', ''))
for t in removed_list[:30]:
    tier = (t.get('tiers') or t.get('tier') or '—')
    if isinstance(tier, list): tier = tier[0] if tier else '—'
    print(f'  {t.get("startDate","?"):12s} {tier or "—":4s} {(t.get("state","?") or "?"):3s} {t.get("name","")[:65]}')
if len(removed_list) > 30:
    print(f'  ... +{len(removed_list) - 30} torneios')

# Detalhe dos novos adicionados
print(f'\n━━━ Torneios que ANNA GANHA (novos no painel) ━━━')
filtered_by_id = {t['id']: t for t in filtered}
add_list = [filtered_by_id[i] for i in adds]
add_list.sort(key=lambda t: t.get('startDate', ''))
for t in add_list[:30]:
    tier = (t.get('tiers') or ['—'])[0]
    print(f'  {t.get("startDate","?"):12s} {tier or "—":4s} {(t.get("state","?") or "?"):3s} {t.get("name","")[:65]}')
if len(add_list) > 30:
    print(f'  ... +{len(add_list) - 30} torneios')

# Distribuição mensal do resultado
print(f'\n━━━ Distribuição mensal do novo painel (2026) ━━━')
by_month_new = Counter(int(t['startDate'].split('/')[1]) for t in filtered if t.get('startDate'))
by_month_old = Counter(int(t['startDate'].split('/')[1]) for t in synced['tournaments'] if t.get('startDate','').endswith('/2026'))
print(f'{"Mês":4s} {"Hoje":>6s} {"Novo":>6s} {"Δ":>6s}')
for m in range(1, 13):
    o = by_month_old.get(m, 0); n = by_month_new.get(m, 0)
    delta = n - o
    sym = f'+{delta}' if delta > 0 else (f'{delta}' if delta < 0 else '0')
    print(f'  {m:02d} {o:>5d} {n:>6d} {sym:>6s}')
