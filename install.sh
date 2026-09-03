#!/bin/sh
# HangPay installer — https://github.com/akshay/HangPay
# Idempotent: safe to re-run. Installs or upgrades hangpay globally via npm.
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed."
  echo "HangPay requires Node.js 18 or newer."
  echo ""
  echo "Install Node.js with one of:"
  echo "  macOS:         brew install node"
  echo "  Debian/Ubuntu: sudo apt install -y nodejs npm     (or use nvm: https://github.com/nvm-sh/nvm)"
  echo "  Fedora:        sudo dnf install -y nodejs"
  echo "  Generic:       https://nodejs.org/  |  https://github.com/nvm-sh/nvm"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/^v//')
MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d '.' -f 1)

if [ "$MAJOR_VERSION" -lt 18 ]; then
  echo "Error: Node.js v18 or newer is required (detected v$NODE_VERSION)."
  echo "Please upgrade Node.js — see https://nodejs.org/ or use nvm."
  exit 2
fi

NPM_PREFIX=$(npm config get prefix 2>/dev/null || echo "")
if [ -n "$NPM_PREFIX" ] && [ ! -w "$NPM_PREFIX" ] && [ "$(id -u)" -ne 0 ]; then
  echo "Error: npm global prefix is not writable ($NPM_PREFIX)."
  echo ""
  echo "Retry with either:"
  echo "  sudo sh -c \"\$(curl -fsSL https://raw.githubusercontent.com/akshay/HangPay/main/install.sh)\""
  echo "  or configure a user-writable prefix: https://docs.npmjs.com/resolving-eacces-permissions-errors"
  exit 3
fi

echo "Installing HangPay via npm…"
if ! npm install -g hangpay@latest; then
  echo "Error: HangPay installation failed."
  exit 3
fi

INSTALLED_VER=$(hangpay --version 2>/dev/null || echo "latest")
echo ""
echo "✓ HangPay installed ($INSTALLED_VER)"
echo ""
echo "Next steps:"
echo "  1. hangpay init-vault     # initialize encrypted credential vault"
echo "  2. hangpay launch         # launch Chrome with CDP remote debugging"
echo "  3. hangpay --help         # full command reference"