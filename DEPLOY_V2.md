# Deploy do SCAD — runbook

Produção em `scad/`, porta **4177**, servidor rodando como **SYSTEM** (sessão 0), subido pelo Agendador de Tarefas no boot da máquina. O estado e o backup de cada deploy ficam registrados em `PROJECT_MEMORY.md` (seções 15, 17, 21 e 26 — a última é a v2.3.1, de 18/11/2026); este arquivo é só o passo a passo.

Regra que vem funcionando: **nada de migração de dados** nos deploys recentes — o banco está em schema 2, `normalizeState` só acrescenta campos e o `db.json` não é reescrito no boot. Por isso o teste decisivo é o `sha256` do `db.json` continuar igual ao do backup depois de usar o sistema.

## 1. Backup (verificado)

```powershell
$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
New-Item -ItemType Directory -Force -Path "backups\$stamp" | Out-Null
Copy-Item "data\db.json" "backups\$stamp\db.json"
Copy-Item -Recurse -Force "data\files" "backups\$stamp\files"
Get-FileHash "data\db.json" -Algorithm SHA256   # comparar com backups\$stamp\db.json
```

Conferir: mesmo `sha256` do `db.json` e a **mesma contagem de arquivos** nos dois lados, que deve ser idêntica à de `data\files` (usar o `sha256.txt` do backup para comparar um a um). Guardar também `server.mjs.antes` e `public.antes\` para o rollback.

## 2. Código

O merge é `--ff-only` de `fase-a` em `master`, seguido de tag da versão. Conferir antes que o diff **não** traz nada de `data/`:

```bash
git diff --name-only master..fase-a | Select-String "^data/"
```

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

Esperado: `version:` a do release recém-publicado, `schemaVersion: 2`, `port: 4177`.

No navegador (`http://127.0.0.1:4177`) e no iPad:

| conferir | esperado |
|---|---|
| coleções / processos / documentos | **os mesmos da linha de base anotada antes do deploy** |
| verificações (por situação) | idem — nenhuma some, nenhuma muda de estado |
| arquivos em `data/files` | mesma contagem e mesmo tamanho total |
| Ajustes → “Sobre este programa” | a versão nova |
| console do navegador | nenhum erro de JavaScript |

Prova de que os dados não foram reescritos: `Get-FileHash data\db.json` deve continuar igual ao backup **até a primeira alteração** feita no app.

## 5. Rollback

```powershell
# código
git checkout <tag da versão anterior>
# dados (só se algo foi perdido; a versão nova tolera os campos antigos e vice-versa)
Copy-Item "backups\2026-11-16_11-41-18\db.json" "data\db.json" -Force
Copy-Item -Recurse -Force "backups\2026-11-16_11-41-18\files\*" "data\files\"
```

Depois reiniciar o servidor. O código antigo preserva campos desconhecidos (`{...registro}`), então voltar a versão **não** estraga um banco já tocado pela v2.1. A única perda não reversível por código é um processo excluído na v2.1 — aí só o backup resolve.

## Observações

- `/api/reset` continua existindo no servidor, sem nenhum botão na interface. Não usar em produção.
- `data\derived\` é **cache** da prévia (figura do Visio convertida em PNG). Pode ser apagada a qualquer momento: o servidor recria sob demanda e o arquivo original nunca é tocado.
- Histórico: a migração v1 → v2 (rev 255 → 256) foi em 2025, com `data/backups/db-v1-*.json` preservado; este runbook substitui o anterior, que descrevia aquela janela.
