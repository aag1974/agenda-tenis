#!/usr/bin/env python3
"""
Análise do calendário 2024→2025→2026 com base no histórico
enumerado (data/ti-historico.json, 622 torneios juvenis).
"""

import json, re
from datetime import date, timedelta
from collections import Counter, defaultdict

PT_DOW = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
PT_ACCENTS = str.maketrans('ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')

def parse_d(s):
    if not s: return None
    dd, mm, yy = s.split('/')
    try: return date(int(yy), int(mm), int(dd))
    except: return None

def dow(d): return PT_DOW[d.weekday()] if d else '?'

def canon(name):
    if not name: return ('', None)
    n = name.upper().translate(PT_ACCENTS)
    n = re.sub(r'\s+', ' ', n).strip()
    etapa_n = None
    m = re.search(r'\b(\d+)[ªA°º]?\s*ETAPA\b', n)
    if not m: m = re.search(r'\bETAPA\s+(\d+)\b', n)
    if m: etapa_n = m.group(1)
    n = re.sub(r'\b\d+[ªA°º]?\s*ETAPA\b\s*', 'ETAPA ', n)
    n = re.sub(r'\bETAPA\s+\d+\b', 'ETAPA', n)
    # remove sufixos de categoria
    n = re.sub(r'\s*-\s*E?-?\d+[FMA]?\w*-?[A-Z]?\s*$', '', n)
    n = re.sub(r'\b\d+[ªA°º]\b', '', n)
    n = re.sub(r'\b20\d{2}\b', '', n)
    n = re.sub(r'\bINFANTOJUVENIL\b|\bJUVENIL\b|\bKIDS\b|\bINFANTO[\s-]JUVENIL\b', '', n)
    n = re.sub(r'\bTENIS\b|\bTENNIS\b', '', n)
    n = re.sub(r'\b[IVX]+\s+', '', n)
    n = re.sub(r'\s+', ' ', n).strip(' -')
    return (n, etapa_n)

def key(t):
    cn, et = canon(t.get('name',''))
    city = (t.get('city') or '').upper().strip().translate(PT_ACCENTS)
    return (cn, et, city, t.get('state') or '')

def match_year(catA, catB, max_shift_days=42):
    """Casa torneios entre dois conjuntos por chave canônica + cidade,
    escolhe melhor par por proximidade temporal."""
    idxB = defaultdict(list)
    for t in catB:
        if t.get('startDate'): idxB[key(t)].append(t)
    pares = []
    used = set()
    for tA in sorted(catA, key=lambda x: parse_d(x.get('startDate')) or date.max):
        dA = parse_d(tA.get('startDate'))
        if not dA: continue
        candidates = idxB.get(key(tA), [])
        best, bdist = None, 999
        for tB in candidates:
            if tB['id'] in used: continue
            dB = parse_d(tB.get('startDate'))
            if not dB: continue
            try: dA_to_B_year = dA.replace(year=dB.year)
            except: dA_to_B_year = dA.replace(year=dB.year, day=28)
            dist = abs((dB - dA_to_B_year).days)
            if dist < bdist:
                bdist = dist; best = tB
        if best and bdist <= max_shift_days:
            pares.append((tA, best, bdist))
            used.add(best['id'])
    return pares

# ── Carrega ──
H = json.load(open('data/ti-historico.json'))['tournaments']
print(f'Histórico filtrado: {len(H)} torneios juvenis')
y2024 = [t for t in H if t['startDate'].endswith('/2024')]
y2025 = [t for t in H if t['startDate'].endswith('/2025')]
y2026 = [t for t in H if t['startDate'].endswith('/2026')]
print(f'  2024: {len(y2024)} (parcial — só segundo semestre por causa do range de IDs)')
print(f'  2025: {len(y2025)} (ano completo)')
print(f'  2026: {len(y2026)} (jan-mai)')

# ── 2024 → 2025 ──
pares_24_25 = match_year(y2024, y2025)
print(f'\n── 2024→2025 ── (validação histórica)')
print(f'Pares casados: {len(pares_24_25)}/{len(y2024)} = {100*len(pares_24_25)/len(y2024):.0f}% dos 2024 têm match em 2025')

# DOW e shift
shifts_24_25 = []
dow_same_24_25 = 0
for tA, tB, _ in pares_24_25:
    dA, dB = parse_d(tA['startDate']), parse_d(tB['startDate'])
    if dA.weekday() == dB.weekday(): dow_same_24_25 += 1
    try: dA_2025 = dA.replace(year=2025)
    except: dA_2025 = dA.replace(year=2025, day=28)
    shifts_24_25.append((dB - dA_2025).days)
if pares_24_25:
    print(f'Mesmo dia-da-semana: {dow_same_24_25}/{len(pares_24_25)} = {100*dow_same_24_25/len(pares_24_25):.0f}%')
    print(f'|shift|≤3d: {sum(1 for s in shifts_24_25 if abs(s)<=3)}/{len(pares_24_25)} ({100*sum(1 for s in shifts_24_25 if abs(s)<=3)/len(pares_24_25):.0f}%)')
    print(f'|shift|≤7d: {sum(1 for s in shifts_24_25 if abs(s)<=7)}/{len(pares_24_25)} ({100*sum(1 for s in shifts_24_25 if abs(s)<=7)/len(pares_24_25):.0f}%)')
    print(f'Shift mediano: {sorted(shifts_24_25)[len(shifts_24_25)//2]:+d}d · médio: {sum(shifts_24_25)/len(shifts_24_25):+.1f}d')

# ── 2025 → 2026 ──
pares_25_26 = match_year(y2025, y2026)
print(f'\n── 2025→2026 (Jan-Mai) ── (validação contra realizado)')
print(f'Pares casados: {len(pares_25_26)}/{len(y2025)} ({100*len(pares_25_26)/len(y2025):.0f}% dos 2025 já têm match em 2026)')

shifts_25_26 = []
dow_same_25_26 = 0
for tA, tB, _ in pares_25_26:
    dA, dB = parse_d(tA['startDate']), parse_d(tB['startDate'])
    if dA.weekday() == dB.weekday(): dow_same_25_26 += 1
    try: dA_2026 = dA.replace(year=2026)
    except: dA_2026 = dA.replace(year=2026, day=28)
    shifts_25_26.append((dB - dA_2026).days)

if pares_25_26:
    print(f'Mesmo dia-da-semana: {dow_same_25_26}/{len(pares_25_26)} = {100*dow_same_25_26/len(pares_25_26):.0f}%')
    print(f'|shift|≤3d: {sum(1 for s in shifts_25_26 if abs(s)<=3)}/{len(pares_25_26)} ({100*sum(1 for s in shifts_25_26 if abs(s)<=3)/len(pares_25_26):.0f}%)')
    print(f'|shift|≤7d: {sum(1 for s in shifts_25_26 if abs(s)<=7)}/{len(pares_25_26)} ({100*sum(1 for s in shifts_25_26 if abs(s)<=7)/len(pares_25_26):.0f}%)')
    print(f'Shift mediano: {sorted(shifts_25_26)[len(shifts_25_26)//2]:+d}d · médio: {sum(shifts_25_26)/len(shifts_25_26):+.1f}d')

# Histograma de shifts
print(f'\nDistribuição shifts 2025→2026 (em dias):')
buckets = Counter()
for s in shifts_25_26:
    if abs(s) <= 1: buckets['(-1 a +1)'] += 1
    elif abs(s) <= 3: buckets['±2-3d'] += 1
    elif abs(s) <= 7: buckets['±4-7d'] += 1
    elif abs(s) <= 14: buckets['±8-14d'] += 1
    elif abs(s) <= 28: buckets['±15-28d'] += 1
    else: buckets['>28d'] += 1
for k in ['(-1 a +1)', '±2-3d', '±4-7d', '±8-14d', '±15-28d', '>28d']:
    v = buckets.get(k, 0)
    bar = '█'*v
    print(f'  {k:12s} {bar} {v}')

# ── Projeção segundo semestre 2026 ──
print(f'\n── Projeção 2º semestre 2026 ──')
def projeta_mesmo_dow_e_semana(d_orig):
    """Base = d_orig + 365 dias; ajusta ±3 pra cair no mesmo dia-da-semana."""
    base = d_orig + timedelta(days=365)
    target_dow = d_orig.weekday()
    delta = (target_dow - base.weekday()) % 7
    if delta > 3: delta -= 7
    return base + timedelta(days=delta)

# 2025 que NÃO casou com 2026 (provavelmente porque ainda não aconteceram em 2026)
matched25_ids = {tA['id'] for tA, _, _ in pares_25_26}
nao_casados_25 = [t for t in y2025 if t['id'] not in matched25_ids]
# Pega só os do 2º semestre 2025 (Jun-Dez) — esses projetam pro 2º sem 2026
seg_sem_25 = [t for t in nao_casados_25 if int(t['startDate'].split('/')[1]) >= 6]
print(f'Torneios 2025 não-casados (sem equivalente 2026 ainda): {len(nao_casados_25)}')
print(f'  Dos quais, do 2º semestre 2025 (Jun-Dez): {len(seg_sem_25)}')

proj = []
for t25 in seg_sem_25:
    d25 = parse_d(t25['startDate'])
    if not d25: continue
    pdate = projeta_mesmo_dow_e_semana(d25)
    proj.append((t25, pdate))
proj.sort(key=lambda x: x[1])

print(f'\nProjeção (primeiros 30 torneios):')
print(f'{"Data 2026":12s} {"DOW":4s} {"Tier":5s} {"Local":24s} {"Original 2025":12s} Torneio')
for t25, pd in proj[:30]:
    tier = (t25.get('tiers') or ['—'])[0] if t25.get('tiers') else '—'
    loc = f"{t25.get('city','?')[:14]}-{t25.get('state','?')}"
    print(f'  {pd.strftime("%d/%m/%Y"):12s} {dow(pd):4s} {tier:5s} {loc:24s} {t25["startDate"]:12s} {t25["name"][:45]}')

if len(proj) > 30:
    print(f'  ... +{len(proj)-30} torneios')

# Salva projeção
out = 'data/projecao-2026-h2.json'
projecao_data = []
for t25, pd in proj:
    projecao_data.append({
        'data_projetada_2026': pd.strftime('%Y-%m-%d'),
        'dow_projetado': PT_DOW[pd.weekday()],
        'torneio_original_2025': {
            'startDate': t25['startDate'],
            'endDate': t25.get('endDate'),
            'name': t25['name'],
            'city': t25.get('city'),
            'state': t25.get('state'),
            'tiers': t25.get('tiers') or [],
            'id': t25['id'],
        },
    })
json.dump({
    'projetadoEm': '2026-05-17',
    'metodologia': 'data 2025 + 365 dias, ajustado ±3 dias pra preservar dia-da-semana',
    'baseValidacao': f'{dow_same_25_26}/{len(pares_25_26)} = {100*dow_same_25_26/len(pares_25_26):.0f}% mantém DOW em pares casados',
    'count': len(projecao_data),
    'torneios': projecao_data,
}, open(out, 'w'), ensure_ascii=False, indent=2)
print(f'\n✓ Projeção salva em {out} ({len(projecao_data)} torneios)')
