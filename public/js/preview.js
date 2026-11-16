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
 * Monta a prévia dentro de `alvo` (um elemento já visível na gaveta).
 * Mostra um aviso de carregamento e troca por uma mensagem amigável se falhar.
 */
export async function montarPreviaDocx(alvo, url, { nome = 'documento' } = {}) {
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
    const dados = await resposta.arrayBuffer();
    if (!dados.byteLength) throw new Error('arquivo vazio');

    alvo.textContent = '';
    await lib.renderAsync(dados, alvo, alvo, OPCOES_DOCX);
    ajustarLargura(alvo);
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
export async function montarPreviaDoc(alvo, url, { nome = 'documento', nota = null } = {}) {
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
      alvo.textContent = '';
      alvo.classList.replace('preview-doc', 'preview-docx');
      await lib.renderAsync(dados, alvo, alvo, OPCOES_DOCX);
      ajustarLargura(alvo);
      setTimeout(() => ajustarLargura(alvo), 80);
      trocarNota(
        'Este arquivo tem extensão .doc, mas por dentro é um .docx — por isso a prévia completa funciona aqui.'
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
