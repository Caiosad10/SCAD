/**
 * Prévia de documentos do Word (.docx) direto no navegador.
 *
 * O arquivo original é lido pelo próprio navegador de quem está olhando: nada
 * é convertido no servidor, nada é instalado na máquina e nenhuma cópia extra
 * fica guardada. As bibliotecas de leitura (JSZip e docx-preview, ambas de
 * licença permissiva — ver public/vendor/LICENCIAS.md) só são baixadas quando
 * alguém abre o primeiro documento, e ficam em cache depois disso.
 */

import { esc } from './ui.js';
import { icon } from './icons.js';
import { extrairTextoDoc } from './doc-text.js';

const CAMINHOS = ['/vendor/jszip.min.js', '/vendor/docx-preview.min.js'];

const OPCOES_DOCX = {
  className: 'docx',
  inWrapper: true,
  ignoreWidth: true,
  ignoreHeight: true,
  breakPages: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  experimental: true,
};

let carregando = null;

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`não foi possível carregar ${src}`));
    document.head.append(tag);
  });
}

/** Baixa as bibliotecas uma única vez; uma falha permite tentar de novo. */
function bibliotecas() {
  if (!carregando) {
    carregando = CAMINHOS.reduce((fila, src) => fila.then(() => carregarScript(src)), Promise.resolve())
      .then(() => {
        if (!window.docx || typeof window.docx.renderAsync !== 'function') {
          throw new Error('biblioteca de leitura do .docx não respondeu');
        }
        return window.docx;
      })
      .catch((err) => {
        carregando = null;
        throw err;
      });
  }
  return carregando;
}

/** Só o formato novo do Word (.docx) é um pacote ZIP que o navegador consegue ler. */
export function suportaPreviaDocx(name = '') {
  return /\.docx$/i.test(String(name));
}

/** É o formato antigo do Word (97–2003), binário, que o navegador não abre. */
export function ehDocAntigo(name = '') {
  return /\.doc$/i.test(String(name));
}

function erroDeTexto(codigo, mensagem) {
  const err = new Error(mensagem);
  err.codigo = codigo;
  return err;
}

/** Parágrafos do `word/document.xml`, na ordem do documento e sem formatação. */
function textoDeDocumentXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw erroDeTexto('semTexto', 'o documento do Word está ilegível');
  }
  const linhas = [];
  for (const paragrafo of doc.getElementsByTagNameNS('*', 'p')) {
    // Caixas de texto e afins ficam dentro de outro parágrafo: só o de fora conta.
    let dentro = false;
    for (let pai = paragrafo.parentElement; pai; pai = pai.parentElement) {
      if (pai.localName === 'p') {
        dentro = true;
        break;
      }
    }
    if (dentro) continue;
    let texto = '';
    for (const no of paragrafo.getElementsByTagNameNS('*', '*')) {
      const nome = no.localName;
      if (nome === 't') texto += no.textContent;
      else if (nome === 'tab') texto += '\t';
      else if (nome === 'br' || nome === 'cr') texto += '\n';
    }
    linhas.push(texto);
  }
  return linhas.join('\n');
}

async function textoDeDocx(dados) {
  await bibliotecas();
  const zip = window.JSZip;
  if (!zip || typeof zip.loadAsync !== 'function') {
    throw erroDeTexto('semTexto', 'a leitura de .docx não carregou');
  }
  const pacote = await zip.loadAsync(dados);
  const documento = pacote.file('word/document.xml');
  if (!documento) throw erroDeTexto('semTexto', 'o pacote do .docx não tem o documento');
  return textoDeDocumentXml(await documento.async('string'));
}

/**
 * Texto puro de um arquivo armazenado, para comparar duas versões.
 *
 * Aceita os mesmos formatos da prévia (.docx e .doc). Formatos sem texto legível
 * (PDF digitalizado, imagem) lançam erro com `codigo = 'semTexto'`.
 */
export async function textoDoArquivo(name, url) {
  const resposta = await fetch(url, { credentials: 'same-origin' });
  if (!resposta.ok) throw new Error(`o servidor respondeu ${resposta.status}`);
  const dados = await resposta.arrayBuffer();
  if (!dados.byteLength) throw new Error('arquivo vazio');
  if (suportaPreviaDocx(name)) return textoDeDocx(dados);
  if (ehDocAntigo(name)) {
    try {
      return extrairTextoDoc(dados).texto;
    } catch (err) {
      if (err.codigo !== 'docx') throw err;
      return textoDeDocx(dados);
    }
  }
  throw erroDeTexto('semTexto', `${name} é um formato sem texto comparável`);
}

function aviso(iconName, texto) {
  const caixa = document.createElement('div');
  caixa.className = 'preview-fallback';
  caixa.innerHTML = `${icon(iconName, 22)}<p>${esc(texto)}</p>`;
  return caixa;
}

/**
 * A página é desenhada na largura real do papel (A4 ≈ 794 px). Em tela estreita
 * isso obrigaria a rolar de lado, então reduzimos a página para caber na gaveta —
 * o texto continua legível e ninguém precisa arrastar para os lados.
 */
function ajustarLargura(area) {
  const moldura = area.querySelector('.docx-wrapper');
  const pagina = moldura?.querySelector('section.docx');
  if (!moldura || !pagina) return;
  moldura.style.zoom = '';
  const disponivel = area.clientWidth - 28; // 14 px de respiro de cada lado
  const largura = pagina.getBoundingClientRect().width;
  if (disponivel > 120 && largura > disponivel) {
    moldura.style.zoom = String(Math.max(0.25, disponivel / largura));
  }
}

/**
 * Conta, dentro do pacote .docx, os desenhos que o navegador não abre.
 *
 * Acontece de verdade com fluxograma colado do Visio: o Word guarda o desenho
 * como EMF/WMF (formato vetorial só do Windows). O servidor sabe converter em
 * PNG (ver `pedirPreviaConvertida`); esta leitura é o que decide se vale pedir.
 */
async function lerDesenhos(dados) {
  try {
    const zip = window.JSZip;
    if (!zip || typeof zip.loadAsync !== 'function') return { presas: [], visio: false };
    const pacote = await zip.loadAsync(dados);
    const nomes = Object.keys(pacote.files || {});
    return {
      presas: nomes.filter((nome) => /^word\/media\/[^/]+\.(emf|wmf)$/i.test(nome)),
      visio: nomes.some((nome) => /^word\/embeddings\/[^/]+\.vsdx?$/i.test(nome)),
    };
  } catch {
    return { presas: [], visio: false };
  }
}

/** Pede ao servidor a cópia do .docx com os desenhos já em PNG. */
async function pedirPreviaConvertida(stored) {
  try {
    const resposta = await fetch('/api/preview/derive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ stored }),
    });
    if (!resposta.ok) return null;
    return await resposta.json();
  } catch {
    return null;
  }
}

/**
 * Avisa sobre figuras que continuaram sem desenho.
 *
 * Caminho de exceção: quando a conversão não foi possível (servidor fora do
 * Windows, PowerShell bloqueado, formato desconhecido). Em vez de deixar um
 * espaço vazio — que parece documento quebrado — o aviso entra no topo, com o
 * caminho para abrir o arquivo original.
 */
async function avisarFigurasQueNaoDesenham(alvo, url, desenhos) {
  const presas = desenhos?.presas || [];

  // Imagem que o desenho tentou mostrar e o navegador não abriu (outros formatos).
  const figuras = [...alvo.querySelectorAll('img')];
  if (figuras.length) {
    await Promise.all(
      figuras.map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete) return resolve();
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 1200);
          })
      )
    );
  }
  const quebradas = figuras.filter((img) => img.isConnected && img.naturalWidth === 0);

  if (!presas.length && !quebradas.length) return;

  const total = presas.length + quebradas.length;
  const caixa = document.createElement('div');
  caixa.className = 'preview-nao-desenha';
  caixa.innerHTML =
    `${icon('file', 18)}<p><b>${
      total === 1 ? 'Uma figura deste documento não aparece nesta prévia.' : `${total} figuras deste documento não aparecem nesta prévia.`
    }</b> Abra o arquivo para ${total === 1 ? 'ver a figura' : 'ver as figuras'}.</p>` +
    `<a class="btn btn--ghost btn--sm" href="${url}" target="_blank" rel="noopener">Abrir o arquivo</a>`;
  alvo.prepend(caixa);

  // Se o desenho chegou a virar <img> e não abriu, o aviso entra no lugar dele.
  for (const img of quebradas) img.replaceWith(caixa.cloneNode(true));
}

/**
 * Devolve o pacote que a prévia deve desenhar, trocando-o pela cópia com os
 * desenhos do Visio em PNG quando o servidor conseguir converter.
 */
async function prepararDesenhos(dados, stored, aoEsperar) {
  const desenhos = await lerDesenhos(dados);
  if (!desenhos.presas.length || !stored) return { dados, convertida: false, desenhos };
  aoEsperar?.('Convertendo a figura…');
  const previa = await pedirPreviaConvertida(stored);
  if (!previa?.url) return { dados, convertida: false, desenhos };
  const pronta = await fetch(previa.url, { credentials: 'same-origin' });
  if (!pronta.ok) return { dados, convertida: false, desenhos };
  const bytes = await pronta.arrayBuffer();
  if (!bytes.byteLength) return { dados, convertida: false, desenhos };
  return { dados: bytes, convertida: true, desenhos };
}

/** Nota do fim da prévia depois de desenhar o documento. */
async function finalizarDesenhos(alvo, url, desenhos, convertida) {
  if (convertida) {
    // A figura convertida fala por si: sem nota de rodapé. Mas se alguma imagem
    // ainda não abriu no navegador, o aviso entra no lugar — nunca caixa vazia.
    await avisarFigurasQueNaoDesenham(alvo, url, { presas: [] });
    return;
  }
  await avisarFigurasQueNaoDesenham(alvo, url, desenhos);
}

export async function montarPreviaDocx(alvo, url, { nome = 'documento', stored = '' } = {}) {
  const espera = document.createElement('p');
  espera.className = 'preview-loading';
  espera.textContent = 'Montando a prévia do documento…';
  alvo.append(espera);

  try {
    const [lib, resposta] = await Promise.all([
      bibliotecas(),
      fetch(url, { credentials: 'same-origin' }),
    ]);
    if (!resposta.ok) throw new Error(`o servidor respondeu ${resposta.status}`);
    const baixado = await resposta.arrayBuffer();
    if (!baixado.byteLength) throw new Error('arquivo vazio');

    const { dados, convertida, desenhos } = await prepararDesenhos(baixado, stored, (texto) => {
      espera.textContent = texto;
    });

    alvo.textContent = '';
    await lib.renderAsync(dados, alvo, alvo, OPCOES_DOCX);
    ajustarLargura(alvo);
    await finalizarDesenhos(alvo, url, desenhos, convertida);
    // imagens e fontes chegam depois e podem mudar a largura da página
    setTimeout(() => ajustarLargura(alvo), 80);
    const aoRedimensionar = () => {
      if (!alvo.isConnected) {
        window.removeEventListener('resize', aoRedimensionar);
        return;
      }
      ajustarLargura(alvo);
    };
    window.addEventListener('resize', aoRedimensionar);
  } catch (err) {
    alvo.textContent = '';
    alvo.append(
      aviso(
        'file',
        `Não foi possível montar a prévia de ${nome} (${err.message}). ` +
          'O arquivo continua disponível para abrir em nova aba ou baixar.'
      )
    );
  }
}

/**
 * Prévia do formato antigo do Word (.doc).
 *
 * O .doc é um contêiner binário que o navegador não desenha, então lemos o
 * texto dele aqui mesmo (`doc-text.js`) e mostramos numa folha branca. Vem o
 * texto completo, com parágrafos, mas sem layout: imagens, tabelas no formato
 * original, cabeçalho e rodapé viram linhas de texto no lugar em que estão no
 * arquivo.
 *
 * Caso especial que existe de verdade: arquivo com extensão .doc que por dentro
 * é um .docx. Nesse caso a prévia completa (a mesma dos .docx) é montada.
 */
export async function montarPreviaDoc(alvo, url, { nome = 'documento', nota = null, stored = '' } = {}) {
  const espera = document.createElement('p');
  espera.className = 'preview-loading';
  espera.textContent = 'Lendo o texto do documento…';
  alvo.append(espera);

  const trocarNota = (texto) => {
    if (!nota) return;
    nota.textContent = texto;
    nota.hidden = !texto;
  };

  try {
    const resposta = await fetch(url, { credentials: 'same-origin' });
    if (!resposta.ok) throw new Error(`o servidor respondeu ${resposta.status}`);
    const dados = await resposta.arrayBuffer();
    if (!dados.byteLength) throw new Error('arquivo vazio');

    let texto;
    try {
      texto = extrairTextoDoc(dados).texto;
    } catch (err) {
      if (err.codigo !== 'docx') throw err;
      // O arquivo é um .docx com nome antigo: vale a prévia completa.
      const lib = await bibliotecas();
      const { dados: prontos, convertida, desenhos } = await prepararDesenhos(dados, stored, (texto) => {
        espera.textContent = texto;
      });
      alvo.textContent = '';
      alvo.classList.replace('preview-doc', 'preview-docx');
      await lib.renderAsync(prontos, alvo, alvo, OPCOES_DOCX);
      ajustarLargura(alvo);
      await finalizarDesenhos(alvo, url, desenhos, convertida);
      setTimeout(() => ajustarLargura(alvo), 80);
      trocarNota(
        'Este arquivo é um .docx com extensão antiga.'
      );
      return;
    }

    alvo.textContent = '';
    const folha = document.createElement('div');
    folha.className = 'doc-text__sheet';
    folha.textContent = texto;
    alvo.append(folha);
  } catch (err) {
    alvo.textContent = '';
    const motivo =
      err.codigo === 'senha'
        ? 'Este documento está protegido por senha, então não dá para ler o texto aqui.'
        : err.codigo === 'semTexto'
          ? 'Este documento não tem texto (deve ser só imagem digitalizada).'
          : `Não foi possível ler o texto de ${nome} (${err.message}).`;
    alvo.append(
      aviso('file', `${motivo} O arquivo continua disponível para abrir em nova aba ou baixar.`)
    );
    trocarNota('');
  }
}
