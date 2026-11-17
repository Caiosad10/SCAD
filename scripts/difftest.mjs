/**
 * Testa o motor de comparação de texto (public/js/diff.js) sem navegador.
 *
 * O módulo é ESM de cliente; para importá-lo aqui sem mexer no projeto, o
 * arquivo é carregado como módulo de dados (`data:` URL), que o Node aceita.
 *
 * Uso: node scripts/difftest.mjs
 */
import fs from 'node:fs/promises';

let falhas = 0;
function check(nome, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  ok   ${nome}`);
  } else {
    falhas += 1;
    console.error(`  FAIL ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

const fonte = await fs.readFile(new URL('../public/js/diff.js', import.meta.url), 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(fonte).toString('base64')}`);
const { diffTexto, diffPalavras, blocosDeTexto, resumoEmTexto } = mod;

/* 1) blocos */
const blocos = blocosDeTexto('um\n\n  dois   com   espaços \n\n');
check('quebra em parágrafos e ignora linhas vazias', blocos.length === 2, JSON.stringify(blocos));
check('colapsa espaços dobrados', blocos[1] === 'dois com espaços', blocos[1]);

/* 2) textos iguais */
const igual = diffTexto('a\nb\nc', 'a\nb\nc');
check('texto igual não gera trecho', igual.resumo.total === 0, String(igual.resumo.total));
check('texto igual é 100% parecido', igual.resumo.parecenca === 1, String(igual.resumo.parecenca));

/* 3) parágrafo acrescentado */
const acrescentou = diffTexto(
  '1. Objetivo\n2. Responsabilidades',
  '1. Objetivo\n2. Responsabilidades\n3. Registro em 24 horas'
);
check('uma adição é contada', acrescentou.resumo.adicoes === 1, JSON.stringify(acrescentou.resumo));
check('adição não conta como remoção', acrescentou.resumo.remocoes === 0);
check('adição guarda o texto novo', acrescentou.trechos[0]?.depois.includes('24 horas'), acrescentou.trechos[0]?.depois);
check(
  'adição usa o parágrafo anterior como âncora',
  acrescentou.trechos[0]?.contexto === '2. Responsabilidades',
  acrescentou.trechos[0]?.contexto
);

/* 4) parágrafo removido */
const removeu = diffTexto('1. Objetivo\n2. Prazo\n3. Registro', '1. Objetivo\n3. Registro');
check('uma remoção é contada', removeu.resumo.remocoes === 1, JSON.stringify(removeu.resumo));
check('remoção guarda o texto antigo', removeu.trechos[0]?.antes === '2. Prazo', removeu.trechos[0]?.antes);

/* 5) parágrafo alterado — marca só as palavras que mudaram */
const alterou = diffTexto(
  'O almoxarife confere a nota fiscal.',
  'O almoxarife confere a nota fiscal e o romaneio.'
);
const trecho = alterou.trechos[0];
check('alteração é classificada como mod', trecho?.tipo === 'mod', trecho?.tipo);
check('alteração conta como 1', alterou.resumo.alteracoes === 1, JSON.stringify(alterou.resumo));
const marcadasAntes = trecho?.palavras.antes.filter((p) => p.mudou).map((p) => p.t.trim()).join(' ');
const marcadasDepois = trecho?.palavras.depois.filter((p) => p.mudou).map((p) => p.t.trim()).join(' ');
check('nada marcado do lado antigo (só acrescentou)', marcadasAntes === '', JSON.stringify(marcadasAntes));
check(
  'palavras novas marcadas do lado corrigido',
  /nota fiscal e o romaneio/.test(marcadasDepois) || /e o romaneio/.test(marcadasDepois),
  JSON.stringify(marcadasDepois)
);
check(
  'texto não marcado preservado',
  trecho?.palavras.depois.some((p) => !p.mudou && p.t.includes('almoxarife')),
  JSON.stringify(trecho?.palavras.depois)
);

/* 6) troca de palavra: marca nos dois lados */
const trocou = diffPalavras('O almoxarife confere o pedido.', 'O encarregado confere o pedido.');
check(
  'troca de palavra marca o texto que saiu',
  trocou.antes.some((p) => p.mudou && p.t.includes('almoxarife')),
  JSON.stringify(trocou.antes)
);
check(
  'troca de palavra marca o texto que entrou',
  trocou.depois.some((p) => p.mudou && p.t.includes('encarregado')),
  JSON.stringify(trocou.depois)
);
check(
  'o resto do parágrafo continua igual',
  trocou.depois.some((p) => !p.mudou && p.t.includes('confere o pedido')),
  JSON.stringify(trocou.depois)
);

/* 7) parágrafo totalmente diferente: vira remoção + adição */
const outro = diffTexto('Conferir a nota fiscal.', 'Treinamento anual da brigada de incêndio.');
const tipos = outro.trechos.map((item) => item.tipo).sort().join(',');
check('parágrafo sem relação vira remoção + adição', tipos === 'add,del', tipos);

/* 8) várias mudanças e resumo */
const misto = diffTexto(
  'Título\n1. Objetivo\nO almoxarife confere a nota fiscal.\n2. Prazo\nTres dias.\n3. Registro',
  'Título\n1. Objetivo\nO almoxarife confere a nota fiscal e o romaneio.\n2. Prazo\nUm dia util.\n3. Registro\n4. Anexos'
);
check('uma alteração de palavra contada', misto.resumo.alteracoes === 1, JSON.stringify(misto.resumo));
check('parágrafo reescrito vira remoção + adição', misto.resumo.remocoes === 1 && misto.resumo.adicoes === 2, JSON.stringify(misto.resumo));
check('resumo soma os trechos', misto.resumo.total === 4, String(misto.resumo.total));
check(
  'resumo em texto legível',
  /^4 trechos alterados · 2 adições · 1 remoção · 1 alteração$/.test(resumoEmTexto(misto.resumo)),
  resumoEmTexto(misto.resumo)
);
check(
  'trechos aparecem na ordem do documento',
  misto.trechos[0].contexto === '1. Objetivo' && misto.trechos.at(-1).depois === '4. Anexos',
  JSON.stringify(misto.trechos.map((t) => t.contexto))
);

/* 9) diferença só de espaçamento não conta */
const espacos = diffTexto('O almoxarife   confere a nota fiscal.', 'O almoxarife confere a nota fiscal.');
check('espaços a mais não geram trecho', espacos.resumo.total === 0, String(espacos.resumo.total));

/* 10) parágrafos repetidos (o alinhamento não embaralha a ordem) */
const repetidos = diffTexto('Item\nA\nA\nB', 'Item\nA\nB');
check('parágrafo repetido removido uma vez', repetidos.resumo.total === 1 && repetidos.resumo.remocoes === 1, JSON.stringify(repetidos.resumo));

/* 11) documento vazio nos dois lados */
const vazio = diffTexto('', '');
check('documentos vazios não quebram', vazio.resumo.total === 0 && vazio.resumo.parecenca === 1);

/* 12) texto grande (guarda de custo) */
const grandeA = Array.from({ length: 1200 }, (_, i) => `linha ${i} do documento`).join('\n');
const grandeB = grandeA.replace('linha 600 do documento', 'linha 600 alterada');
const grande = diffTexto(grandeA, grandeB);
check('texto grande ainda compara', grande.resumo.total === 1, JSON.stringify(grande.resumo));

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ncomparação de texto: TUDO OK');
process.exitCode = falhas ? 1 : 0;
