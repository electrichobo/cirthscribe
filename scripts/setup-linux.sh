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

log "Starting Kolbítar Linux environment provisioning..."

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
    sudo apt-get update
    sudo apt-get install -y \
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
      xclip
  elif command -v dnf >/dev/null 2>&1; then
    log "Using dnf to install system dependencies..."
    sudo dnf install -y \
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
      xorg-x11-server-Xvfb
  elif command -v pacman >/dev/null 2>&1; then
    log "Using pacman to install system dependencies..."
    sudo pacman -S --needed --noconfirm \
      base-devel \
      curl \
      git \
      webkit2gtk-4.1 \
      openssl \
      libappindicator-gtk3 \
      librsvg \
      xdotool \
      xclip \
      xorg-server-xvfb
  else
    warn "Unsupported package manager. Please ensure WebKitGTK 4.1, OpenSSL, and build essentials are installed manually."
  fi
}

if [ "${1:-}" != "--skip-deps" ]; then
  install_system_dependencies
fi

# 2. Check Rust Toolchain
if ! command -v cargo >/dev/null 2>&1; then
  log "Rust toolchain not detected. Installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "${HOME}/.cargo/env"
else
  log "Rust toolchain detected: $(cargo --version)"
fi

# 3. Check Node.js and npm
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed. Please install Node.js 20 or higher."
  exit 1
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

if [ "${1:-}" == "--smoke-e2e" ] || [ "${2:-}" == "--smoke-e2e" ]; then
  log "Running headless WebDriver E2E smoke test under Xvfb..."
  mkdir -p out
  cd app
  xvfb-run -a node tests/e2e/run.mjs --driver webdriver --exe ../target/release/cirthscribe --out ../out/e2e-linux-smoke.json --screens ../out/screens-linux-smoke
  cd ..
  log "E2E smoke test complete. Results in out/e2e-linux-smoke.json."
fi
