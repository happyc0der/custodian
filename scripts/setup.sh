#!/usr/bin/env bash
# Phase 0 developer setup for Custodian (macOS). Idempotent; re-run freely.
set -euo pipefail

echo "▸ Node 24 via nvm"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 24 >/dev/null
nvm use 24 >/dev/null
node -v

echo "▸ Homebrew tools: awscli, cloudflared"
if command -v brew >/dev/null; then
  brew list awscli >/dev/null 2>&1 || brew install awscli
  brew list cloudflared >/dev/null 2>&1 || brew install cloudflared
else
  echo "  Homebrew not found — install awscli and cloudflared manually."
fi

echo "▸ Project dependencies"
npm install
npm run build:ui

cat <<'MSG'

▸ Alexa+ tooling (needs an AWS profile named "alexa-ai" and an Amazon developer account):
    aws configure --profile alexa-ai
    aws codeartifact login --tool npm --domain alexa-ai --repository npm-packages \
        --domain-owner 372468808636 --region us-west-2 --namespace @alexa-ai --profile alexa-ai
    npm install -g @alexa-ai/cli @alexa-ai/addon-local-inspector
    alexa-ai configure
  (the CodeArtifact token lasts 12 hours — re-run the login line when installs 401)

▸ Run locally:
    cp .env.example .env
    npm run dev                       # http://localhost:3001/mcp
    npm run seed                      # demo inventory + live recall sweep
    npx cloudflared tunnel --url http://localhost:3001   # public HTTPS for Alexa+/Claude
MSG
