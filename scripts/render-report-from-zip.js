// Renderiza HTML do relatório a partir de pasta com synced.json + matches.json
// (estrutura do export.zip). Usado pra gerar baseline localmente sem mexer
// no storage criptografado.
//
// Uso:
//   node scripts/render-report-from-zip.js <pasta-com-jsons> <saida.html>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateReportHtmlFromData } from '../backend/report.js';

const [, , dataDir, outFile] = process.argv;
if (!dataDir || !outFile) {
  console.error('Uso: node scripts/render-report-from-zip.js <pasta> <saida.html>');
  process.exit(1);
}

const meta = JSON.parse(readFileSync(join(dataDir, 'meta.json'), 'utf8'));
const synced = JSON.parse(readFileSync(join(dataDir, 'synced.json'), 'utf8'));
const matchesData = JSON.parse(readFileSync(join(dataDir, 'matches.json'), 'utf8'));

const html = generateReportHtmlFromData({
  profile: meta.profile,
  synced,
  matches: matchesData.matches || [],
  profileId: meta.profile?.id,
});
writeFileSync(outFile, html);
console.log(`OK — ${outFile} gerado (${(html.length / 1024).toFixed(1)} KB).`);
