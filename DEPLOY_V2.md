# Deploy da v2.1 — runbook

Estado em 2026-11-16 (antes deste deploy): produção em `scad/`, porta **4177**, versão **2.0.0**, `schemaVersion: 2`, rev **1223** — 1 coleção, 3 processos, 82 documentos, 287 verificações, 9 critérios, 82 arquivos em `data/files` (~10 MB). Servidor rodando como **SYSTEM** (sessão 0), subido pelo Agendador de Tarefas no boot da máquina.

O que muda: código (cascata de exclusão, sem “Apagar tudo”, botão de adicionar em todo estágio, remendos cirúrgicos, confirmação pelo nome) e a versão do servidor para **2.1.0**. **Nenhuma migração de dados** — o banco já está em schema 2 e `normalizeState` só acrescenta campos; o `db.json` não é reescrito no boot.

## 1. Backup (verificado)

```powershell
$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
New-Item -ItemType Directory -Force -Path "backups\$stamp" | Out-Null
Copy-Item "data\db.json" "backups\$stamp\db.json"
Copy-Item -Recurse -Force "data\files" "backups\$stamp\files"
Get-FileHash "data\db.json" -Algorithm SHA256   # comparar com backups\$stamp\db.json
```

Conferir: mesmo `sha256` do `db.json`, 82 arquivos nos dois lados. O backup de 2026-11-16 (pré-deploy) está em `backups\2026-11-16_11-41-18\` com `sha256.txt` de todos os arquivos.

## 2. Código

O merge já foi feito em `master` (`e810afe`), com tag `v2.1.0`; o estado anterior é a tag `v2.0.0`.

```bash
git log --oneline -3          # conferir o merge
git status --short            # deve estar limpo
```

## 3. Reiniciar o servidor

O processo de produção roda como SYSTEM: só encerra com administrador.

1. Gerenciador de Tarefas → **Detalhes** → `node.exe` (porta 4177) → *Finalizar tarefa* (aceitar a elevação), **ou** reiniciar a máquina (a tarefa de boot sobe o código novo).
2. Subir de novo: `iniciar-scad.bat` (ou `scripts\servico-scad.cmd`), na pasta `scad\`.
3. Sem esse passo o servidor antigo continua em memória e só o cliente novo é servido — a criação de itens falharia até o reinício.

## 4. Verificar

```powershell
Invoke-RestMethod http://127.0.0.1:4177/api/health
```

Esperado: `version: 2.1.0`, `schemaVersion: 2`, `port: 4177`.

No navegador (`http://127.0.0.1:4177`) e no iPad:

| conferir | esperado |
|---|---|
| coleções / processos | 1 / 3 |
| documentos / critérios | 82 / 9 |
| verificações | 287 (117 ok, 59 nc, 70 obs, 41 pendentes) |
| revisões decididas | 6 (5 aprovadas, 1 sinalizada) |
| Ajustes → “Sobre este programa” | v2.1.0 |
| Ajustes | só “Excluir este processo”; “Apagar tudo” não existe |
| sessão de análise | “Importar mais” ao lado da barra de progresso |

Prova de que os dados não foram reescritos: `Get-FileHash data\db.json` deve continuar igual ao backup **até a primeira alteração** feita no app.

## 5. Rollback

```powershell
# código
git checkout v2.0.0        # ou: git reset --hard v2.0.0  (com aprovação)
# dados (só se algo foi perdido; a versão nova tolera os campos antigos e vice-versa)
Copy-Item "backups\2026-11-16_11-41-18\db.json" "data\db.json" -Force
Copy-Item -Recurse -Force "backups\2026-11-16_11-41-18\files\*" "data\files\"
```

Depois reiniciar o servidor. O código antigo preserva campos desconhecidos (`{...registro}`), então voltar a versão **não** estraga um banco já tocado pela v2.1. A única perda não reversível por código é um processo excluído na v2.1 — aí só o backup resolve.

## Observações

- `/api/reset` continua existindo no servidor, sem nenhum botão na interface. Não usar em produção.
- Histórico: a migração v1 → v2 (rev 255 → 256) foi em 2025, com `data/backups/db-v1-*.json` preservado; este runbook substitui o anterior, que descrevia aquela janela.
