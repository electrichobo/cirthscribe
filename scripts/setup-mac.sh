#!/usr/bin/env bash
# ==============================================================================
# Kolbítar macOS Environment Provisioning & Smoke-Test Script
# Prepares macOS (macOS 11 Big Sur or later) for building and testing Kolbítar.
# ==============================================================================

set -euo pipefail

BOLD="$(tput bold 2>/dev/null || true)"
GREEN="$(tput setaf 2 2>/dev/null || true)"
YELLOW="$(tput setaf 3 2>/dev/null || true)"
RED="$(tput setaf 1 2>/dev/null || true)"
RESET="$(tput sgr0 2>/dev/null || true)"

log() { echo -e "${BOLD}${GREEN}[kolbitar-mac-setup]${RESET} $*"; }
warn() { echo -e "${BOLD}${YELLOW}[kolbitar-mac-setup:warning]${RESET} $*"; }
err() { echo -e "${BOLD}${RED}[kolbitar-mac-setup:error]${RESET} $*" >&2; }

# Enforcement of minimum macOS deployment target (ADR 0001, M1 acceptance)
export MACOSX_DEPLOYMENT_TARGET="11.0"

log "Starting Kolbítar macOS environment provisioning (target: macOS 11.0+)..."

# 1. Check Xcode Command Line Tools
if ! xcode-select -p >/dev/null 2>&1; then
  log "Installing Xcode Command Line Tools..."
  xcode-select --install
  warn "Please complete the Xcode Command Line Tools installation dialog and re-run this script."
  exit 0
else
  log "Xcode Command Line Tools detected at: $(xcode-select -p)"
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
  if command -v brew >/dev/null 2>&1; then
    log "Node.js not detected. Installing via Homebrew..."
    brew install node
  else
    err "Node.js is not installed. Please install Node.js 20 or higher from https://nodejs.org or via Homebrew."
    exit 1
  fi
else
  log "Node.js detected: $(node --version)"
fi

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

log "Compiling Kolbítar desktop release binary for macOS (MACOSX_DEPLOYMENT_TARGET=11.0)..."
cargo build -p cirthscribe --release

# 6. Verify Binary Target Version
if command -v vtool >/dev/null 2>&1; then
  log "Inspecting binary with vtool..."
  vtool -show-build target/release/cirthscribe
elif command -v otool >/dev/null 2>&1; then
  log "Inspecting binary with otool..."
  otool -l target/release/cirthscribe | grep -A 4 LC_BUILD_VERSION || true
fi

log "Kolbítar macOS build and smoke test verified successfully!"
log "Release binary available at: target/release/cirthscribe"
log "To build a standalone .dmg installer bundle, run: npm --prefix app run tauri -- bundle -b dmg"
