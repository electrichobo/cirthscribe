#!/usr/bin/env bash
# ==============================================================================
# Kolbítar Linux Environment Provisioning & Smoke-Test Script
# Prepares Debian/Ubuntu, Fedora, or Arch Linux for building and testing Kolbítar.
# ==============================================================================

set -euo pipefail

BOLD="$(tput bold 2>/dev/null || true)"
GREEN="$(tput setaf 2 2>/dev/null || true)"
YELLOW="$(tput setaf 3 2>/dev/null || true)"
RED="$(tput setaf 1 2>/dev/null || true)"
RESET="$(tput sgr0 2>/dev/null || true)"

log() { echo -e "${BOLD}${GREEN}[kolbitar-setup]${RESET} $*"; }
warn() { echo -e "${BOLD}${YELLOW}[kolbitar-setup:warning]${RESET} $*"; }
err() { echo -e "${BOLD}${RED}[kolbitar-setup:error]${RESET} $*" >&2; }

# Parse flags
SKIP_DEPS=0
SMOKE_E2E=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --smoke-e2e) SMOKE_E2E=1 ;;
    *) ;;
  esac
done

log "Starting Kolbítar Linux environment provisioning..."

# Setup privilege escalation helper (none needed if running as root)
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    warn "Running as non-root user without sudo. Package installations may fail if permissions are missing."
  fi
fi

# 1. Detect Distribution and Package Manager
if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO="${ID:-linux}"
  LIKE="${ID_LIKE:-}"
else
  DISTRO="unknown"
  LIKE=""
fi

log "Detected Linux distribution: ${DISTRO} (${LIKE})"

install_system_dependencies() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Using apt-get to install system dependencies..."
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update
    $SUDO apt-get install -y \
      build-essential \
      curl \
      git \
      pkg-config \
      libwebkit2gtk-4.1-dev \
      libxdo-dev \
      libssl-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      webkit2gtk-driver \
      xvfb \
      xclip \
      ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    log "Using dnf to install system dependencies..."
    $SUDO dnf install -y \
      gcc \
      gcc-c++ \
      make \
      curl \
      git \
      pkgconfig \
      webkit2gtk4.1-devel \
      openssl-devel \
      libappindicator-gtk3-devel \
      librsvg2-devel \
      xdotool-devel \
      xclip \
      xorg-x11-server-Xvfb \
      ca-certificates
  elif command -v pacman >/dev/null 2>&1; then
    log "Using pacman to install system dependencies..."
    $SUDO pacman -S --needed --noconfirm \
      base-devel \
      curl \
      git \
      webkit2gtk-4.1 \
      openssl \
      libappindicator-gtk3 \
      librsvg \
      xdotool \
      xclip \
      xorg-server-xvfb \
      ca-certificates
  else
    warn "Unsupported package manager. Please ensure WebKitGTK 4.1, OpenSSL, and build essentials are installed manually."
  fi
}

if [ "$SKIP_DEPS" -eq 0 ]; then
  install_system_dependencies
fi

# 2. Check Rust Toolchain
if ! command -v cargo >/dev/null 2>&1; then
  log "Rust toolchain not detected. Installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  if [ -f "${HOME}/.cargo/env" ]; then
    . "${HOME}/.cargo/env"
  else
    export PATH="${HOME}/.cargo/bin:${PATH}"
  fi
else
  log "Rust toolchain detected: $(cargo --version)"
fi

# 3. Check Node.js and npm
install_node() {
  log "Installing Node.js 24 via NodeSource..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    curl -fsSL https://deb.nodesource.com/setup_24.x | $SUDO bash -
    $SUDO apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_24.x | $SUDO bash -
    $SUDO dnf install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -S --needed --noconfirm nodejs npm
  else
    err "Node.js 24 is required. Please install Node.js 24."
    exit 1
  fi
}

if ! command -v node >/dev/null 2>&1; then
  install_node
else
  NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "${NODE_MAJOR:-0}" -lt 24 ]; then
    warn "Detected Node.js $(node -v) is older than Node 24 (Node 24 is required for native TypeScript type stripping)."
    if [ "${DISTRO:-}" = "ubuntu" ] || [ "${DISTRO:-}" = "debian" ]; then
      log "Upgrading to Node.js 24..."
      install_node
    fi
  fi
fi
log "Node.js detected: $(node --version)"

# 4. Check / Install tauri-driver for WebDriver E2E testing
if ! command -v tauri-driver >/dev/null 2>&1; then
  log "Installing tauri-driver for WebDriver e2e testing..."
  cargo install tauri-driver --locked || warn "Could not install tauri-driver; WebDriver e2e will be skipped."
else
  log "tauri-driver detected: $(tauri-driver --version 2>/dev/null || echo 'installed')"
fi

# 5. Execute Smoke Test Suite
log "Running Rust core test suite (cirth-core)..."
cargo test -p cirth-core

log "Building TypeScript frontend..."
cd app
npm ci
npm run build
npm run test:contract
npm run test:offline
node scripts/third-party-notices.mjs --check
cd ..

log "Compiling Kolbítar desktop release binary..."
cargo build -p cirthscribe --release

log "Kolbítar Linux build and smoke test verified successfully!"
log "Release binary available at: target/release/cirthscribe"

if [ "$SMOKE_E2E" -eq 1 ]; then
  log "Running headless WebDriver E2E smoke test under Xvfb..."
  mkdir -p out
  cd app
  xvfb-run -a node tests/e2e/run.mjs --driver webdriver --exe ../target/release/cirthscribe --out ../out/e2e-linux-smoke.json --screens ../out/screens-linux-smoke
  cd ..
  log "E2E smoke test complete. Results in out/e2e-linux-smoke.json."
fi
