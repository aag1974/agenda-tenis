#!/usr/bin/env python3
"""
Simulação Etapa 4 v2 — combina base TI + synced overlay pra
contornar limitações de parsing de tier antes de refinar.
"""

import json
from collections import Counter

PROFILE_ID = 'b06bcc2b14b6e149'

base = json.load(open('data/ti-catalogo-base.json'))
profile = next(p for p in json.load(open('data/profiles.json')) if p['id'] == PROFILE_ID)
synced = json.load(open(f'data/profile-{PROFILE_ID}/synced.json'))

scope = profile.get('scope', {})
cbt_tiers = set(scope.get('cbt', {}).get('tiers', []))
fed_ufs = set(scope.get('federacoes_uf', []))
current_cat = synced['athlete']['rankingNational']['category']

# ── Universo combinado: base + tudo do synced (overlay) ──
universe = dict(base['tournaments'])
for at in synced['tournaments']:
    tid = str(at['id'])
    # Normaliza tier do synced (pode estar como string em `tier` ou array em `tiers`)
    tiers = at.get('tiers')
    if not tiers and at.get('tier'):
        tiers = [at['tier']]
    if tid in universe:
        # Mantém o da base, mas usa tier do synced se base está vazia
        if not universe[tid].get('tiers') and tiers:
            universe[tid] = {**universe[tid], 'tiers': tiers}
    else:
        # Adiciona o que está só no synced
        universe[tid] = {
            'id': tid, 'name': at.get('name'), 'city': at.get('city'),
            'state': at.get('state'), 'startDate': at.get('startDate'),
            'endDate': at.get('endDate'), 'tiers': tiers or [],
            'kind': 'tennis',
            'audience': 'juvenil',  # synced só tem juvenis
        }

# ── Pega só juvenil tennis 2026 ──
def is_juvenil_2026(t):
    if not t.get('startDate', '').endswith('/2026'): return False
    if t.get('kind') and t['kind'] not in ('tennis', None): return False
    return True

universo_26 = [t for t in universe.values() if is_juvenil_2026(t)]
print(f'━━━ Universo combinado (base + synced overlay) ━━━')
print(f'Juvenil tennis 2026: {len(universo_26)}')

# Audience pra esse subset
aud = Counter(t.get('audience') for t in universo_26)
print(f'  Por audience: {dict(aud)}')

# ── Filtro de escopo ──
filtered = []
for t in universo_26:
    # Por enquanto, ignora audience "unknown" — assume que se tem tier CBT é juvenil
    tiers = t.get('tiers') or []
    primary = tiers[0] if tiers else None
    is_cbt = primary in cbt_tiers
    is_fed_uf = (not tiers) and (t.get('state') in fed_ufs) and (t.get('audience') == 'juvenil')
    if is_cbt or is_fed_uf:
        filtered.append({**t, '_via': 'CBT' if is_cbt else 'FED'})

via_cbt = sum(1 for t in filtered if t['_via']=='CBT')
via_fed = sum(1 for t in filtered if t['_via']=='FED')
print(f'\n━━━ COM FILTRO (CBT={sorted(cbt_tiers)} + Fed={sorted(fed_ufs)}) ━━━')
print(f'Visíveis: {len(filtered)} ({via_cbt} CBT + {via_fed} Fed)')

# ── Comparação com painel atual ──
anna_26_ids = {str(t['id']) for t in synced['tournaments'] if t.get('startDate','').endswith('/2026')}
filtered_ids = {str(t['id']) for t in filtered}
keeps = filtered_ids & anna_26_ids
adds = filtered_ids - anna_26_ids
removes = anna_26_ids - filtered_ids

print(f'\n━━━ DELTA ━━━')
print(f'Painel atual (2026): {len(anna_26_ids)}')
print(f'Painel novo (2026):  {len(filtered_ids)}')
print(f'  Mantém:   {len(keeps)}')
print(f'  Adiciona: {len(adds)}')
print(f'  Remove:   {len(removes)}')

# Análise dos removidos: por que cada um saiu?
print(f'\n━━━ Por que torneios foram REMOVIDOS ━━━')
synced_by_id = {str(t['id']): t for t in synced['tournaments']}
razoes = Counter()
for tid in removes:
    at = synced_by_id[tid]
    tier_anna = at.get('tier') or (at.get('tiers') or [None])[0]
    state_anna = at.get('state')
    # Por que ele não passou no filtro?
    if tier_anna and tier_anna not in cbt_tiers:
        razoes[f'tier {tier_anna} fora do scope'] += 1
    elif not tier_anna and state_anna not in fed_ufs:
        razoes[f'sem tier e UF {state_anna} fora de fed_ufs'] += 1
    elif tier_anna in cbt_tiers:
        razoes['tier CBT está no scope MAS filtro derrubou (bug?)'] += 1
    else:
        razoes['outro'] += 1
for k, v in razoes.most_common():
    print(f'  {v:3d} · {k}')

# Detalhe dos "tier CBT está no scope" — quero ver se há bug
print(f'\n━━━ Amostra removidos por "sem tier e UF fora de fed_ufs" ━━━')
for tid in list(removes)[:15]:
    at = synced_by_id[tid]
    tier_a = at.get('tier') or (at.get('tiers') or ['—'])[0] or '—'
    print(f'  id={tid} | {at.get("startDate","?"):12s} {tier_a:4s} {at.get("state","?"):3s} | {at.get("name","")[:55]}')

# Distribuição mensal
print(f'\n━━━ Distribuição mensal ━━━')
by_old = Counter(int(t['startDate'].split('/')[1]) for t in synced['tournaments'] if t.get('startDate','').endswith('/2026'))
by_new = Counter(int(t['startDate'].split('/')[1]) for t in filtered)
print(f'{"Mês":4s} {"Atual":>6s} {"Novo":>6s} {"Δ":>6s}')
for m in range(1, 13):
    o = by_old.get(m, 0); n = by_new.get(m, 0)
    delta = n - o
    sym = f'+{delta}' if delta > 0 else (str(delta) if delta < 0 else '0')
    print(f'  {m:02d} {o:>5d} {n:>6d} {sym:>6s}')
