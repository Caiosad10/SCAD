/**
 * Comparação de texto entre duas versões de um documento.
 *
 * É o "motor diff" da correção: recebe o texto da versão vigente e o da versão
 * corrigida e devolve a lista de trechos que foram adicionados, removidos ou
 * alterados, com as palavras exatas que mudaram dentro de cada trecho.
 *
 * Roda inteiro no navegador, sem biblioteca nenhuma: o texto das duas versões já
 * é lido no próprio cliente (ver preview.js) e nada é enviado para fora.
 *
 * Limites conhecidos: compara texto, não layout. Imagens, formato de tabela e
 * fonte ficam de fora; PDF digitalizado não tem texto para comparar.
 */

/** Acima disto o custo do alinhamento (O(n·m)) deixa de valer a pena. */
const LIMITE_BLOCOS = 4_000_000;
const LIMITE_PALAVRAS = 250_000;

/** Texto parecido o bastante para tratar como "o mesmo parágrafo, alterado". */
const PARECENCA_MINIMA = 0.34;

/** Quebra o texto em parágrafos comparáveis: sem linhas vazias nem espaços dobrados. */
export function blocosDeTexto(texto) {
  return String(texto || '')
    .split(/\r\n|\r|\n/)
    .map((linha) => linha.replace(/[\s\u00a0]+/g, ' ').trim())
    .filter((linha) => linha.length > 0);
}

/**
 * Alinhamento de duas listas por maior subsequência comum.
 * Devolve as operações em ordem: `=` igual, `-` só no antes, `+` só no depois.
 * `chave` decide quando dois itens contam como iguais (padrão: idênticos).
 */
function alinhar(a, b, chave = (item) => item) {
  const n = a.length;
  const m = b.length;
  const ops = [];
  if (!n || !m || n * m > LIMITE_BLOCOS) {
    for (const item of a) ops.push({ t: '-', a: item });
    for (const item of b) ops.push({ t: '+', b: item });
    return ops;
  }
  const largura = m + 1;
  const tabela = new Int32Array((n + 1) * largura);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabela[i * largura + j] =
        chave(a[i]) === chave(b[j])
          ? tabela[(i + 1) * largura + j + 1] + 1
          : Math.max(tabela[(i + 1) * largura + j], tabela[i * largura + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (chave(a[i]) === chave(b[j])) {
      ops.push({ t: '=', a: a[i], b: b[j] });
      i += 1;
      j += 1;
    } else if (tabela[(i + 1) * largura + j] >= tabela[i * largura + j + 1]) {
      ops.push({ t: '-', a: a[i] });
      i += 1;
    } else {
      ops.push({ t: '+', b: b[j] });
      j += 1;
    }
  }
  while (i < n) ops.push({ t: '-', a: a[i++] });
  while (j < m) ops.push({ t: '+', b: b[j++] });
  return ops;
}

/** Palavras e espaços, para marcar só o que mudou dentro de um parágrafo. */
function palavrasDe(texto) {
  return String(texto || '')
    .split(/(\s+)/)
    .filter((pedaco) => pedaco.length > 0);
}

/**
 * Chave de comparação de uma palavra: sem caixa e sem pontuação nas pontas,
 * para "fiscal." e "fiscal" contarem como a mesma palavra e a pontuação não
 * aparecer riscada sem motivo.
 */
function chavePalavra(palavra) {
  return String(palavra)
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function acrescentar(segmentos, texto, mudou) {
  const ultimo = segmentos[segmentos.length - 1];
  if (ultimo && ultimo.mudou === mudou) ultimo.t += texto;
  else segmentos.push({ t: texto, mudou });
  return segmentos;
}

/** Marca, palavra por palavra, o que saiu de `antes` e o que entrou em `depois`. */
export function diffPalavras(antes, depois) {
  const a = palavrasDe(antes);
  const b = palavrasDe(depois);
  if (!a.length || !b.length || a.length * b.length > LIMITE_PALAVRAS) {
    return {
      antes: a.length ? [{ t: String(antes), mudou: true }] : [],
      depois: b.length ? [{ t: String(depois), mudou: true }] : [],
    };
  }
  const ops = alinhar(a, b, chavePalavra);
  const segAntes = [];
  const segDepois = [];
  for (const op of ops) {
    if (op.t === '=') {
      acrescentar(segAntes, op.a, false);
      acrescentar(segDepois, op.b, false);
    } else if (op.t === '-') {
      acrescentar(segAntes, op.a, true);
    } else {
      acrescentar(segDepois, op.b, true);
    }
  }
  return { antes: segAntes, depois: segDepois };
}

/** Duas frases que quase não compartilham palavras são substituições, não edições. */
function parecenca(a, b) {
  const palavras = (texto) =>
    new Set(
      palavrasDe(texto)
        .map((pedaco) => pedaco.toLowerCase())
        .filter((pedaco) => /[\p{L}\p{N}]/u.test(pedaco))
    );
  const wa = palavras(a);
  const wb = palavras(b);
  if (!wa.size || !wb.size) return 0;
  let comuns = 0;
  for (const palavra of wa) if (wb.has(palavra)) comuns += 1;
  return comuns / (wa.size + wb.size - comuns);
}

/**
 * Compara os dois textos e devolve `{ resumo, trechos }`.
 *
 * Cada trecho tem `tipo` (`add`, `del` ou `mod`), o texto `antes`/`depois` e o
 * `contexto` (o parágrafo anterior igual, que serve de âncora para o leitor).
 */
export function diffTexto(antesTexto, depoisTexto) {
  const antes = blocosDeTexto(antesTexto);
  const depois = blocosDeTexto(depoisTexto);
  const ops = alinhar(antes, depois);
  const trechos = [];
  const iguais = ops.filter((op) => op.t === '=').length;
  let contexto = '';
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === '=') {
      contexto = ops[i].a;
      i += 1;
      continue;
    }
    const saiu = [];
    const entrou = [];
    while (i < ops.length && ops[i].t !== '=') {
      if (ops[i].t === '-') saiu.push(ops[i].a);
      else entrou.push(ops[i].b);
      i += 1;
    }
    const pares = Math.min(saiu.length, entrou.length);
    for (let k = 0; k < pares; k += 1) {
      if (parecenca(saiu[k], entrou[k]) >= PARECENCA_MINIMA) {
        trechos.push({
          tipo: 'mod',
          antes: saiu[k],
          depois: entrou[k],
          contexto,
          palavras: diffPalavras(saiu[k], entrou[k]),
        });
      } else {
        trechos.push({ tipo: 'del', antes: saiu[k], depois: null, contexto });
        trechos.push({ tipo: 'add', antes: null, depois: entrou[k], contexto });
      }
    }
    for (let k = pares; k < saiu.length; k += 1) {
      trechos.push({ tipo: 'del', antes: saiu[k], depois: null, contexto });
    }
    for (let k = pares; k < entrou.length; k += 1) {
      trechos.push({ tipo: 'add', antes: null, depois: entrou[k], contexto });
    }
  }
  const contar = (tipo) => trechos.filter((trecho) => trecho.tipo === tipo).length;
  const maior = Math.max(antes.length, depois.length);
  return {
    resumo: {
      total: trechos.length,
      adicoes: contar('add'),
      remocoes: contar('del'),
      alteracoes: contar('mod'),
      iguais,
      blocosAntes: antes.length,
      blocosDepois: depois.length,
      parecenca: maior ? iguais / maior : 1,
    },
    trechos,
  };
}

/** Resumo em uma linha, para o cabeçalho do painel. */
export function resumoEmTexto(resumo) {
  if (!resumo || !resumo.total) return 'nenhuma alteração de texto';
  const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
  const partes = [plural(resumo.total, 'trecho alterado', 'trechos alterados')];
  if (resumo.adicoes) partes.push(plural(resumo.adicoes, 'adição', 'adições'));
  if (resumo.remocoes) partes.push(plural(resumo.remocoes, 'remoção', 'remoções'));
  if (resumo.alteracoes) partes.push(plural(resumo.alteracoes, 'alteração', 'alterações'));
  return partes.join(' · ');
}
