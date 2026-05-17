#!/usr/bin/env python3
"""
Estudo: planejar 2026 com base em 2025.
Carrega ti-catalog-2025.json e ti-catalog-2026.json,
casa torneios entre anos por chave canônica, valida a hipótese de
dia-da-semana e mede precisão da projeção contra o realizado (Jan-Mai/2026).
"""

import json
import re
from datetime import date, timedelta
from collections import Counter, defaultdict

PT_DOW = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

def parse_d(s):
    if not s: return None
    dd, mm, yy = s.split('/')
    try: return date(int(yy), int(mm), int(dd))
    except: return None

def dow(d):
    return PT_DOW[d.weekday()] if d else '?'

def canon_name(name):
    """Chave canônica: remove números ordinais (1ª/2ª Etapa), gênero (12F/12M),
    pontuação extra. Mantém o nome-tronco do circuito + cidade quando vem no nome."""
    if not name: return ''
    n = name.upper()
    n = re.sub(r'\s+', ' ', n).strip()
    # remove sufixos "- 12F" "- 12M" "- 14F" "- E-12F" etc
    n = re.sub(r'\s*-\s*E?-?\d+[FMA]?-?[A-Z]?\s*$', '', n)
    # remove "1ª ETAPA" / "1A ETAPA" / "ETAPA 1"
    n = re.sub(r'\b\d+[ªA°º]?\s*ETAPA\b', 'ETAPA', n)
    n = re.sub(r'\bETAPA\s+\d+\b', 'ETAPA', n)
    # remove ordinais isolados ("3ª")
    n = re.sub(r'\b\d+[ªA°º]\b', '', n)
    # remove ano explícito (2025/2026)
    n = re.sub(r'\b20\d{2}\b', '', n)
    n = re.sub(r'\s+', ' ', n).strip(' -')
    return n

def key_for(t):
    """Chave de matching: nome canônico + cidade + estado + tier."""
    return (canon_name(t.get('name', '')), (t.get('city') or '').upper().strip(), t.get('state') or '', t.get('tier') or '')

# Carrega catálogos
c25 = json.load(open('data/ti-catalog-2025.json'))['tournaments']
c26 = json.load(open('data/ti-catalog-2026.json'))['tournaments']
print(f'Catálogo 2025: {len(c25)} torneios')
print(f'Catálogo 2026: {len(c26)} torneios')

# Indexa
idx25 = defaultdict(list)
for t in c25:
    if t.get('startDate'): idx25[key_for(t)].append(t)
idx26 = defaultdict(list)
for t in c26:
    if t.get('startDate'): idx26[key_for(t)].append(t)

# Matching
pares = []  # (t25, t26)
matched25_ids = set()
matched26_ids = set()
for k, lst25 in idx25.items():
    lst26 = idx26.get(k, [])
    if not lst26: continue
    # se múltiplos torneios com mesma chave, parea por proximidade de "semana do ano"
    used26 = set()
    for t25 in lst25:
        d25 = parse_d(t25['startDate'])
        if not d25: continue
        best = None
        best_dist = 999
        for t26 in lst26:
            if t26['id'] in used26: continue
            d26 = parse_d(t26['startDate'])
            if not d26: continue
            # Distância: |dias entre mesmas-datas-do-ano|
            d25_shifted = d25.replace(year=2026)
            dist = abs((d26 - d25_shifted).days) if d25.year == 2025 else 999
            if dist < best_dist:
                best_dist = dist
                best = t26
        if best and best_dist <= 21:  # tolerância: até 3 semanas
            pares.append((t25, best))
            matched25_ids.add(t25['id'])
            matched26_ids.add(best['id'])
            used26.add(best['id'])

print(f'\nPares casados 2025↔2026: {len(pares)}')
print(f'Torneios 2025 sem equivalente 2026: {len(c25) - len(matched25_ids)}')
print(f'Torneios 2026 sem equivalente 2025: {len(c26) - len(matched26_ids)}')

# ── Análise do deslocamento ──
shifts = []         # dias entre data 2026 e (data 2025 + 365 dias) → deslocamento puro
dow_keeps = 0       # quantos pares mantêm o mesmo DIA DA SEMANA de início
week_keeps = 0      # quantos pares caem na MESMA SEMANA-ISO

for t25, t26 in pares:
    d25 = parse_d(t25['startDate'])
    d26 = parse_d(t26['startDate'])
    if not d25 or not d26: continue
    d25_plus_365 = d25 + timedelta(days=365)
    shifts.append((d26 - d25_plus_365).days)
    if d25.weekday() == d26.weekday(): dow_keeps += 1
    if d25.isocalendar().week == d26.isocalendar().week: week_keeps += 1

print(f'\n── Hipóteses ──')
print(f'Mesmo dia-da-semana de início (Seg=Seg, Ter=Ter…): {dow_keeps}/{len(pares)} = {100*dow_keeps/len(pares):.0f}%')
print(f'Mesma semana-ISO do ano: {week_keeps}/{len(pares)} = {100*week_keeps/len(pares):.0f}%')
print(f'\nDistribuição do deslocamento (dias 2026 − dia equivalente 2025+365):')
ctr = Counter(shifts)
for shift in sorted(ctr.keys()):
    print(f'  {shift:+d} dias: {"█"*ctr[shift]} ({ctr[shift]})')

# Estatística do shift
shifts_sorted = sorted(shifts)
median_shift = shifts_sorted[len(shifts_sorted)//2]
print(f'\nMediana do shift: {median_shift:+d} dias')
print(f'Média do shift: {sum(shifts)/len(shifts):+.2f} dias')

# ── Validação: projeção 2026 vs realizado ──
# Para cada par, projeta a data 2026 a partir da data 2025 usando duas regras:
#   A) "mesmo dia-da-semana, semana correspondente" (shift de -1 a +6 pra cair no mesmo dow)
#   B) "data 2025 + 364 dias" (calendário shift fixo)
#   C) "data 2025 + mediana do shift observado"

def projeta_mesmo_dow(d25):
    """+364 dias mantém o dia da semana (52 semanas × 7 dias = 364).
    Mas se o calendário tradicional empurra +1 dia, mantemos DOW shiftando -1.
    Regra: data-base = d25 + 365 dias, depois ajusta ±3 dias pra cair no mesmo DOW."""
    base = d25 + timedelta(days=365)
    target_dow = d25.weekday()
    delta = (target_dow - base.weekday()) % 7
    if delta > 3: delta -= 7
    return base + timedelta(days=delta)

erros_A = []  # erro absoluto em dias, regra A
erros_B = []
erros_C = []
for t25, t26 in pares:
    d25 = parse_d(t25['startDate'])
    d26 = parse_d(t26['startDate'])
    if not d25 or not d26: continue
    pA = projeta_mesmo_dow(d25)
    pB = d25 + timedelta(days=364)
    pC = d25 + timedelta(days=365 + median_shift)
    erros_A.append(abs((d26 - pA).days))
    erros_B.append(abs((d26 - pB).days))
    erros_C.append(abs((d26 - pC).days))

def stats(xs, name):
    xs_s = sorted(xs)
    n = len(xs)
    print(f'  {name}: média {sum(xs)/n:.2f}d · mediana {xs_s[n//2]}d · ≤3d {sum(1 for x in xs if x<=3)}/{n} · ≤7d {sum(1 for x in xs if x<=7)}/{n} · max {max(xs)}d')

print(f'\n── Precisão das regras de projeção ──')
stats(erros_A, 'A) "mesmo DOW, semana equivalente" (base+365 e ajusta ≤±3 pro mesmo dia-da-semana)')
stats(erros_B, 'B) "data 2025 + 364 dias" (preserva DOW exato, mas pode pular semana)')
stats(erros_C, f'C) "data 2025 + (365 + mediana shift={median_shift})"')

# ── Casos onde a regra A erra ──
print(f'\n── Outliers da regra A (erro > 7 dias) ──')
for t25, t26 in pares:
    d25 = parse_d(t25['startDate'])
    d26 = parse_d(t26['startDate'])
    if not d25 or not d26: continue
    pA = projeta_mesmo_dow(d25)
    err = (d26 - pA).days
    if abs(err) > 7:
        print(f'  {t25["startDate"]} ({dow(d25)}) → {t26["startDate"]} ({dow(d26)}) | projetado {pA.strftime("%d/%m/%Y")} ({dow(pA)}) | erro {err:+d}d')
        print(f'    {canon_name(t25["name"])} · {t25.get("city")}-{t25.get("state")}')

# ── 2026 Jan-Mai validation: torneios CONFIRMADOS realizados ──
today = date(2026, 5, 17)
realized26 = [t for t in c26 if (d := parse_d(t.get('startDate'))) and d <= today]
print(f'\n── Realizado em 2026 até hoje (17/05): {len(realized26)} torneios ──')
# Quantos desses estão nos pares casados?
realized_ids = {t['id'] for t in realized26}
matched_realized = sum(1 for _, t26 in pares if t26['id'] in realized_ids)
print(f'  Casados com 2025: {matched_realized}/{len(realized26)} ({100*matched_realized/len(realized26):.0f}%)')

# ── Torneios 2025 do 2º semestre (Jun-Dez) sem equivalente 2026 ainda ──
projecao_2sem = []
for t25 in c25:
    if t25['id'] in matched25_ids: continue
    d25 = parse_d(t25.get('startDate'))
    if not d25: continue
    if d25.month < 6: continue  # só Jun-Dez 2025
    proj_d = projeta_mesmo_dow(d25)
    projecao_2sem.append((t25, proj_d))

print(f'\n── Projeção 2º semestre 2026 (torneios 2025 ainda sem match em 2026) ──')
print(f'Total a projetar: {len(projecao_2sem)}')
projecao_2sem.sort(key=lambda x: x[1])
for t25, proj_d in projecao_2sem[:20]:
    print(f'  ~{proj_d.strftime("%d/%m/%Y")} ({dow(proj_d)}) | tier {t25.get("tier") or "—"} | {t25.get("city")}-{t25.get("state")} | {t25["name"][:60]}')
if len(projecao_2sem) > 20:
    print(f'  ... +{len(projecao_2sem)-20} torneios')
