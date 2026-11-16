/**
 * Leitor de texto de documentos Word 97–2003 (.doc).
 *
 * Um .doc não é ZIP: é um contêiner OLE/CFB (o mesmo formato de "pasta
 * composta" que o Windows usa para vários programas) e, dentro dele, o texto
 * mora num fluxo chamado `WordDocument`, apontado por uma tabela de trechos no
 * fluxo `1Table` (ou `0Table`). Este módulo lê só o essencial: o contêiner, o
 * cabeçalho (FIB) e a tabela de trechos.
 *
 * O que se ganha: o texto do documento, na ordem certa, com parágrafos.
 * O que se perde: formatação, imagens, tabelas (as células viram quebras de
 * linha) e cabeçalhos/rodapés. É a prévia "em texto".
 *
 * Sem dependências: usa só DataView e TextDecoder, então roda no navegador
 * (que é onde ele é usado) e também no Node, para os testes.
 */

const ASSINATURA_CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ASSINATURA_ZIP = [0x50, 0x4b, 0x03, 0x04]; // um .docx renomeado
const FIM_SETOR = 0xfffffffe;
const SETOR_LIVRE = 0xffffffff;

/** Tabela CP1252 para quando o navegador não tiver o decodificador. */
const CP1252 = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

class ErroDoc extends Error {
  constructor(mensagem, codigo = 'formato') {
    super(mensagem);
    this.codigo = codigo;
  }
}

const bytes = (entrada) => {
  if (entrada instanceof Uint8Array) return entrada;
  if (entrada instanceof ArrayBuffer) return new Uint8Array(entrada);
  if (entrada?.buffer instanceof ArrayBuffer) {
    return new Uint8Array(entrada.buffer, entrada.byteOffset, entrada.byteLength);
  }
  throw new ErroDoc('conteúdo do arquivo não reconhecido');
};

const lerU16 = (d, o) => d.getUint16(o, true);
const lerU32 = (d, o) => d.getUint32(o, true);

/** Divide o arquivo em setores de 2^n e segue a cadeia da FAT. */
function criarLeitorSetores(dv, dados, tamSetor, fat, inicioMini) {
  const cadeia = (inicio) => {
    const pedacos = [];
    const vistos = new Set();
    let atual = inicio;
    while (atual !== FIM_SETOR && atual !== SETOR_LIVRE && !vistos.has(atual)) {
      vistos.add(atual);
      const de = (atual + 1) * tamSetor;
      pedacos.push(dados.subarray(de, de + tamSetor));
      atual = fat[atual];
    }
    return pedacos;
  };

  return {
    /** Concatena os setores de um fluxo (sem copiar mais do que o necessário). */
    lerFluxo(entrada) {
      const pedacos = cadeia(entrada.inicio);
      const total = entrada.tamanho;
      const saida = new Uint8Array(total);
      let escrito = 0;
      for (const pedaco of pedacos) {
        if (escrito >= total) break;
        const quanto = Math.min(pedaco.length, total - escrito);
        saida.set(pedaco.subarray(0, quanto), escrito);
        escrito += quanto;
      }
      return saida;
    },
    lerCadeiaBruta(inicio) {
      return cadeia(inicio);
    },
    inicioMini,
  };
}

/**
 * Monta a lista de setores da FAT.
 *
 * Cuidado com a pegadinha do formato: os 109 números do cabeçalho **não são a
 * FAT**, são os números dos *setores* onde a FAT está gravada. Depois de ler
 * esses setores é que se tem, de fato, a tabela (128 entradas de 4 bytes por
 * setor de 512).
 */
function montarFat(dv, dados, tamSetor) {
  const setoresFat = [];
  const anotar = (setor) => {
    if (setor !== FIM_SETOR && setor !== SETOR_LIVRE) setoresFat.push(setor);
  };
  for (let i = 0; i < 109; i += 1) anotar(lerU32(dv, 76 + i * 4));

  let setorDifat = lerU32(dv, 68);
  const qtdDifat = lerU32(dv, 72);
  const porSetor = tamSetor / 4 - 1;
  for (let n = 0; n < qtdDifat && setorDifat !== FIM_SETOR && setorDifat !== SETOR_LIVRE; n += 1) {
    const base = (setorDifat + 1) * tamSetor;
    for (let i = 0; i < porSetor; i += 1) anotar(lerU32(dv, base + i * 4));
    setorDifat = lerU32(dv, base + tamSetor - 4);
  }

  const fat = [];
  for (const setor of setoresFat) {
    const base = (setor + 1) * tamSetor;
    if (base + tamSetor > dados.length) continue;
    for (let o = 0; o < tamSetor; o += 4) fat.push(lerU32(dv, base + o));
  }
  return fat;
}

/** Lê o diretório do contêiner (nome, tipo, setor inicial, tamanho). */
function lerDiretorio(dv, dados, tamSetor, fat, inicioDir) {
  const entradas = [];
  const lerCadeia = (inicio) => {
    const pedacos = [];
    const vistos = new Set();
    let atual = inicio;
    while (atual !== FIM_SETOR && atual !== SETOR_LIVRE && !vistos.has(atual)) {
      vistos.add(atual);
      const de = (atual + 1) * tamSetor;
      pedacos.push(dados.subarray(de, de + tamSetor));
      atual = fat[atual];
    }
    return pedacos;
  };
  for (const pedaco of lerCadeia(inicioDir)) {
    const bloco = new DataView(pedaco.buffer, pedaco.byteOffset, pedaco.byteLength);
    for (let o = 0; o + 128 <= pedaco.length; o += 128) {
      const tamNome = lerU16(bloco, o + 64);
      if (tamNome < 2 || tamNome > 64) continue;
      const tipo = pedaco[o + 66];
      if (tipo !== 1 && tipo !== 2 && tipo !== 5) continue;
      let nome = '';
      for (let i = 0; i < tamNome - 2; i += 2) nome += String.fromCharCode(lerU16(bloco, o + i));
      entradas.push({
        nome,
        tipo,
        inicio: lerU32(bloco, o + 116),
        tamanho: lerU32(bloco, o + 120),
      });
    }
  }
  return entradas;
}

/**
 * Lê os fluxos pequenos: no OLE, arquivo abaixo de 4096 bytes fica dentro de um
 * "mini fluxo" (blocos de 64 bytes) apontado pela mini FAT.
 */
function lerMiniFluxo(dados, miniInicio, tamMini, miniFat, entrada, totalMini) {
  const pedacos = [];
  const vistos = new Set();
  let atual = entrada.inicio;
  while (atual !== FIM_SETOR && atual !== SETOR_LIVRE && !vistos.has(atual)) {
    vistos.add(atual);
    const de = miniInicio + atual * tamMini;
    pedacos.push(dados.subarray(de, de + tamMini));
    atual = miniFat[atual];
  }
  const saida = new Uint8Array(entrada.tamanho || totalMini);
  let escrito = 0;
  for (const pedaco of pedacos) {
    if (escrito >= saida.length) break;
    const quanto = Math.min(pedaco.length, saida.length - escrito);
    saida.set(pedaco.subarray(0, quanto), escrito);
    escrito += quanto;
  }
  return saida;
}

/** Texto de CP1252 (ou do decodificador do navegador, quando existir). */
function decodificar1252(bloco) {
  try {
    return new TextDecoder('windows-1252').decode(bloco);
  } catch {
    let saida = '';
    for (const b of bloco) saida += String.fromCharCode(CP1252[b] || b);
    return saida;
  }
}

/**
 * Limpa os caracteres de controle do Word:
 *  - 0x0D/0x0A = fim de parágrafo;  0x07 = fim de célula/linha de tabela
 *  - 0x0B = quebra de linha;        0x0C = quebra de página
 *  - 0x13/0x14/0x15 = campo (índice, sumário, data automática): o texto entre
 *    0x13 e 0x14 é a "receita" do campo e não aparece no documento, então sai.
 */
function limparTexto(bruto) {
  let saida = '';
  let dentroDeCampo = false;
  for (const caractere of bruto) {
    const codigo = caractere.charCodeAt(0);
    if (codigo === 0x13) {
      dentroDeCampo = true;
      continue;
    }
    if (codigo === 0x14) {
      dentroDeCampo = false;
      continue;
    }
    if (codigo === 0x15) {
      dentroDeCampo = false;
      continue;
    }
    if (dentroDeCampo) continue;
    if (codigo === 0x0d || codigo === 0x0a || codigo === 0x07) saida += '\n';
    else if (codigo === 0x0b) saida += '\n';
    else if (codigo === 0x0c) saida += '\n\n';
    else if (codigo === 0x09) saida += '\t';
    else if (codigo === 0x1e) saida += '-';
    else if (codigo === 0x1f || codigo === 0x05 || codigo === 0x00) continue;
    else if (codigo === 0xa0) saida += ' ';
    else if (codigo < 0x20 && codigo !== 0x02) continue;
    else saida += caractere;
  }
  return saida;
}

/** Deixa o texto apresentável: sem espaços sobrando, sem vazio no fim. */
function arrumarTexto(texto) {
  const linhas = texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  return linhas;
}

/** Último recurso: texto "cru" entre fcMin e fcMac, quando a tabela falha. */
function textoDeEmergencia(fluxoWord, dv) {
  const fcMin = lerU32(dv, 24);
  const fcMac = lerU32(dv, 28);
  const fim = Math.min(fluxoWord.length, fcMac || fluxoWord.length);
  const bloco = fluxoWord.subarray(Math.min(fcMin, fim), fim);
  let saida = '';
  for (let i = 0; i < bloco.length; i += 1) {
    const b = bloco[i];
    if (b === 0) {
      if (i + 1 < bloco.length && bloco[i + 1] === 0) i += 1;
      continue;
    }
    if (b >= 0x20 || b === 0x0d || b === 0x0a || b === 0x09 || b === 0x07) {
      saida += String.fromCharCode(CP1252[b] || b);
    }
  }
  return arrumarTexto(limparTexto(saida));
}

/**
 * Extrai o texto de um .doc.
 *
 * @param {ArrayBuffer|Uint8Array} entrada conteúdo do arquivo
 * @returns {{texto: string, paragrafos: string[], aviso?: string}}
 * @throws {Error} com mensagem em português quando não dá para ler
 */
export function extrairTextoDoc(entrada) {
  const dados = bytes(entrada);
  if (dados.length < 512) throw new ErroDoc('arquivo pequeno demais para ser um .doc');
  const primeiros = [...dados.subarray(0, 8)];

  if (ASSINATURA_ZIP.every((b, i) => primeiros[i] === b)) {
    throw new ErroDoc('este arquivo é um .docx (basta renomear para .docx e a prévia completa funciona)', 'docx');
  }
  if (!ASSINATURA_CFB.every((b, i) => primeiros[i] === b)) {
    throw new ErroDoc('o arquivo não está no formato antigo do Word (ou está danificado)');
  }

  const dv = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  const tamSetor = 1 << lerU16(dv, 30);
  const tamMini = 1 << lerU16(dv, 32);
  if (tamSetor !== 512 && tamSetor !== 4096) throw new ErroDoc('setor do contêiner não reconhecido');

  const fat = montarFat(dv, dados, tamSetor);
  const leitor = criarLeitorSetores(dv, dados, tamSetor, fat, lerU32(dv, 60));
  const diretorio = lerDiretorio(dv, dados, tamSetor, fat, lerU32(dv, 48));

  const raiz = diretorio.find((e) => e.tipo === 5);
  const achado = (nome) => diretorio.find((e) => e.tipo === 2 && e.nome === nome);

  const wordDoc = achado('WordDocument');
  if (!wordDoc) {
    throw new ErroDoc('este arquivo não tem texto do Word dentro (pode ser outro tipo de documento com extensão .doc)');
  }

  const lerFluxo = (entradaFluxo) => {
    if (entradaFluxo.tamanho >= 4096 || !raiz) return leitor.lerFluxo(entradaFluxo);
    // fluxo pequeno: vive no mini fluxo
    const miniFat = (() => {
      const pedacos = leitor.lerCadeiaBruta(lerU32(dv, 60));
      const lista = [];
      for (const pedaco of pedacos) {
        const bloco = new DataView(pedaco.buffer, pedaco.byteOffset, pedaco.byteLength);
        for (let o = 0; o + 4 <= pedaco.length; o += 4) lista.push(lerU32(bloco, o));
      }
      return lista;
    })();
    const miniStream = leitor.lerFluxo(raiz);
    return lerMiniFluxo(miniStream, 0, tamMini, miniFat, entradaFluxo, raiz.tamanho);
  };

  const word = lerFluxo(wordDoc);
  const wdv = new DataView(word.buffer, word.byteOffset, word.byteLength);

  if (lerU16(wdv, 0) !== 0xa5ec) throw new ErroDoc('o texto deste .doc não está no formato esperado');
  const flags = lerU16(wdv, 10);
  if (flags & 0x0100) throw new ErroDoc('documento protegido por senha', 'senha');
  const usa1Table = (flags & 0x0200) !== 0;

  const tabela = lerFluxo(achado(usa1Table ? '1Table' : '0Table') || { inicio: 0, tamanho: 0 });
  if (!tabela.length) return { texto: textoDeEmergencia(word, wdv), paragrafos: [], aviso: 'leitura simplificada' };

  const tdv = new DataView(tabela.buffer, tabela.byteOffset, tabela.byteLength);
  const fcClx = lerU32(wdv, 0x01a2);
  const lcbClx = lerU32(wdv, 0x01a6);
  if (!fcClx || !lcbClx || fcClx + lcbClx > tabela.length) {
    return { texto: textoDeEmergencia(word, wdv), paragrafos: [], aviso: 'leitura simplificada' };
  }

  // CLX: pode ter blocos de propriedades (0x01) antes da tabela de trechos (0x02)
  let o = fcClx;
  while (o < fcClx + lcbClx && tabela[o] === 0x01) {
    const cb = lerU16(tdv, o + 1);
    o += 3 + cb;
  }
  if (tabela[o] !== 0x02) {
    return { texto: textoDeEmergencia(word, wdv), paragrafos: [], aviso: 'leitura simplificada' };
  }
  const lcbPcd = lerU32(tdv, o + 1);
  const inicioPlc = o + 5;
  const trechos = Math.floor((lcbPcd - 4) / 12);
  if (trechos <= 0 || inicioPlc + lcbPcd > tabela.length) {
    return { texto: textoDeEmergencia(word, wdv), paragrafos: [], aviso: 'leitura simplificada' };
  }

  let texto = '';
  for (let i = 0; i < trechos; i += 1) {
    const cpInicio = lerU32(tdv, inicioPlc + i * 4);
    const cpFim = lerU32(tdv, inicioPlc + (i + 1) * 4);
    const pcd = inicioPlc + (trechos + 1) * 4 + i * 8;
    const fcCru = lerU32(tdv, pcd + 2);
    const caracteres = cpFim - cpInicio;
    if (caracteres <= 0) continue;
    if (fcCru & 0x40000000) {
      // trecho comprimido: um byte por caractere, em CP1252
      const de = (fcCru & 0x3fffffff) >> 1;
      const bloco = word.subarray(de, de + caracteres);
      texto += decodificar1252(bloco);
    } else {
      const de = fcCru;
      const bloco = word.subarray(de, de + caracteres * 2);
      texto += new TextDecoder('utf-16le').decode(bloco);
    }
  }

  const ccpTexto = word.length > 0x50 ? lerU32(wdv, 0x004c) : 0;
  const limpo = arrumarTexto(limparTexto(texto));
  if (!limpo.trim()) throw new ErroDoc('o documento não tem texto (só imagens ou conteúdo digitalizado)', 'semTexto');
  return {
    texto: limpo,
    paragrafos: limpo.split('\n'),
    caracteresTotais: ccpTexto,
    aviso: (flags & 0x0004) !== 0 ? 'documento com edições rápidas' : undefined,
  };
}
