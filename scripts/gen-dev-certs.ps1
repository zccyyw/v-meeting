# Optional local certs for non-Caddy workflows.
# Compose uses Caddy `tls internal` by default — mkcert is not required.

New-Item -ItemType Directory -Force -Path certs | Out-Null

if (Get-Command mkcert -ErrorAction SilentlyContinue) {
  mkcert -key-file certs/local-key.pem -cert-file certs/local-cert.pem localhost 127.0.0.1
  Write-Host "Wrote certs/local-cert.pem and certs/local-key.pem"
} else {
  Write-Host "mkcert not found. Use Docker Compose with Caddy tls internal instead."
}
