#!/bin/zsh
# Cria um zip limpo do app, pronto pra enviar a outros pais.
# O zip exclui suas credenciais, dados sincronizados e node_modules.

set -e
cd "$(dirname "$0")"

DEST="$HOME/Desktop/Agenda Tenis Integrado - compartilhar.zip"
TMP="$(mktemp -d)/agenda-app"

echo "📦 Empacotando..."

mkdir -p "$TMP"

# Copia somente o necessário, excluindo dados sensíveis e dependências
rsync -a \
  --exclude='node_modules/' \
  --exclude='data/' \
  --exclude='.env' \
  --exclude='*.zip' \
  --exclude='.DS_Store' \
  --exclude='Empacotar para Compartilhar.command' \
  --exclude='Abrir Agenda Tênis.command' \
  ./ "$TMP/"

# Garante que o launcher esteja executável
chmod +x "$TMP/Abrir Agenda Tênis Integrado.command"

# Remove zip anterior (se existir) e cria o novo
rm -f "$DEST"
( cd "$(dirname "$TMP")" && zip -rq "$DEST" "agenda-app" )
rm -rf "$(dirname "$TMP")"

SIZE=$(du -h "$DEST" | cut -f1)

echo ""
echo "✓ Zip pronto: $DEST"
echo "  Tamanho: $SIZE"
echo ""
echo "Mande pelo WeTransfer / Google Drive / iCloud / pendrive."
echo ""
echo "O destinatário só precisa:"
echo "  1. Descompactar"
echo "  2. Abrir o LEIA-ME.txt"
echo "  3. Seguir os passos"
echo ""
read -k 1 "?Pressione qualquer tecla para fechar..."
