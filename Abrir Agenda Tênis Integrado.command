#!/bin/zsh
# Launcher clicável para o Agenda Tênis Integrado.
# Abra o Finder, dê duplo clique neste arquivo (na primeira vez, talvez seja necessário
# clicar com botão direito → Abrir, e confirmar a execução).

set -e
cd "$(dirname "$0")"

# Tenta carregar nvm se disponível (caso o terminal padrão não tenha node no PATH)
if [ -z "$(command -v node)" ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
fi

if [ -z "$(command -v node)" ]; then
  echo "❌ Node.js não encontrado. Instale em https://nodejs.org/ e tente de novo."
  read -k 1 "?Pressione qualquer tecla para fechar..."
  exit 1
fi

PORT="${PORT:-4173}"

# Se já estiver rodando, só abrir o navegador
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✓ Servidor já está rodando em http://localhost:$PORT"
  open "http://localhost:$PORT"
  exit 0
fi

# Instalar dependências se necessário
if [ ! -d node_modules ]; then
  echo "📦 Instalando dependências (primeira execução)..."
  npm install
fi

echo "🎾 Subindo Agenda Tênis Integrado em http://localhost:$PORT ..."
# Abre o navegador depois de 2s
( sleep 2 && open "http://localhost:$PORT" ) &

node backend/server.js
echo ""
echo "✓ App encerrado. Pode fechar esta janela."
# Tenta fechar a aba do Terminal automaticamente (precisa de permissão de Acessibilidade)
osascript -e 'tell application "Terminal" to close (every window whose name contains "Abrir Agenda")' 2>/dev/null || true
