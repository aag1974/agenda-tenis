// Preview do relatório — roda offline com dados reais da Anna.
// Iteramos no template em backend/report.js sem precisar rodar o servidor.
//
// Uso: node scripts/preview-report.js [profileId]
//   - Sem argumento: usa o primeiro profile do data/profiles.json
//   - Com argumento: usa o profile com aquele id
//
// Output: gera /tmp/tennis-flow-report.html e abre no browser default.
// Pressione ⌘+P pra ver como vai sair em PDF.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { generateReportHtml } from '../backend/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const PROFILES_FILE = join(DATA_DIR, 'profiles.json');

let profileId = process.argv[2];
if (!profileId) {
  if (!existsSync(PROFILES_FILE)) {
    console.error('❌ data/profiles.json não existe. Rode o app pelo menos uma vez antes.');
    process.exit(1);
  }
  const profiles = JSON.parse(readFileSync(PROFILES_FILE, 'utf8'));
  if (!profiles.length) {
    console.error('❌ Nenhum profile cadastrado.');
    process.exit(1);
  }
  profileId = profiles[0].id;
  console.log(`Usando primeiro profile: ${profileId} (${profiles[0].athleteName || '?'})`);
}

const html = generateReportHtml(profileId);
const outFile = '/tmp/tennis-flow-report.html';
writeFileSync(outFile, html);
console.log(`✓ Gerado: ${outFile}`);
console.log(`  Abrindo no browser… (depois ⌘+P pra ver PDF)`);

// Abre no default browser do macOS
spawn('open', [outFile], { detached: true, stdio: 'ignore' }).unref();
