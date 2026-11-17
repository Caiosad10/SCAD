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

O processo de produção roda como **SYSTEM** (tarefa agendada "SCAD Servidor"), então só para com administrador. O caminho curto é o atalho **"SCAD - servidor (administrador)"** na área de trabalho (ou `scad-servidor.cmd` na pasta do projeto): ele pede a elevação e abre um menu.

1. Menu → **[2] Parar o servidor**. A porta 4177 fica livre e a tarefa não reinicia sozinha enquanto estiver parada.
2. Troque o código (passo 2).
3. Menu → **[3] Iniciar o servidor**. O menu já mostra a versão, o PID e o dono do processo.
4. Sem parar/subir, o processo antigo continua em memória e só o cliente novo é servido.

Pelo PowerShell, como administrador:

```powershell
.\scripts\servidor.ps1             # situacao: tarefa, porta, PID, dono, versao
.\scripts\servidor.ps1 -Acao parar
.\scripts\servidor.ps1 -Acao iniciar
.\scripts\servidor.ps1 -Acao reiniciar
```

Na primeira vez em cada máquina, `-Acao instalar` faz tudo: para o que estiver na porta, cria/atualiza a tarefa **"SCAD Servidor"** (SYSTEM, ao iniciar a máquina, reinício automático), ajusta a energia para não suspender e sobe. `-Acao remover` desfaz.

> Histórico (17/11/2026): entre 11 e 16/11 o processo rodava de forma avulsa, iniciado à mão, e por isso **não voltava depois de desligar a máquina** — nunca houve tarefa de boot nesse período (a de 16/11 na memória era dedução errada). A tarefa "SCAD Servidor" passa a ser o estado normal.


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
