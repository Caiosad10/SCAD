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
- A implementação de perfis, revisão e atribuição de atividade está na **Fase B** (ainda não implantada).

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

### 4.3 Revisão (Fase B) — decidido, ainda não implementado

- Sergio produz; **Diogenes revisa**. Diogenes só **aprova ou sinaliza**; não altera as verificações do Sergio.
- Verificação feita pelo próprio **revisor** é **auto-aprovada**.
- **Aprovação de documento em bloco** + possibilidade de **sinalizar critérios individualmente**.
- Ao sinalizar um critério, os demais checks com resultado são **aprovados automaticamente** (confirmado).
- **Mensagem na aprovação:** opcional. **Mensagem na sinalização:** obrigatória, por critério.
- Documento sem todos os checks preenchidos continua **pendente**, sem revisão.
- Se o Sergio altera um check já aprovado, aquele check volta para **aguardando revisão**.
- Se o Diogenes sinaliza, o documento fica **Atenção**; Sergio corrige e o documento volta para a fila de revisão.
- **Sem revisor ativo, o documento do Sergio fica aguardando** (não há autoaprovação do analista).
- Documento aprovado: todos os checks aprovados ou feitos pelo revisor.
- **Migração dos dados atuais:** documentos com todos os checks concluídos passam a **Aguardando revisão**; documentos incompletos continuam pendentes. Checks existentes têm autor **Sergio** e revisão pendente.
- **Histórico:** autor, decisões, mensagens e datas por check; aparece no CSV/backup.
- **Concorrência:** aprovação vinculada à versão do check; se mudou, a aprovação antiga é recusada.
- **UX escolhida:** sem nova aba. A linha da matriz/lista mostra o estado de revisão (`Aguardando revisão`, `Aprovado`, `Atenção`); o revisor clica na linha e entra em um modo de revisão; o autor vê o selo, abre, lê as sinalizações e trata. Filtros “Aguardando revisão”/“Devolvidos” na lista de documentos e um card no painel.

### 4.4 Atividade

- O histórico atual **não será apagado**.
- A partir da Fase B, cada entrada registra **autor** (Sergio/Diogenes) e a interface mostra o responsável.
- Eventos: importação, exclusão/renomeação, critérios, verificações, notas, aprovações, sinalizações, dispensa/reativação, revisão.

---

## 5. Decisões de interface

- Identidade visual: papel/tinta, serifa editorial, azul institucional, cápsula escura.
- Barra flutuante em cápsula, pílula deslizante, rótulo só no ativo, 44–48 px de alvo.
- Transições de página com fade/slide (~130 ms + 210 ms), shell persistente.
- Reabertura instantânea com cache de sessão; rota restaurada após recarga (iPad).
- **Nas telas de Coleções e de Processos a barra deve desaparecer** (fora do contexto do processo); ao entrar num processo ela **surge suavemente** (fade/slide de baixo). Confirmar no desenvolvimento da Fase A.
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
6. Barra nas telas de coleções/processos: ocultar e animar ao entrar no processo — **confirmado**; ajustar o movimento na prática.

**Resolvidos:** percentual ponderado por verificações; código 1+2; barra oculta nas listas e animada ao entrar no processo.

---

## 9. Versionamento

- Repositório remoto: `https://github.com/Caiosad10/SCAD.git`
- Estado **v1.0** (produção antes da Fase A): commit `294b890`, tag `v1.0`.
- Bundle local de segurança: `backups/scad-v1.0.bundle` (contém todo o histórico e tags).
- `data/`, `backups/` e cópias de QA ficam fora do Git.
- Push pendente por indisponibilidade de rede/credenciais no ambiente do agente. Quando houver rede:
  ```bash
  git push -u origin master
  git push origin v1.0
  ```
- A Fase A deve ser desenvolvida em branch `fase-a`, testada em cópia e só então mesclada em `master` com nova tag (`v2.0`).

## 10. Protocolo de alteração em produção

1. **Nunca** testar reset/importação/demo no banco de produção.
2. Backup de `data/db.json` + `data/files` + código (`server.mjs`, `public/`) antes de mudanças de schema.
3. Trabalhar em cópia (`SCAD_DATA=.qa-data`, porta 4188) e validar com dados reais copiados.
4. Migração idempotente, versionada, com validação de contagens e backup pré-migração.
5. Mudanças somente de interface são publicadas em `public/` sem reiniciar; mudanças de servidor/schema exigem janela curta e reinício.
6. Em caso de falha: restaurar backup e versão anterior do servidor.
7. Registrar toda decisão neste arquivo e no quadro Kanban.

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

---

## 12. Limitações conhecidas

- Um processo ativo por instalação (Fase A corrige).
- Sem autenticação; confiança na rede local. Não expor na internet.
- PDF no iPad pode exigir “Abrir em nova aba”.
- Sem OCR, anexo de evidência por apontamento ou comparação de versões.
- Arquivos até ~32 MB por upload.
