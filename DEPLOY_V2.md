# Deploy da v2 (Fase A) — runbook

Pré-requisito: **confirmação explícita do usuário** para a janela. Produção atual: http://127.0.0.1:4177 (v1, schema 1).

## Antes de parar

1. Snapshot de dados e arquivos:
   ```powershell
   $stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
   New-Item -ItemType Directory -Force -Path "backups\$stamp" | Out-Null
   Copy-Item "data\db.json" "backups\$stamp\db.json"
   Copy-Item -Recurse -Force "data\files" "backups\$stamp\files"
   ```
2. Confirmar que `scad/` está limpo (`git status`) e que `fase-a` contém os commits da v2.
3. Avisar que o app ficará indisponível por ~30–60 s.

## Deploy

1. Parar o servidor de produção (job do DSH / `Ctrl+C`).
2. No diretório de produção `scad/`:
   ```bash
   git merge --ff-only fase-a
   ```
3. Iniciar:
   ```bash
   node server.mjs
   ```
   A migração v1→v2 roda no boot e grava `data/backups/db-v1-<timestamp>.json`.
4. Validar:
   ```bash
   curl http://127.0.0.1:4177/api/health
   curl "http://127.0.0.1:4177/api/state?processId=<pid>"
   ```
   Esperado: schema 2, 41 docs, 246 checks, 6 critérios, coleção `ISO 9001:2015`, processo `DC`.
5. Abrir o app, escolher perfil, conferir um documento e um check. No iPad, recarregar.

## Rollback

1. Parar o servidor v2.
2. Restaurar código:
   ```bash
   git reset --hard v1.0
   ```
3. Restaurar **dados v1** (o backup pré-deploy):
   ```powershell
   Copy-Item "backups\<stamp>\db.json" "data\db.json" -Force
   Copy-Item -Recurse -Force "backups\<stamp>\files\*" "data\files\"
   ```
4. Iniciar `node server.mjs` (v1) e validar 41/246/6.
5. Preservar `data/backups/db-v1-*.json` (cópia adicional da migração).

## Observações

- O código v1.0 está na tag `v1.0`; o bundle está em `backups/scad-v1.0.bundle`.
- A prévia v2 para validação fica em `http://192.168.56.211:4191`, com cópia isolada; não é produção.
- Após validar a v2, criar tag `v2.0` e atualizar `PROJECT_MEMORY.md`.
