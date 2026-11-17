# SCAD — Project Memory

**Última atualização:** 2026-11-10
**Estado:** v2.0 implementada e testada em branch `fase-a` (cópia de produção); **produção ainda na v1.0** até a janela de deploy.
**Repositório/app:** `C:\Users\Citra LTDA\OneDrive\Desktop\DSH\scad` (produção) · branch em `scad-v2` (worktree)

Este documento é a fonte de verdade das decisões de produto, regras de negócio e próximos passos. Atualizar sempre que uma decisão for tomada.

---

## 1. Pessoas e papéis

| Pessoa | Papel | Observações |
|---|---|---|
| **Sergio** | Analista / operador | Autor das verificações; também pode criar documentos e critérios. |
| **Diogenes** | Revisor / autoridade | Revisa as verificações do Sergio, aprova, sinaliza e aprova dispensas. Verificações feitas por ele já nascem aprovadas. |

- Ambos alternam entre notebook e iPad; a identidade é **por nome de usuário**, sem senha (decisão consciente).
- O perfil escolhido deve ser o mesmo nos dois dispositivos da pessoa.
- Toda atividade nova deve registrar **quem fez**; atividades antigas permanecem no histórico sem autor (legado).
- A implementação de perfis, revisão e atribuição de atividade está na **Fase B**, já implementada na branch `fase-a` (deploy pendente): revisão por documento, sinalização por critério, presença por documento e autoria em toda atividade nova.

---

## 2. Operação atual

- **URL local:** `http://127.0.0.1:4177`
- **iPad:** `http://192.168.56.211:4177` (IP pode mudar; conferir em Ajustes → Acesso no iPad)
- **Iniciar:** `iniciar-scad.bat` ou `node server.mjs` (sem dependências).
- **Dados:** `data/db.json` + `data/files/` (arquivos até ~32 MB).
- **Backups manuais:** `backups/AAAA-MM-DD_HH-mm-ss/` (db + files).
- **Snapshot de referência desta memória:** processo `ISO 9001:2015 - DC`, **41 documentos, 6 critérios, 246 verificações** (41 × 6), rev 229 no fechamento deste registro. A produção evolui com o uso; conferir o estado atual em Ajustes ou `GET /api/state`.
- Critérios atuais: Descrição Geral · Reporte · Responsabilidades · Qualificação · Experiência · Treinamento.
- **Nada de dados é apagado em mudanças de interface.** Alterações de schema exigem backup + cópia de teste + migração versionada.

---

## 3. Conceitos e terminologia

```text
Coleção (ISO 9001:2015)
└── Processo (DC, POP, Organograma, Fluxogramas…)
    ├── Critérios próprios do processo
    ├── Documentos do processo
    └── Verificações (documento × critério)
```

- **Coleção** agrupa processos de um mesmo certificado/trabalho.
- **Processo** é uma parte da documentação (DC, POP…) com critérios, documentos e estatísticas próprios.
- **Critério** pertence ao processo. Se um critério não se aplica, **ele não deve existir na lista** — não haverá estado “Não se aplica”.
- **Verificação (check)** é a combinação documento × critério.
- **Situação do documento:** Ativo (padrão) ou Inativo (dispensado), com motivo obrigatório.
- **Revisão** é a análise do revisor sobre as verificações do analista.

---

## 4. Regras confirmadas

### 4.1 Verificações

- Estados possíveis: **Pendente · Conforme · Não conforme · Observação**.
- **“Não se aplica” foi removido do produto.** Critérios são por processo; se não valem, exclua o critério.
- Conforme/Não conforme/Observação encerram a pendência.
- Não conforme e Observação geram apontamento com nota.
- O documento só fica “pronto” quando **todos os checks têm resultado**.

### 4.2 Documento Ativo/Inativo (dispensa) — decidido, ainda não implementado

- Interruptor **Ativo/Inativo** no documento. Inativo exige **motivo** (observação).
- Exemplos de motivo: cargo inexistente, documento descartado, descontinuado.
- Inativo ⇒ **selo “Dispensado”**, sai da fila de análise, conta como **verificado** no progresso.
- Checks ficam **suspensos**, sem apagar resultados/histórico; se reativar, voltam ao estado anterior.
- **Revisor aprova a dispensa.** Ele pode contestar e pedir reativação; o documento volta à análise.
- Ao implementar, definir como os checks suspensos entram (ou não) nas métricas; proposta: excluir do total de checks e contar o documento como verificado.
- Implementar junto com a Fase B, para a dispensa já nascer com aprovação do revisor.

### 4.3 Revisão (Fase B) — implementada na branch `fase-a` (deploy pendente)

- Sergio produz; **Diogenes revisa**. Diogenes só **aprova ou sinaliza**; não altera as verificações do Sergio.
- Verificação feita pelo próprio **revisor** é **auto-aprovada** (inclusive nota e resultado).
- **Aprovação de documento em bloco** + possibilidade de **sinalizar critérios individualmente**.
- Ao sinalizar um critério, os demais checks com resultado são **aprovados automaticamente** (confirmado).
- **Mensagem na aprovação:** opcional. **Mensagem na sinalização:** obrigatória, por critério.
- Documento sem todos os checks preenchidos continua **pendente**, sem revisão.
- Se o Sergio altera um check já aprovado, aquele check volta para **aguardando revisão**.
- Se o Diogenes sinaliza, o documento fica **Atenção**; Sergio corrige e o documento volta para a fila de revisão.
- Documento com sinalização aberta **não pode ser aprovado** (o servidor recusa e o botão não aparece).
- **Sem revisor ativo, o documento do Sergio fica aguardando** (não há autoaprovação do analista).
- Documento aprovado: todos os checks aprovados ou feitos pelo revisor.
- **Migração dos dados atuais:** documentos com todos os checks concluídos passam a **Aguardando revisão** (checks existentes ficam com revisão pendente, sem reescrever dados).
- **Histórico:** cada check guarda `review.history` (status, autor, mensagem, data, última versão); aparece no CSV/backup.
- **Concorrência:** sinalização vinculada à versão do check (`updatedAt`); se mudou, o servidor recusa com 409 e pede para recarregar.
- **UX implementada:** sem nova aba. Selos `Aguardando revisão`, `Atenção` e `Aprovado` no documento, na matriz e na lista; na bancada o revisor tem **Aprovar documento** (diálogo com mensagem opcional) e **Sinalizar critério** em cada verificação avaliada (mensagem obrigatória). O analista vê a mensagem no próprio critério e a devolução para revisão acontece ao editar. Painel do revisor com faixa de revisão e fila “Revisão”; lista de documentos com filtros “Revisão” e “Aprovados”.
- **Faixa de revisão por papel:** “Revisão” é grifado com marca-texto de cor sólida cobrindo a palavra inteira (largura e altura); cada contador é um botão com ícone, número e seta. Revisor vê 👓 **Aguardando revisão**; analista vê ⚠ **Atenção** (corrigir); ambos veem ✓ **Aprovados** (filtra só aprovados). Os atalhos abrem a lista já filtrada, com aviso “Mostrando: …” e “ver todos”.
- **Coluna “Situação” da matriz:** **só o ícone** quando o documento está aprovado (✓), aguardando revisão (👓) ou em atenção (⚠). Nas demais linhas aparece a contagem `verificadas/total` (ou “—” para inativo), que continua servindo para saber se tudo foi preenchido. Legenda separada só com os estados de situação.
- **Presença:** mostrada apenas no **painel, na matriz de verificação**, abaixo do nome do documento (linha que cresce ~5 px e volta ao normal quando a pessoa sai). Fora da aba “Analisar”. Batimento de 12 s, validade de 45 s, sem gravar no banco; serve para evitar edição simultânea no mesmo documento.

### 4.4 Atividade

- O histórico atual **não será apagado**.
- A partir da Fase B, cada entrada registra **autor** (Sergio/Diogenes) e a interface mostra o responsável.
- Eventos: importação, exclusão/renomeação, critérios, verificações, notas, aprovações, sinalizações, dispensa/reativação, revisão.

---

## 5. Decisões de interface

- Identidade visual: papel/tinta, serifa editorial, azul institucional, cápsula escura.
- Barra flutuante em cápsula, pílula deslizante, rótulo só no ativo, 44–48 px de alvo.
- Transições de página com fade/slide (~130 ms + 210 ms), shell persistente.
- Reabertura instantânea com cache de sessão + espelho em `localStorage`; rota, filtros, escopo da fila e rolagem restaurados após recarga (iPad).
- Cabeçalho do processo: **← Voltar para processos**, sobrancelha com a tela atual e título `${coleção} - ${processo}`.
- Painel entra em cascata (blocos com 60 ms de atraso, 0,5 s cada) a cada troca de tela — sem reanimar a cada salvamento.
- Presença: linha discreta “Fulano está aqui” **na matriz de verificação do painel**, abaixo do nome do documento, em maiúsculas mono azul com ponto pulsante; a linha volta à altura normal quando a pessoa sai.
- Revisão por papel na faixa do painel: revisor vê “Aguardando revisão”, analista vê “Atenção”, ambos veem “Aprovados”; todos são atalhos clicáveis com ícone, contador e seta.
- Coluna “Situação” da matriz usa ícone para os estados de revisão (👓 ⚠ ✓) e mantém a contagem `verificadas/total`; legenda própria abaixo da matriz.
- **Nas telas de Coleções e de Processos a barra deve desaparecer** (fora do contexto do processo); ao entrar num processo ela **se expande**: a cápsula cresce de ~52% ao tamanho final em 0,7 s (`cubic-bezier(0.34, 0.9, 0.3, 1)`), ícones em cascata de 60 ms e pílula do item ativo medida em espaço de layout (divide a medida atual pela escala da animação).
- Matriz: colunas uniformes, cabeçalho de 2 linhas, ícones 22 px com fundo tingido.
- Cards-métrica: Documentos, Não conformes e Observações são filtros; **Verificações é apenas indicador**.
- Critério “Não se aplica” removido da UI, legenda, atalhos (1–3) e textos.
- Ajustes → Critérios: setas explícitas para cima/baixo (não usar arcos rotacionados).
- `PRT-A575` (código aleatório interno) **sai do cabeçalho**. Formato confirmado: **opção 1 + 2** — id interno oculto (integridade) e código legível no padrão `ISO9001-DC`, exibido apenas em exportação/auditoria, não na interface.

### Percentual da coleção — confirmado

- **Ponderado por verificações** (não média simples entre processos).
- Exemplo: 2 processos com 10 documentos cada (20 no total), 5 verificados em cada ⇒ **10/20 = 50%** na coleção; cada processo 50%.
- Documentos inativos contam como verificados; seus checks suspensos saem do denominador.

---

## 6. Modelo de dados proposto (v2 — ainda não aplicado)

```json
{
  "schemaVersion": 2,
  "profiles": [
    { "id": "usr_sergio", "name": "Sergio", "role": "analyst" },
    { "id": "usr_diogenes", "name": "Diogenes", "role": "reviewer" }
  ],
  "collections": [{ "id": "col_iso9001", "name": "ISO 9001:2015" }],
  "processes": [
    {
      "id": "prc_dc",
      "collectionId": "col_iso9001",
      "name": "DC",
      "code": "ISO9001-DC",
      "description": ""
    }
  ],
  "criteria": [{ "id": "crit_...", "processId": "prc_dc", "label": "...", "order": 0 }],
  "documents": [
    {
      "id": "doc_...",
      "processId": "prc_dc",
      "active": true,
      "inactiveReason": "",
      "name": "..."
    }
  ],
  "checks": [
    {
      "id": "chk_...",
      "docId": "doc_...",
      "criterionId": "crit_...",
      "status": "ok|nc|obs|pending",
      "note": "",
      "authorId": "usr_sergio",
      "review": {
        "state": "pending|approved|flagged",
        "by": "usr_diogenes",
        "at": "ISO",
        "message": "",
        "basedOn": "check.updatedAt"
      }
    }
  ],
  "activity": [{ "id": "act_...", "at": "ISO", "actorId": "usr_sergio", "text": "..." }]
}
```

Migração: adicionar `schemaVersion`, `profiles`, `collections`, `processes`, `processId` em critérios/documentos, `active: true`, autor/revisão nos checks; preservar ids, arquivos, notas e histórico. Backup automático antes; executar em cópia e validar contagens.

---

## 7. Roadmap

### Fase A — Coleções, processos e situação do documento (implementada em branch, deploy pendente)

Implementado no worktree `scad-v2` (branch `fase-a`), sem tocar a produção:

1. Schema v2 com `collections`, `processes`, `profiles`, `processId`, `active`/`inactiveReason`, autor em `checks` e ator em `activity`.
2. Migração automática v1 → v2 com backup em `data/backups/db-v1-*.json`; preserva ids, arquivos, checks, notas, meta e histórico; idempotente.
3. Telas de Coleções e Processos, com “Voltar” e barra flutuante oculta nas listas; ao entrar no processo a barra surge com animação.
4. Título `${COLEÇÃO} - ${PROCESSO}`; código aleatório fora da interface; código legível `ISO9001-DC` no JSON/CSV.
5. Critérios por processo, criação de critério no processo, cópia selecionável de outro processo (no cadastro do processo e em Ajustes).
6. Percentual ponderado por verificações; visão por processo e consolidado por coleção.
7. Documento Ativo/Inativo com motivo obrigatório, selo Inativo, saída da fila, checks suspensos, reativação e métricas separadas. A aprovação formal da dispensa pelo revisor fica para a Fase B.
8. Perfis Sergio (analista) e Diogenes (revisor) semeados; seleção/troca por dispositivo; toda atividade nova registra o autor (antigas ficam como legado).
9. Importação, edição, busca, filtros, matriz, apontamentos, CSV e backup funcionando no escopo do processo.
10. Cache de sessão e retomada de rota preservados.

**Validação feita**
- Cópia fresca da produção migrada: 41 documentos, 246 verificações, 6 critérios, 25 concluídas; conferência de coleção/processo e último documento.
- Navegador real (Edge headless): troca de perfil, abertura de coleção/processo, barra oculta/animada, novo processo com 5 critérios copiados, nova coleção, onboarding de instalação vazia, importação de arquivo, critério e processo pela UI, documento inativado/reativado, matriz com célula “—” e selo Inativo, atividade com autor.
- Reinício sobre estado já v2 não remigra (idempotente). Backup pré-migração presente.
- CSV validado: 246 linhas, colunas Coleção/Processo/Código/Documento/Situação do documento/Critério/Resultado/Nota/Data; nome `scad-ISO9001-DC-...csv`.
- Processo com **todos os documentos inativos** calcula 100% e conta o documento como verificado; coleção continua ponderada por verificações ativas.
- Rollback testado com o backup v1: servidor v1 abre a cópia restaurada com 41 docs/246 checks/6 critérios.
- Retomada de rota após reload e cache de sessão funcionando no escopo do processo.
- Nenhuma alteração foi feita em `data/` nem no processo 4177.

**Deploy (pendente de confirmação explícita)**
- **Prévia v2 isolada para validação:** `http://192.168.56.211:4191` (ou `http://localhost:4191`). Usa uma **cópia migrada** da produção; alterações ali não afetam a produção.
- Produção v1 continua em `http://192.168.56.211:4177` até a janela.
1. Nova cópia de segurança de `data/db.json` + `data/files` + código v1 (tag `v1.0`).
2. Parar o servidor 4177, fazer merge de `fase-a` em `master`, iniciar v2; a migração roda sozinha com backup em `data/backups`.
3. Validar `/api/state` (41/246/6), abrir o app, conferir login/perfil e um check; se falhar, restaurar tag `v1.0` + backup e reiniciar.
4. Janela estimada: menos de 1 minuto.

### Fase B — Revisão

1. Perfil revisor, autoria dos checks, estados de revisão.
2. Aprovação em bloco e sinalização por critério com mensagem.
3. Fila “Aguardando revisão”/“Atenção” na matriz/lista/painel.
4. Documento aprovado somente com todos aprovados ou feitos pelo revisor.
5. Aprovação da dispensa do documento.
6. Histórico e exportação com revisor/mensagens.

### Fase C — Relatórios e refinamentos

- Relatório PDF por processo/coleção, apontamentos com evidências, filtros na matriz, importação em lote mais robusta, PDF lado a lado.

---

## 8. Decisões em aberto

1. Fila de revisão: card no painel + filtros na lista (recomendado) ou outra navegação?
2. Nomes exatos dos perfis e como cadastrar/trocar (por dispositivo) — Sergio e Diogenes já definidos.
3. A dispensa inativa: aprovação do revisor antes ou depois de sair da fila? Proposta: sai da fila como “dispensado provisório” e o revisor aprova/contesta.
4. Documentos inativos: manter checks suspensos visíveis no detalhe (somente leitura) — confirmar.
5. Atividade antiga sem autor: exibir como “legado” ou ocultar autor? Manter, sem inventar autoria.
6. Barra nas telas de coleções/processos: ocultar e animar ao entrar no processo — **confirmado**; expansão ajustada na prática (0,7 s, revisada no iPad).
7. **Módulo A.P.R:** aguardando o Sergio estudar o fluxo real e a norma aplicável — ver seção 13.1 (está no backlog, sem desenvolvimento).

**Resolvidos:** percentual ponderado por verificações; código 1+2; barra oculta nas listas e expandindo ao entrar no processo; nome da coleção repetido no cabeçalho; recarga do iPad no meio da navegação.

---

## 9. Versionamento

- Repositório remoto: `https://github.com/Caiosad10/SCAD.git` — **publicado**: branch `master` (v1 `881e4fb` → v2 mesclada), branch `fase-a` (`a780765`) e tags `v1.0`, `v2.0-rc1` … `v2.0-rc6`, `v2.0`.
- **v2.0 EM PRODUÇÃO** desde **2026-11-10 20:36** (merge `--ff-only` de `fase-a` em `master`, commit `a780765`, tag `v2.0`).
  - Migração automática v1 → v2 executada no start: `schemaVersion` 1 → 2, rev 255 → **256**.
  - Backup **anterior** ao deploy: `backups/2026-11-10_20-36-07/` (db.json rev 255 + 41 arquivos).
  - Backup **pré-migração** automático do servidor: `data/backups/db-v1-2026-11-11T00-36-43-397Z.json`.
  - Conferência de integridade: 41 documentos, 246 verificações e 6 critérios **idênticos** ao backup (id, situação e notas conferidos um a um); atividade 85 → 86 (só a entrada “Migração para schema v2”).
- Estado **v1.0** (produção antes da Fase A): commit `294b890`, tag `v1.0`.
- Bundles locais de segurança: `backups/scad-v1.0.bundle` e `scad-v2.0-rc6.bundle`.
- `data/`, `backups/` e cópias de QA ficam fora do Git.
- **Rollback** (se necessário): parar o servidor, `git checkout v1.0` em `scad`, restaurar `data/db.json` + `data/files` de `backups/2026-11-10_20-36-07/`, subir de novo.

## 10. Protocolo de alteração em produção

1. **Nunca** testar reset/importação/demo no banco de produção.
2. Backup de `data/db.json` + `data/files` + código (`server.mjs`, `public/`) antes de mudanças de schema.
3. Trabalhar em cópia (`SCAD_DATA=.qa-data`, porta 4188) e validar com dados reais copiados.
4. Migração idempotente, versionada, com validação de contagens e backup pré-migração.
5. Mudanças somente de interface são publicadas em `public/` sem reiniciar; mudanças de servidor/schema exigem janela curta e reinício.
6. Em caso de falha: restaurar backup e versão anterior do servidor.
7. Registrar toda decisão neste arquivo e no quadro Kanban.
8. **A partir da v2 em produção**: correções e adições seguem o mesmo rito — branch `fase-a`, validação em cópia isolada (porta separada, `SCAD_DATA` próprio), teste de leitura na produção antes de encerrar.

---

## 11. Diário de mudanças

| Data | Mudança |
|---|---|
| 2026-11-09 | Primeira versão do SCAD: processo único, documentos, critérios, checks, apontamentos, CSV/JSON. |
| 2026-11-10 | Transições suaves, pílula deslizante, cache de boot, matriz reformulada, cards-filtro, card Verificações só indicador. |
| 2026-11-10 | Fluxo de verificação: nota com foco, “Próximo critério”, fim do re-render que fechava o teclado, restauração de rota após recarga. |
| 2026-11-10 | “Não se aplica” removido; setas de critério corrigidas; decisões de coleções, revisão e dispensa registradas. |
| 2026-11-10 | Git iniciado; v1.0 commitada e tagueada (`294b890`); bundle em `backups/`; percentual ponderado e código 1+2 confirmados. |
| 2026-11-10 | Fase A v2 implementada em `fase-a`: schema coleções/processos, migração com backup, perfis/autoria, documento Ativo/Inativo, telas de coleções, critérios copiáveis e barra oculta/animada. Deploy pendente de confirmação. |
| 2026-11-10 | Correções do uso no iPad: navegação interna por `pushState` (sem recarga), sessão persistida (tela/filtros/fila/rolagem), tela de carregamento só após 220 ms com cache espelhado em `localStorage`, barra expandindo em 0,7 s e cabeçalho sem nome repetido. Validado no Edge headless em viewport de iPad (41 documentos, 240 verificações). |
| 2026-11-10 | Fase B no `fase-a` (v2.0-rc3): revisão por documento com aprovação em bloco e sinalização por critério (mensagem obrigatória), autoaprovação do revisor, devolução automática do check alterado pelo analista, bloqueio de aprovação com sinalização aberta, histórico da revisão, filtros “Revisão”/“Aguardando”/“Atenção”, faixa de revisão no painel, títulos `${coleção} - ${processo}`, cascata do painel e presença “Fulano está aqui”. 24 testes de API e 19 de interface passando. |
| 2026-11-10 | Ajustes de leitura (v2.0-rc4): faixa “Revisão” grifada com atalhos clicáveis (ícone + contador + seta), separação por papel (revisor = Aguardando revisão; analista = Atenção) e “Aprovados” clicável com filtro próprio; coluna “Situação” da matriz com ícones (👓 ⚠ ✓) mantendo `verificadas/total`; presença movida para a matriz do painel, abaixo do nome do documento, com a linha voltando ao tamanho normal ao sair. 34 verificações de interface e 13 de layout/presença passando. |
| 2026-11-10 | Refino (v2.0-rc5): marca-texto de “Revisão” passou a cobrir a palavra inteira (cor sólida, largura e altura); na coluna “Situação” os estados aprovado/aguardando revisão/atenção mostram **apenas o ícone**, e a contagem `verificadas/total` fica só nas linhas em análise (ou “—” para inativo). Coluna reduzida para 64 px. Testes rodados em instância isolada (4192) para não mexer na prévia em uso. |
| 2026-11-11 | **v2.0 EM PRODUÇÃO** (commit `a780765`, tag `v2.0`). Backup `backups/2026-11-10_20-36-07/` + pré-migração automático; merge `--ff-only` de `fase-a` em `master`; migração rev 255 → 256; conferência: 41 documentos, 246 verificações e 6 critérios idênticos ao backup; 4 documentos em “Aguardando revisão”; smoke test no navegador sem erros. Cabeçalho “Situação” corrigido para não quebrar linha (coluna 72 px, `nowrap`). |

---

## 12. Limitações conhecidas

- Um processo ativo por instalação (Fase A corrige).
- Sem autenticação; confiança na rede local. Não expor na internet.
- Presença vale enquanto o app está aberto (batimento de 12 s; expira em 45 s) e é só um aviso — não bloqueia edição simultânea no mesmo critério.
- Aprovação de dispensa de documento inativo (Fase B, item 5) ainda não tem tela; a dispensa continua registrando motivo e o revisor a vê pela situação do documento.
- PDF no iPad pode exigir “Abrir em nova aba”.
- Sem OCR, anexo de evidência por apontamento ou comparação de versões.
- Arquivos até ~32 MB por upload.

---

## 13. Ideias registradas no backlog (não implementadas)

Nada desta seção está aprovado para desenvolvimento. Ficam aqui para não se perderem; quando o Sergio decidir, a tarefa sai do **backlog** no quadro Kanban e vira trabalho.

### 13.1 Módulo A.P.R — Análise Preliminar de Risco

**Registrada em:** 2026-11-11 · **Origem:** levantamento do Sergio (SGQ) numa visita de preparação para auditoria.

**Ideia:** reaproveitar a base do SCAD — Coleção → Processo → itens → avaliações → revisão → progresso → exportação — para trabalhar com APR.

**O que já serve (~70% do esqueleto):** coleções e processos, perfis e autoria, histórico de atividade, revisão com aprovar/sinalizar (nome + data), progresso, presença, exportação CSV/JSON e toda a casca visual.

**Onde o modelo atual não encaixa:** o átomo do SCAD é `documento × critério = conforme/não conforme/observação`; o da APR é `perigo × (severidade, probabilidade) = nível de risco`. Faltam:

- etapa da atividade como eixo de agrupamento;
- escala numérica de severidade e probabilidade + matriz configurável (3×3, 4×4, 5×5) com faixas de classificação;
- risco inicial **e** risco residual após os controles;
- plano de ação com responsável e prazo, acompanhado (aberta / em andamento / concluída / atrasada);
- ranking por risco e filtros (“risco alto”, “ação atrasada”, “sem controle”);
- layout de impressão de APR com bloco de assinatura;
- revisão versionada da APR (rev. 00, 01…).

**Três caminhos avaliados:**

| Opção | O que é | Serve para | Custo |
|---|---|---|---|
| **A** | Usar como está: `Coleção = A.P.R`, `Processo = APR da atividade`, `Documento = PDF da APR`, `Critérios = requisitos de uma APR bem feita` | **Auditar** APRs de terceiros / antigas (checklist de conformidade) | zero |
| **B** (recomendada se a CITRA mantiver as APRs) | Processo com `tipo: riscos` + entidade “item de risco” (registro, sem arquivo) + matriz S×P + plano de ação + impressão própria. Reusa revisão, atividade, exportação e **não mexe no fluxo de documentos** | **Produzir e manter** as APRs | módulo novo (schema + 2 telas + exportação) |
| **C** | Módulo isolado em rota própria | Só se forem universos realmente distintos | alto, pouco reuso |

**Perguntas a responder antes de codificar:**

1. Produzir/gerenciar as APRs da CITRA ou auditar as de terceiros?
2. Norma/escopo: NR-1/PGR/ISO 45001 (segurança do trabalho) ou ISO 9001 item 6.1 (risco de processo)? Os campos mudam.
3. Granularidade: atividade, setor, contrato ou cliente?
4. Escalas 3×3, 4×4 ou 5×5? Faixas de classificação já definidas pela empresa/cliente?
5. Plano de ação com responsável e prazo acompanhados no SCAD, ou só colunas na APR?
6. APR revisada (rev. 00, 01…) com histórico e aprovação nominal?
7. Precisa imprimir em layout de APR com assinatura para a auditoria?
8. Volume: quantas APRs e quantas linhas por APR?

**Decisão:** o Sergio estuda o fluxo real e a necessidade, e comunica. Só então a tarefa sai do backlog; o primeiro passo técnico será o estudo de schema/telas/exportação, sem tocar na produção.

### 13.2 Acesso e mudança de IP entre redes

**Registrado em:** 2026-11-11 · Não é funcionalidade, é operação.

- O servidor escuta em `0.0.0.0:4177`, portanto responde em **todas** as interfaces ativas. O endereço muda conforme a rede: empresa `192.168.56.211`, celular/hotspot `10.243.213.50`, WSL `172.19.224.1` (este **não** funciona no iPad).
- Em 11/11 o Diogenes acessou pelo IP antigo porque: o processo ficou no ar desde 10/11 (uptime 14,9 h), o notebook voltou para a rede da empresa e o **DHCP devolveu o mesmo endereço** de antes, e o servidor aceita qualquer interface.
- **Recomendado:** reserva de DHCP por MAC (ou IP fixo fora da faixa) e/ou nome local (`scad.empresa.local`). Evita link quebrado quando o IP muda.
- **Melhoria candidata (backlog):** em Ajustes → Acesso no iPad, mostrar apenas os endereços alcançáveis de outro dispositivo (esconder WSL) e oferecer QR code.

---

## 14. Fluxo por requisitos/listagem (em validação, fora de produção)

**Estado em 2026-11-16:** implementado no worktree `scad-v2` (branch `fase-a`, servidor de teste na porta **4188**), **não publicado**. A produção em `scad` (`master`, porta 4177) segue intocada — nada desta seção existe lá. Só vai para produção depois da validação do Sergio e de um OK explícito.

**Origem:** necessidade de analisar e avaliar fornecedores/prestadores. No fluxo documental o átomo é “um arquivo, vários critérios”; nesse caso o átomo é **um fornecedor/linha, vários documentos** (alvará, CNPJ, certidões) verificados por critério.

### 14.1 Os dois fluxos

O fluxo é escolhido **na criação do processo** e não muda depois.

| Fluxo | Como funciona |
|---|---|
| `documents` (o de sempre) | Importa arquivos → cada arquivo ganha uma verificação por critério → bancada de análise. |
| `requirements` (listagem) | Cria-se uma **lista de itens** (ex.: “1 - RMC”, “2 - PERSIST SOLUÇÕES”) → cada item ganha uma verificação por critério → os **documentos de evidência** são anexados ao item e vinculados às verificações. A qualificação do item é implícita: vale o que o revisor aprovar. |

### 14.2 Modelo de dados acrescentado (schema v2, aditivo)

| Campo | Onde | Regra |
|---|---|---|
| `process.flow` | processo | `documents` (padrão) ou `requirements`. |
| `process.customStatuses[]` | processo | Até **2** resultados extras (`id: cs_<hex>`, `label` de 2–40 caracteres, sem repetir rótulo). Só vale no fluxo `requirements`; ignorado no documental. |
| `document.itemKind` | documento | `item` (linha da listagem, sem arquivo) ou `document` (arquivo; também o é no fluxo documental). |
| `document.itemId` | documento | Item ao qual a evidência pertence. |
| `check.attachments[]` | verificação | Até 12 ids de documentos de evidência **do mesmo item**. |

Numeração das linhas é automática e recalculada na tela (não fica gravada no nome).

### 14.3 API

- `POST /api/items` `{processId, name}` → cria o item **e** uma verificação por critério do processo.
- `POST /api/documents` com `itemId` → cria a evidência ligada ao item (o servidor recusa item de outro processo ou que não seja item).
- `PATCH /api/checks/:id` `{attachments:[…]}` → vincula/desvincula evidências (recusa documento que não seja filho do item).
- `PATCH /api/processes/:id` `{customStatuses:[{id?,label}]}` → cria, renomeia, remove e reordena. Rótulo sem `id` recebe um `cs_` novo; com `id` válido, preserva (as verificações continuam apontando para ele). Remover um status **em uso** devolve **409** com a explicação (“… já está em uso em verificações …”). Lista maior que 2 é truncada.
- `POST /api/processes` aceita `flow` e `customStatuses` (criação num passo só) e responde **201**.
- `DELETE /api/documents/:id` → excluir um **item** apaga em cascata suas evidências, as verificações delas e limpa referências em `attachments`. Excluir um processo com documentos continua bloqueado (409).

### 14.4 Telas

- **Criação do processo:** seletor “Fluxo do processo”; ao escolher listagem aparece o editor de status (até 2), que mostra a linha de digitação só enquanto há espaço e, no limite, troca por um aviso em vez de um campo inútil.
- **Documentos:** a listagem mostra itens e evidências, com o item identificado como “Item de listagem”.
- **Bancada do item:** cabeçalho “Bancada · item N de M · X evidências”; cada linha traz os resultados do critério, as evidências vinculadas e o botão “Adicionar item”.
- **Adicionar itens:** diálogo em forma de compositor de chips — digita e adiciona, numera 01/02/03, ignora repetidos, e tem “Colar lista” para jogar várias linhas de uma vez; o botão do rodapé diz quantos serão criados.
- **Ajustes → Status personalizados:** cartão com a contagem “N de 2”, remoção por chip (com confirmação) e adição pela mesma linguagem dos critérios. Remover algo em uso é recusado com aviso claro.

### 14.5 Correções de 2026-11-16 (feedback do usuário)

1. **Diálogo de itens** refeito: era uma caixa de texto grande, prática mas fora da estética; agora são chips numerados com colar em lote e rótulo dinâmico.
2. **“Não foi possível montar a tela” ao clicar no item**: `fileKind()` estourava com mime nulo (`mime.startsWith`), e o item caía no caminho de arquivo. Ficou tolerante a nulo e o item não mostra mais “Ver arquivo”.
3. **Status na criação**: o atributo `hidden` não funcionava porque `.field`/`.cs-add-row` definem `display:flex` (autor vence a regra do navegador) — o “x” parecia só limpar o campo. Regra global `[hidden]{display:none!important}` e o “x” agora remove o status; no limite de 2 o campo dá lugar ao aviso.
4. **Tela piscando ao anexar evidência**: o vínculo re-renderizava a página inteira. Agora só o bloco de evidência da verificação é trocado (comparando o HTML antes de substituir), a linha não é recriada e o diálogo continua aberto.
5. **Status editáveis depois**: antes só existiam na criação; agora há CRUD em Ajustes, com bloqueio de remoção do que está em uso.

### 14.6 Como foi verificado

- `node --check` nos 14 arquivos alterados.
- Suíte de API: 409 ao remover status em uso, renomear preservando `id`, fluxo documental ignorando `customStatuses`, criação de processo (201), truncamento em 2, remoção e exclusão do processo de teste — sem sobra no banco.
- Suíte de UI (Chrome headless por CDP, DOM real, na 4188): bancada do item, diálogo de itens (chips, duplicado, remoção, colar em lote, criação real), evidência vinculada/desvinculada **com a mesma linha antes e depois** (prova de que não recria e não pisca), Ajustes (contagem, adicionar/remover, aviso de limite, 409 em uso) e criação de processo (campo de status sumindo no limite).
- Dados ao final: 4 documentos e 6 verificações no processo de teste, ids e rótulos dos status iguais aos do início; produção com `git status` limpo.

**Pendente:** validação visual do Sergio em `http://localhost:4188`, commit no `fase-a` e, só depois, decisão de deploy.

### 14.7 Ajustes de 2026-11-16 (segunda rodada de feedback)

1. **Botão de adicionar saiu do topo.** O “+ item” do masthead e o “Adicionar item”/“Importar” do cabeçalho da página saíram; agora há um único botão dentro da sessão de análise (`.checks__head`), ao lado da barra de progresso, escolhido pelo fluxo do processo: **“Importar mais”** no fluxo por documentos, **“Adicionar item”** no fluxo por itens. Vale para processos já existentes também. No celular ele passa a ocupar a linha inteira (36 px de altura).
2. **“Importar mais” continua disponível.** Antes o botão de importar só existia na tela vazia; agora fica sempre visível na sessão de análise, mesmo depois de verificações concluídas.
3. **Ajustes → Dados e backup ganhou dois cartões separados.**
   - **“Excluir este processo”**: remove só o processo aberto (critérios e verificações dele), pedindo confirmação com o nome; se houver documentos, recusa com aviso em vez de apagar. Testado ponta a ponta: o processo sai do servidor e os outros continuam.
   - **“Apagar todos os dados”** (antes “Reiniciar tudo”): o texto agora diz que apaga **todas** as coleções, processos, critérios, documentos, verificações e arquivos, e aponta o caminho certo para remover um só.
4. **Fim do último redesenho de página.** `removeEvidence()` ainda chamava `renderAll()` quando não recebia `refreshList`; agora atualiza só as linhas e o diálogo. Nenhum caminho de status/anexo reconstrói a página.
5. **Sincronia de 12 s sem piscar.** Quando outro dispositivo escreve, o estado novo era aplicado com `renderAll()`. Agora, se a estrutura não mudou (mesmos documentos, mesmos critérios, mesmos status personalizados e linhas na tela), o app aplica o estado **linha por linha** (`patchRemoteState`), atualizando cabeçalho, resumo e contadores; só reconstrói quando muda documento/critério.
6. **Teclado no toque.** Ao marcar “não conforme”/“observação” o campo de nota recebia foco, o que no iPad abre o teclado e parece uma recarga da tela. O foco automático foi desligado em dispositivos de toque (`pointer: coarse`) e sempre usa `preventScroll`.

### 14.8 Verificação da segunda rodada

- Suíte de UI (Chrome headless/CDP, 1280 e 390 px): 18 asserções de comportamento + 20 de layout + 6 de exclusão de processo, todas passando.
- Medições de “piscar”: clique em status = 16 mutações e **nenhuma** troca de página; vincular/desvincular anexo = 2 mutações; escrita externa + sincronia de 12 s = linha atualizada, página intacta, rolagem preservada.
- Exclusão real: processo vazio “TESTE VAZIO” criado, excluído pela interface, sumiu da lista e do servidor (5 processos restantes, nenhum outro afetado).

### 14.9 Ajustes de 2026-11-16 (terceira rodada de feedback)

1. **Excluir processo agora apaga tudo dele — em cascata.** Antes o servidor recusava com “Exclua ou mova os documentos antes de excluir o processo”, o que prendia o usuário. `DELETE /api/processes/:id` passou a levar junto, numa única gravação atômica: documentos do processo, verificações, critérios, os arquivos em `data/files/` (apagados depois do commit, em `try/catch`), os `check.attachments` de **outros** processos que apontavam para documentos removidos, `meta.lastDocByProcess[id]`, `meta.lastCheckId` órfão e as chaves de presença `id:…`. A resposta traz `{ rev, state, removed: { documents, checks, criteria } }`.
2. **“Apagar tudo” saiu do produto.** O cartão “Apagar todos os dados”, a função `resetAll()` e a ação `reset-data` foram removidos. Em Ajustes sobrou só **“Excluir este processo”**, que age apenas no processo aberto (critérios, documentos, verificações e arquivos dele) e diz isso na confirmação: “sai do SCAD com N documento(s), N verificação(ões)… Nenhum outro processo da coleção é afetado. Não há desfazer.” Contagens zeradas são omitidas do texto.
3. **O botão de adicionar vive na sessão de análise, em qualquer estágio.** Antes ele sumia quando as verificações começavam. Agora aparece na “Sessão de análise” ao lado da barra de progresso em todos os estados do analista (não iniciado, em andamento, concluído, com apontamentos): **“Importar mais”** no fluxo por documentos, **“Adicionar item”** no fluxo por itens. Só não aparece para o revisor, que não adiciona conteúdo.
4. **Fim do piscar no PC.** O que redesenhava a tela a cada ação era a substituição de nós: `syncAfterCheck()` trocava o cabeçalho da sessão por `outerHTML` (o que reiniciava a transição da barra e dos contadores) e `updateCheckRow()` trocava a linha inteira por `replaceWith`. Agora existem dois “remendos cirúrgicos”:
   - `patchChecksHead(state, doc)` atualiza `.checks__num` e a barra só quando o HTML muda de fato, respeitando documento inativo;
   - `patchCheckRow(row, state, check, options)` atualiza classe, `aria-label`, selo, `aria-pressed`, insere/remove o bloco de nota e sincroniza o `<textarea>` **apenas se ele não estiver em edição**; devolve `false` quando a linha é de outro tipo (`data-review`/`data-opts`) e aí sim vale redesenhar.
   Medido: digitar na observação, marcar status e anexar/remover evidência **não trocam nenhum nó** (0 substituições), então nada pisca nem perde o cursor.
5. **Foco automático na nota de volta.** O foco ao marcar “não conforme”/“observação” havia sido desligado por causa do iPad; voltou para todos os dispositivos, sempre com `preventScroll: true` (não rola a tela e não reposiciona a página).

### 14.10 Verificação da terceira rodada

- 95 asserções de UI (Chrome headless via CDP, 1600/1280/390 px), todas passando: 27 de comportamento da rodada (`_round3`), 20 da suíte de telas (`_ui2`), 6 de exclusão de processo vazio (`_ui4`), 20 de layout (`_ui5`), 15 de varredura de status/anexo nas três telas (`_sweep`) e 7 de “piscar” (`_flick`).
- Exclusão em cascata exercitada pela interface com um processo de fixture (“TESTE CASCATA …”) contendo 1 documento real, 2 verificações e 2 critérios: a gaveta mostrou as contagens, o processo sumiu do servidor, o documento e as verificações não sobraram no escopo, o **arquivo foi apagado do disco** e o processo vizinho continuou com seus 1 documento e 2 verificações.
- Limite conhecido do teste: no Chrome headless a janela não recebe foco do sistema, então `focus()` é ignorado pelo navegador. A asserção verifica que o app **pede** o foco no `textarea` certo (`HTMLElement.prototype.focus` instrumentado); a confirmação visual do cursor fica com o usuário no iPad e no PC.
- Nada foi commitado nem levado para produção: tudo continua em `scad-v2` (branch `fase-a`) na porta 4188, aguardando validação.

### 14.11 Preparação do deploy da v2.1 (2026-11-16)

1. **Excluir processo pede o nome digitado.** `confirmSheet()` ganhou `requireText`: a gaveta mostra “Para confirmar, escreva **NOME**” e o botão “Excluir processo” nasce desabilitado (`[disabled]`, opacidade 0.45), liberando só quando o texto digitado casa com o nome do processo (comparação sem diferenciar maiúsculas e ignorando espaços nas pontas). Enter confirma quando liberado; digitar o prefixo do nome não libera. Só a exclusão de processo usa o recurso — as outras confirmações (critério, documento, restaurar backup) continuam num clique.
2. **Versão visível.** `VERSION` do servidor passou de `2.0.0` para **`2.1.0`**, para o `/api/health` provar qual código está no ar. O cartão de Ajustes deixou de dizer “Sobre este experimento · v0.1” e agora diz “Sobre este programa” com a versão lida do próprio servidor (`ui.health.version`).
3. **Compatibilidade verificada antes do deploy** (produção intocada, rev 1223): o banco de produção **já está em schema 2**, então não há migração no boot; `normalizeState` só acrescenta campos, e o `db.json` não é reescrito no boot (só na primeira alteração). As 40 verificações sem objeto `review` ganham `{status:'pending'}` e isso não altera a fila do revisor, que é por documento e só inclui documento com todas as verificações respondidas. `public/` tem os mesmos 19 arquivos nos dois lados (nenhum arquivo novo ou removido). O cliente tolera `localStorage` de versão anterior (leitura em `try/catch`, com validade de 7 dias).
4. **Servidor de produção roda como SYSTEM** (sessão 0, `cmd.exe` filho do `svchost` do Agendador de Tarefas), provavelmente por tarefa de boot que não aparece sem elevação. Consequência prática: uma sessão sem elevação **não consegue encerrar** o processo, então a janela de deploy precisa de alguém com administrador (Gerenciador de Tarefas) ou de um reinício da máquina — a tarefa de boot sobe o código novo.


### 15. Deploy da v2.1 em produção (2026-11-16, executado)

- **Backup pré-deploy verificado**: `backups\2026-11-16_11-41-18\` — `db.json` com sha256 `3057D215745A4836DE8E986693F4DA4B1568E741DA1F7BDA5B33019219AB914A` (255.529 bytes), os 82 arquivos de `data/files` conferidos um a um por hash (10,0 MB) e `sha256.txt` com as 83 linhas.
- **Código**: `fase-a` commitado (`e8b45ab`) e enviado; `master` recebeu o merge `e810afe`; runbook novo em `DEPLOY_V2.md` (`32d6854`); tags **`v2.0.0`** (= `553a1fe`, estado anterior) e **`v2.1.0`** (= `32d6854`), ambas empurradas para o GitHub junto com `master`.
- **Reinício**: o processo de produção rodava como SYSTEM e não podia ser encerrado por uma sessão sem elevação; o usuário finalizou o `node.exe` do SYSTEM pelo Gerenciador de Tarefas. O servidor foi então subido nesta sessão (`node server.mjs`, PID 9120, órfão e vivo, log em `logs\servidor.log`). A tarefa de boot volta a assumir no próximo reinício da máquina.
- **Conferência pós-deploy**: `/api/health` com `version: 2.1.0`, `schemaVersion: 2`, porta 4177; **rev 1223** (a mesma de antes), 1 coleção, 3 processos, **82 documentos, 287 verificações** (117 ok · 59 nc · 70 obs · 41 pendentes), **9 critérios**, 82 arquivos e as **6 revisões decididas** (5 aprovadas, 1 sinalizada) — idênticos à linha de base.
- **Prova de que nada foi reescrito no boot**: `db.json` continuou com o mesmo sha256 do backup depois de o servidor novo subir. A primeira gravação de verdade (quando alguém alterar algo) acrescenta os campos novos e só então o hash muda.
- **Interface conferida em 4177** por Chrome headless, só leitura: Painel e Coleções carregam, Ajustes mostra “Sobre este programa · **v2.1.0**”, “Apagar tudo” não existe e “Excluir este processo” está no lugar; **nenhum erro de JavaScript**. Os três endereços respondem: `127.0.0.1`, `100.121.75.29` (Tailscale, o do iPad) e `192.168.56.211`.
- **Pendências para a próxima rodada**: (a) `fase-a` ficou atrás de `master` (merge e runbook) — ao voltar a mexer no dev, `git merge origin/master` antes de começar; (b) `/api/reset` continua existindo no servidor sem botão na interface (remover de vez é decisão do usuário); (c) enquanto não houver reinício da máquina, o SCAD roda na sessão do usuário — se ele fizer logoff, o servidor para e o caminho é abrir `iniciar-scad.bat`.

### 16. Previa de documentos dentro do proprio SCAD (2026-11-16)

1. **Word nao serve como conversor nesta maquina.** A automacao do Word (COM) abre e edita qualquer arquivo, mas trava em **qualquer tentativa de gravar** - ExportAsFixedFormat, SaveAs2 em PDF e em HTML, arquivo novo de uma pagina, com Microsoft Print to PDF, com o PDFMaker desligado e com janela visivel. Nao ha dialogo escondido (EnumWindows so mostrou janelas internas do Word) e o spooler esta rodando. Alem disso, o servidor roda como SYSTEM depois do reboot, onde automacao de Office e ainda menos confiavel. Caminho abandonado.
2. **Como a previa funciona.** O proprio navegador desenha o arquivo, sem servidor, sem conversao e sem instalar nada: public/vendor/docx-preview.min.js (Apache-2.0) + jszip.min.js (MIT), baixados em public/vendor com LICENCIAS.md, carregados **sob demanda** (public/js/preview.js) apenas quando alguem abre uma previa. O .docx e um ZIP de XML, entao nada sai da maquina de quem esta olhando.
3. **Onde a previa aparece.** Gaveta "Ver arquivo" na pagina do documento; botao por linha **na lista de documentos e na listagem de itens**; chip da evidencia dentro de cada criterio; e a lista de evidencias do item (abre direto quando ha uma so, mostra escolha quando ha varias). Em todos os casos a largura da pagina e reduzida para caber na tela (medido em 1440, 820 e 390 px, sem transbordo).
4. **.doc antigo continua aceito, sem bloqueio.** Decisão do usuário: nada de impor ou bloquear formato na alimentação. O .doc ganhou prévia em texto (item 7), então ninguém fica sem acesso ao conteúdo; quem importa em .docx ganha a prévia fiel ao layout, e é esse benefício que puxa a padronização, sem regra nenhuma no servidor.
5. **Medicoes (dev 4188, Chrome headless via CDP).** .docx de 577 KB desenha em ~308 ms com 4.583 caracteres, 2 tabelas e 1 imagem; .docx de 1,1 MB em ~310 ms com 3.160 caracteres e 3 imagens; .doc mostra o texto (5.265 caracteres em 75 linhas); zero erro de JavaScript em todas as rotas dos dois fluxos (documentos e listagem).
6. **Situação.** (a) .doc em texto - **feito** (itens 7 e 8); (b) teste no iPad físico pelo Sergio; (c) merge com master resolvido (conflito só no fim deste arquivo) e deploy da v2.2 na produção feito nesta rodada.
7. **O .doc antigo agora mostra o texto.** public/js/doc-text.js lê o próprio arquivo no navegador: contêiner OLE/CFB (FAT, diretório, mini fluxo), cabeçalho do Word (FIB) e a tabela de trechos (CLX/PlcPcd), com trechos de 8 bits em CP1252 e de 16 bits em UTF-16LE; campos (0x13–0x15) saem, fim de célula/linha viram quebra e o resultado é arrumado em parágrafos. Sem dependências. A gaveta mostra o texto numa folha branca de leitura (.doc-text__sheet, 794 px, serifada) com a nota de que é prévia em texto. Casos tratados: senha, arquivo só de imagem, formato danificado e **.doc que por dentro é .docx** (na produção existem 4 — esses caem na prévia completa do .docx, com aviso na nota).
8. **Conferência nas 52 cópias de .doc da produção** (cópias em C:\Temp\scad-docs, produção intocada): 45 lidas inteiras, razão entre **0,92 e 1,24** contra o ccpTexto que o próprio arquivo declara (acima de 1 pelo cabeçalho/rodapé, abaixo só porque o texto dos campos é descartado), 4 são .docx renomeados, **nenhuma leitura parcial**, ~4 ms por arquivo. No navegador (4188): POP 0027 com 5.265 caracteres em 75 linhas, sem transbordo em 1440/820/390 px.

### 17. Deploy da v2.2.0 em produção (2026-11-16, executado)

- **Backup verificado**: `backups\2026-11-16_16-57-19\` — `db.json` de 298.379 bytes com sha256 `71357B8020AB7CC98AA6BDD82CAF9A342B3F7AB5F45F694A8E3F531FAC13F2E6`, os 95 arquivos de `data/files` conferidos um a um por hash (11,87 MB, 96 linhas em `sha256.txt`), mais `server.mjs.antes` e `public.antes\` para rollback imediato.
- **A produção tinha sido usada desde a v2.1**: rev 1223 → **1543**, 3 → **4 processos** (o usuário criou o **AAF**, com fluxo de itens), 82 → **108 documentos**, 287 → **327 verificações**, 82 → **95 arquivos**, 9 → 11 critérios. Inventário dos arquivos: **52 .doc, 36 .docx, 7 .pdf** e 13 itens sem arquivo.
- **Código**: `fase-a` recebeu o merge de `master` (o único conflito foi no fim deste arquivo — as duas seções se mantiveram), `VERSION` passou a **2.2.0**, tag **`v2.2.0`**; `master` fez fast-forward e foi empurrado junto com a tag e o `fase-a`.
- **Publicação sem parada**: os arquivos estáticos são servidos do disco sem cache, então o `git merge --ff-only fase-a` no clone de produção já colocou a prévia no ar com o servidor antigo rodando (`/js/preview.js` e `/vendor/*.js` responderam 200 antes do reinício).
- **Reinício**: o `node.exe` da produção (PID 9120) era o que esta sessão subiu na v2.1 — **pôde ser encerrado** (ao contrário do processo do SYSTEM do v2.1). Parada e nova subida na mesma janela: `node server.mjs` = **PID 11272**, log em `logs\servidor-2.2.log`, `/api/health` com `version: 2.2.0`.
- **Conferência**: `db.json` **byte a byte igual** ao backup depois do reinício (mesmo sha256, rev 1543) — o boot continua sem reescrever nada; DC com 41 documentos e 246 verificações antes e depois; Ajustes mostra **V2.2.0**.
- **Prévia conferida na própria produção**, Chrome headless e só leitura: POP 0001 (.docx) desenha 1 página com 4.039 caracteres; POP 0013 (.doc) mostra 4.464 caracteres em 92 linhas; na listagem do AAF (13 itens) os 3 com evidência abrem a escolha e o PDF vai para a moldura; as 41 linhas do POP têm botão de prévia; **zero erro de JavaScript** e **nenhuma escrita** (hash do db.json idêntico, rev 1543).
- **Resultado**: todo arquivo da produção tem alguma prévia — 36 .docx com layout, 52 .doc em texto e 7 .pdf na moldura do navegador.

### 18. Varredura: o que dá para acrescentar na prévia (2026-11-16, propostas)

Levantamento feito no código já em produção (nada implementado ainda):

1. **Apontamentos não abre o arquivo.** `views/findings.js` só oferece "editar nota" (`data-action="finding-edit"`): a linha mostra documento, critério e observação, e daí não há como ver o arquivo — nem prévia, nem link. É o buraco mais visível, porque o revisor lê o apontamento e quer conferir o documento na hora. Correção barata (botão "Ver arquivo" reaproveitando `doc-preview`).
2. **Buscar dentro do documento.** Hoje a gaveta não tem busca: num POP de 10 páginas ou num .doc de 92 linhas o revisor rola até achar. Dá para destacar ocorrências no texto já renderizado (docx e .doc em texto), com contador e "próxima" — tudo no cliente, sem tocar no arquivo.
3. **Tabelas no .doc viram texto corrido.** As células terminam em 0x07 no fluxo do Word; hoje viram quebra de linha e a tabela perde a forma (dá para reconstruir com `<table>` quando houver células na mesma linha). Vale porque 52 dos 95 arquivos da produção são .doc e quase todos têm tabela de responsabilidades/prazo.
4. **Formato aceito sem prévia.** `.txt`, `.rtf` e `.odt` são aceitos na importação, mas caem no aviso "este formato não tem pré-visualização". `.txt` é uma linha de código; `.odt` é ZIP (mesmas bibliotecas do .docx, com outro nome de arquivo interno); `.rtf` exigiria conversor — deixar como está e explicar.
5. **Primeira prévia espera as bibliotecas** (172 KB de jszip + docx-preview). Baixá-las em segundo plano (`requestIdleCallback`) depois que a lista carrega deixa a abertura instantânea no PC; em acesso remoto custa dados, então só faz sentido com a otimização de gzip que está no backlog.
6. **Zoom e tela cheia na prévia do .docx.** Hoje a página é reduzida automaticamente para caber (zoom mínimo 0,25); não há como ampliar nem usar a gaveta inteira. Em iPad, "expandir" resolve leitura de documento denso.
7. **Prévia ao lado da verificação (ideia maior).** O fluxo real é ler o POP e responder os critérios; hoje a prévia abre por cima e cobre a tela. Um modo dividido (documento de um lado, critérios do outro) é o ganho grande de produtividade, mas é mudança de tela, não de prévia.

### 20. Correção com versionamento e reabertura de revisão (v2.3, em validação — 2026-11-17)

**Numeração:** esta cópia de dev não tem a seção 19 da `master` (incidente do servidor fora do ar em 17/11); na hora do merge as duas convivem.

**Estado:** implementado no worktree `scad-v2` (branch `fase-a`, servidor de teste na **4188**, dados copiados da produção em `.qa-correcao/`). A produção em `scad` (`master`, 4177, v2.2.0) segue intocada — nada desta seção existe lá. Só vai para produção depois da validação do Sergio.

**Origem (CAPA):** quando a auditoria ou o próprio revisor encontra algo num documento já aprovado, hoje sobram dois caminhos ruins: excluir e reimportar (perde histórico) ou "dar a autoridade de revisar ao analista" (não é o papel dele). A decisão do usuário foi manter a autoridade no revisor: **o analista envia a versão corrigida e o revisor aprova a nova versão**; e o revisor pode **reabrir** um documento aprovado dizendo o motivo.

#### 20.1 Como o fluxo ficou

| Passo | Quem | O que acontece |
|---|---|---|
| 1. Enviar correção | analista | Na página do documento (ou na bancada), "Adicionar correção" abre uma gaveta com arrastar-e-soltar. O arquivo novo fica **pendente**; o vigente continua no ar e o documento passa a "aguardando". |
| 2. Comparar e aprovar | revisor | "Visualizar correção" abre a **gaveta de comparação** com o antes, o depois e os critérios da última análise (dá para sinalizar um critério dali mesmo, com mensagem). O botão "Aprovar documento" promove a correção a versão nova e arquiva a anterior. |
| 3. Reabrir revisão | revisor | Em documento **aprovado**, "Reabrir revisão" exige **motivo** (até 1000 caracteres); as verificações voltam a "aguardando" mantendo os resultados, e a faixa mostra quem reabriu, quando e por quê. O analista ajusta e o revisor aprova de novo. |

O arquivo antigo **nunca é apagado**: fica em `versions[]` e continua abrível pela gaveta "Versões" (`v1`, `v2`, … com a vigente marcada como "Atual").

#### 20.2 Modelo de dados (schema v2, aditivo)

| Campo | Onde | Regra |
|---|---|---|
| `document.correction` | documento | `{stored, name, mime, size, addedAt, by, byName}` — no máximo **uma** pendente. |
| `document.versions[]` | documento | Arquivos substituídos: mesmos campos + `replacedAt`, `replacedBy`, `replacedByName`. Guardados em `data/files` como `${docId}-v${n}-${hex}.${ext}`. |
| `document.reopen` | documento | `{at, by, byName, reason}` — motivo obrigatório; some na aprovação seguinte. |
| `review` (derivado) | documento | `docReview` passou a devolver `correction`, `reopened` e `versions`; documento com correção pendente ou reaberto aparece como **`awaiting`**. |

Ordem do selo na lista e no documento: inativo → aprovado → atenção → **corrigido · vN** → **reaberta** → aguardando → apontado → verificado. Versionamento derivado: `currentVersion = 1 + versions.length`, `correctionVersion = 2 + versions.length`.

#### 20.3 API

- `POST /api/documents/:id/correction` `{name, data}` (base64) → **201** `{rev, state, correction, review, activity}`; recusa item de listagem (400), documento inativo (409) e correção já pendente (409).
- `DELETE /api/documents/:id/correction` → só **quem enviou** remove (403 caso contrário); apaga o arquivo do disco.
- `POST /api/review/approve` → quando há correção, na mesma gravação: empurra o arquivo vigente para `versions` com `replacedAt/replacedBy/ByName`, promove a correção a vigente e limpa `correction` + `reopen`. A atividade diz "… correção vN promovida e versão anterior arquivada".
- `POST /api/review/reopen` `{docId, reason}` → **só revisor**, **só documento aprovado** (409), motivo obrigatório (400). Zera `review` das verificações não pendentes (o resultado `ok/nc/obs` é preservado) e registra a atividade.
- `GET /files/:stored` → passou a resolver o arquivo **atual, a correção pendente e as versões arquivadas** (`fileOwner`); antes só o arquivo vigente era servido, então o histórico daria 404.
- `DELETE /api/documents/:id` → apaga também o arquivo da correção e todas as versões.

#### 20.4 Telas

- **Página do documento:** faixa de correção (arquivo, tamanho, autor, data + dica para o revisor) e faixa de reabertura (motivo + autor + data); ações "Visualizar correção"/"Adicionar correção", "Reabrir revisão" (revisor) e "Versões: v1, v2".
- **Gaveta de comparação** (`sheet--compare`, até 1320 px): três painéis — **original**, **corrigido** e **critérios** com o selo e a mensagem da última análise; rodapé com Fechar, "Remover correção" (autor), "Abrir corrigido" e "Aprovar documento" (revisor). Abaixo de 1100 px os painéis viram **abas** (`Original · Corrigido · Critérios`).
- **Painel "O que mudou"** (dentro da comparação, entre a barra do topo e os painéis): lista recolhível com os trechos de texto que mudaram entre a versão vigente e a corrigida — resumo em `N trechos alterados · N adições · N remoções · N alterações`, âncora (o parágrafo igual anterior) e as palavras marcadas (`del`/`ins`). **Vem sempre fechado** (o revisor compara lado a lado primeiro e abre se quiser o detalhe); o rodapé do painel lembra que os trechos vêm do texto dos arquivos. Só apoio à leitura: o registro continua sendo o arquivo aprovado.
- **Gaveta "Adicionar correção":** dropzone com anexo por clique, prévia local antes de enviar, nome pré-preenchido e botão "Enviar correção vN" bloqueado até haver arquivo.
- **Gaveta "Versões":** cada versão abre na prévia (PDF, .docx, .doc em texto, imagem); a vigente aparece como "Atual".
- **Bancada:** com correção pendente o cartão de conclusão muda para "Correção enviada" com a ação "Visualizar correção".
- **Lista de documentos:** selo "Corrigido · vN" e "Reaberta".

#### 20.5 Como foi verificado (4188, dados copiados da produção)

- `node --check` em `server.mjs` e nos 9 módulos do cliente.
- **API** (`scripts/correctiontest.mjs`): **54 asserções**, todas passando — envio, bloqueio de segunda correção, remoção só pelo autor, 403 de revisor/analista nos papéis trocados, promoção com versão arquivada servida (200), versões em ordem, reabertura sem motivo (400), reabertura por analista (403), checks voltando a "aguardando" com o resultado preservado, reaprovação limpando `reopen`, documento inativo (409), item de listagem (400) e exclusão com arquivos apagados (404). O script cria o próprio documento de trabalho, então roda repetido sem depender do estado deixado pela rodada anterior.
- **Interface** (`scripts/correctionui.mjs`, Edge headless por CDP): **42 asserções**, todas passando — selo na lista, faixas, comparação com as três colunas (1440 px), abas e troca de painel (820 px), gaveta de versões fechando, gaveta de correção com envio bloqueado, aprovação pela comparação, reabertura com motivo e selo "Reaberta", aviso de "sem texto para comparar" no par de PDFs e o painel "O que mudou" no par de .docx (abre **fechado**, aviso de que o texto é do arquivo, resumo, âncoras, palavras destacadas, parágrafo novo, prazo trocado e recolher/reabrir). **Zero exceção de JavaScript.**
- **Motor de comparação** (`scripts/difftest.mjs`): **28 asserções** unitárias sobre `public/js/diff.js`, rodando no Node sem navegador (o módulo entra por `data:` URL) — parágrafos, adição, remoção, alteração de palavra, parágrafo reescrito (vira remoção + adição), repetidos, espaçamento, ordem do documento, documento vazio e texto de 1.200 linhas.
- **Layout medido no navegador** (1440 px, 834 px e 390 px): o painel fica entre a barra e os painéis, com a mesma largura deles; sem estouro horizontal da página; o resumo quebra em vez de cortar no estreito; a lista rola por dentro (máx. 34vh, 46vh no estreito).
- **Regressão:** `scripts/reviewtest.mjs` (24 asserções do fluxo de revisão e presença) passou inteiro sobre um documento com correção pendente; `scripts/reviewui.mjs` passou 26 de 28 — as duas falhas são as de **presença na matriz**, que dependem da sincronia de 12 s (o teste faz o POST e lê a matriz antes do próximo batimento); código de presença não foi tocado nesta rodada.
- Limpeza: `scripts/qapreparecorrecao.mjs` deixa o cenário pronto (uma versão arquivada + uma correção pendente + um documento aprovado extra + um par de .docx com diferenças conhecidas, gerado por `scripts/mkdocx.mjs`).

#### 20.6 Pendências desta rodada

1. Validação visual do Sergio em `http://localhost:4188` (as capturas estão em `shots/correcao-*.png`; o painel novo é `shots/correcao-11-diff.png`).
2. Commit no `fase-a` (feito nesta rodada); merge/deploy só com OK explícito.
3. `scripts/smoke.mjs` e `scripts/qa.mjs` são da v1 (`/api/process`, `/api/state` sem processo) — não servem de rede de segurança para a v2; ou atualizam, ou saem do repositório.
4. O módulo **Controle de Validade** (contagem de validade de documentos, decidido em 17/11) continua no backlog do Kanban, fora desta entrega.

#### 20.7 Painel "O que mudou" — comparação de texto (commit separado, 2026-11-17)

Decidido depois de a correção com versionamento já estar validada: o diff entrou como **etapa separada**, em **commit próprio**, para poder ser revertido sozinho.

- **Onde roda:** só no navegador. **Nenhuma mudança no servidor, na API ou no schema** — se o diff incomodar, `git revert` do commit devolve exatamente o estado validado antes dele.
- **Módulos novos:** `public/js/diff.js` (motor) e a leitura de texto em `public/js/preview.js` (`textoDoArquivo`); desenho do painel em `public/js/views/correction.js` (`diffBodyHtml`, `diffAvisoHtml`); ligação em `app.js` (`montarDiffCorrecao`).
- **Como compara:** alinhamento por **parágrafos** (LCS) e, dentro do parágrafo alterado, marca **palavra por palavra**. Parágrafo sem nada em comum com o par vira "remoção + adição" (não tenta parecer "alteração"). Cada trecho vem com a âncora do último parágrafo igual, para o revisor achar o ponto no documento.
- **Apresentação (ajustada no teste do Sergio, DC 0008):** o painel **começa fechado** — a comparação lado a lado é o que o revisor veio ver; o resumo fica no cabeçalho e quem quiser o detalhe abre. No corpo, a única mudança é a frase do rodapé, que já existia: agora ela diz que os trechos são **copiados do texto dos dois arquivos** e que aquilo é o conteúdo do documento, não informação do sistema (o bloco "Elaborado/Aprovado/Revisado por" do próprio formulário aparece ali como texto do documento). Uma primeira tentativa pôs um quadro de aviso no topo do painel e mudou o estilo da âncora — o Sergio reprovou a estética ("ficou feio, a primeira versão combinava mais com o SCAD") e o visual foi **devolvido ao original**.
- **O que compara:** o **texto**. Imagens, tabelas, cabeçalho, numeração automática e formatação não entram — e o painel diz isso ao revisor. `.docx` e `.doc` são lidos; **PDF digitalizado não tem texto** e recebe um aviso explícito ("PDF digitalizado não tem texto para comparar") em vez de um resultado falso vazio. Os 7 PDFs da produção são formulários assinados/digitalizados — neles a comparação continua sendo lado a lado, como antes.
- **Limite conhecido do `.doc`:** como o `.doc` é extraído como texto corrido, o cabeçalho do formulário pode aparecer deslocado dentro da lista (no teste do DC 0008, o bloco do cabeçalho caiu junto do item 7). É artefato da conversão, não do documento; o `.docx` mantém a ordem dos parágrafos.
- **Custo:** guardas de tamanho (`LIMITE_BLOCOS`, `LIMITE_PALAVRAS`) para documento gigante não travar a aba; a lista mostra até 80 trechos e avisa quantos ficaram de fora.
- **Testes:** `scripts/difftest.mjs` (28, no Node), `scripts/correctionui.mjs` (42 no navegador, 12 delas do painel) e `scripts/mkdocx.mjs` para gerar o par de .docx do cenário.
