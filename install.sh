#!/bin/sh
set -e

REPO="ardasevinc/agent-comms"
INSTALL_DIR="/usr/local/bin"
BINARY="agent-comms"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

case "$OS" in
  linux|darwin) ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

TARGET="${OS}-${ARCH}"
URL="https://github.com/${REPO}/releases/latest/download/${BINARY}-${TARGET}"

echo "Downloading ${BINARY}-${TARGET}..."
curl -fSL "$URL" -o "${BINARY}"
chmod +x "${BINARY}"

if [ -w "$INSTALL_DIR" ]; then
  mv "${BINARY}" "${INSTALL_DIR}/${BINARY}"
else
  echo "Installing to ${INSTALL_DIR} (requires sudo)..."
  sudo mv "${BINARY}" "${INSTALL_DIR}/${BINARY}"
fi

echo "Installed ${BINARY} to ${INSTALL_DIR}/${BINARY}"
echo "First install? You can run '${BINARY} config init' to create a config file."
