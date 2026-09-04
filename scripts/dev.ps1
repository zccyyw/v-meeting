# Start api + realtime + web locally (no Docker).
# Prerequisites: MySQL 8 + Redis running on 127.0.0.1, npm install, migrate done.
# Usage:  pwsh ./scripts/dev.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path "node_modules")) {
  Write-Host "Running npm install..."
  npm install
}

Write-Host "Starting api :8080, realtime :8082, front :8081 (Ctrl+C stops all)..."
npx --yes concurrently -k -n api,realtime,front -c blue,magenta,green `
  "npm run dev -w @meeting/api" `
  "npm run dev -w @meeting/realtime" `
  "npm run dev -w @meeting/front"
