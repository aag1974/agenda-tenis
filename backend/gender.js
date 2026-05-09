// Detecção e flexão de gênero pra textos do relatório.
//
// O Tênis Integrado usa categoria "12M", "14F", etc. — pivô do gênero.
// Detectamos olhando: synced.athlete.category → tournaments → matches.
// Default: masculino genérico (preferência do produto, validada com user).

export function detectGender(synced, matches) {
  const candidates = [];
  if (synced?.athlete?.category) candidates.push(synced.athlete.category);
  for (const t of synced?.tournaments || []) {
    if (t.category) candidates.push(t.category);
  }
  for (const m of matches || []) {
    if (m.category) candidates.push(m.category);
  }
  let m = 0, f = 0;
  for (const c of candidates) {
    const s = String(c).toUpperCase();
    if (/\b\d+M\b/.test(s) || /\b\d+M[SDXM]\b/.test(s)) m++;
    else if (/\b\d+F\b/.test(s) || /\b\d+F[SDX]\b/.test(s)) f++;
  }
  if (m > f) return 'M';
  if (f > m) return 'F';
  return 'M'; // default masculino genérico
}

// Detecta a categoria principal (ex.: "12M", "14F") pra usar como label.
// Pega a mais frequente nos torneios — atleta pode ter jogado em
// categorias acima/abaixo eventualmente, mas a "principal" é a moda.
export function detectMainCategory(synced, matches) {
  const tally = new Map();
  const push = (c) => {
    if (!c) return;
    const norm = String(c).toUpperCase().match(/\b\d+[MF][SDX]?\b/);
    if (norm) tally.set(norm[0], (tally.get(norm[0]) || 0) + 1);
  };
  push(synced?.athlete?.category);
  for (const t of synced?.tournaments || []) push(t.category);
  for (const m of matches || []) push(m.category);
  if (!tally.size) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// Expande "12M" → "12 anos masculino simples" (label legível pra capa).
export function categoryFullLabel(cat, gender) {
  if (!cat) return null;
  const ageMatch = cat.match(/^(\d+)/);
  const age = ageMatch ? ageMatch[1] : null;
  const sexLabel = gender === 'F' ? 'feminino' : 'masculino';
  if (!age) return cat;
  return `${cat} (${age} anos ${sexLabel} simples)`;
}

// Termos flexionáveis. Convenção: chaves em "snake" descrevem o conceito;
// valor é a string a interpolar. Mantém masculino genérico como default
// pra qualquer chave não declarada.
export function genderTerms(gender) {
  const F = gender === 'F';
  return {
    gender,
    // Pronomes
    ele: F ? 'ela' : 'ele',
    Ele: F ? 'Ela' : 'Ele',
    dele: F ? 'dela' : 'dele',
    Dele: F ? 'Dela' : 'Dele',
    // Substantivos
    atleta: F ? 'a atleta' : 'o atleta',
    Atleta: F ? 'A atleta' : 'O atleta',
    do_atleta: F ? 'da atleta' : 'do atleta',
    da_atleta: F ? 'da atleta' : 'do atleta', // alias
    atletas_plural: 'atletas', // neutro
    adversario: F ? 'adversária' : 'adversário',
    Adversario: F ? 'Adversária' : 'Adversário',
    adversarios: F ? 'adversárias' : 'adversários',
    Adversarios: F ? 'Adversárias' : 'Adversários',
    adversaria_mais_forte: F ? 'adversária mais forte' : 'adversário mais forte',
    adversaria_mais_fraca: F ? 'adversária mais fraca' : 'adversário mais fraco',
    parelhas: F ? 'parelhas' : 'parelhos',
    parecidas: F ? 'parecidas' : 'parecidos',
    enfrentadas: F ? 'enfrentadas' : 'enfrentados',
    competitivas: F ? 'competitivas' : 'competitivos',
    filiadas: F ? 'filiadas' : 'filiados',
    fortes_fracas: F ? 'fortes ou fracas' : 'fortes ou fracos',
    // Adjetivos comuns em narrativa
    inesperada: F ? 'inesperada' : 'inesperado',
    outra: F ? 'outra' : 'outro',
    // Frases inteiras úteis
    outra_atleta_agora: F ? 'outra atleta agora' : 'outro atleta agora',
  };
}
