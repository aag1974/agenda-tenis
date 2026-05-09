// Test runner — auto-descobre todos os scripts/test-*.js e executa em sequência.
// Falha (exit 1) se qualquer teste falhar. Rodado por `npm test`.
//
// Princípio: testes são primeiros-cidadãos. Adicionar novos testes = criar
// `scripts/test-<algo>.js` que termine com process.exit(1) quando falhar.
// Não precisa registrar — runner descobre automaticamente.

import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;

const tests = readdirSync(SCRIPTS_DIR)
  .filter(f => /^test-.+\.js$/.test(f))
  .filter(f => statSync(join(SCRIPTS_DIR, f)).isFile())
  .sort();

if (tests.length === 0) {
  console.log('Nenhum teste encontrado em scripts/test-*.js');
  process.exit(0);
}

console.log(`▶ Rodando ${tests.length} suite(s) de teste...\n`);

let passed = 0;
let failed = 0;

for (const file of tests) {
  console.log(`━━━ ${file} ━━━`);
  const result = spawnSync('node', [join(SCRIPTS_DIR, file)], {
    stdio: 'inherit',
  });
  if (result.status === 0) {
    passed++;
  } else {
    failed++;
    console.log(`✗ FALHOU: ${file}\n`);
  }
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Resultado: ${passed}/${tests.length} suites passaram`);

if (failed > 0) {
  console.log(`❌ ${failed} suite(s) com falha — bloqueia deploy/commit.`);
  process.exit(1);
} else {
  console.log(`✅ Todos os testes passaram.`);
  process.exit(0);
}
