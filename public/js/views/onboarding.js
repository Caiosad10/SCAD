import { esc } from '../ui.js';
import { icon } from '../icons.js';

export const PRESET_LIST = [
  {
    id: 'basico',
    name: 'Documental básico',
    desc: 'Legibilidade, vigência, assinatura e consistência.',
    items: ['Legibilidade do arquivo', 'Vigência e data', 'Assinatura e identificação', 'Consistência dos dados'],
  },
  {
    id: 'contratual',
    name: 'Contratual',
    desc: 'Partes, objeto, prazos, obrigações e assinaturas.',
    items: ['Partes e qualificação', 'Objeto e escopo', 'Prazos e vigência', 'Obrigações e multas', 'Assinaturas'],
  },
  {
    id: 'tecnico',
    name: 'Fiscal / técnico',
    desc: 'Requisito, evidência anexada e rastreabilidade.',
    items: ['Identificação do documento', 'Conformidade com o requisito', 'Evidência anexada', 'Rastreabilidade'],
  },
  {
    id: 'zero',
    name: 'Começar do zero',
    desc: 'Monte a lista de critérios manualmente.',
    items: [],
  },
];

export function chipsHtml(items) {
  return items
    .map(
      (label, index) =>
        `<span class="chip" data-label="${esc(label)}">` +
        `<b class="chip__num">${String(index + 1).padStart(2, '0')}</b>` +
        `<span>${esc(label)}</span>` +
        `<button type="button" data-action="chip-remove" aria-label="Remover critério ${esc(label)}">` +
        `${icon('close', 11)}</button></span>`
    )
    .join('');
}

export function renderOnboarding() {
  const presets = PRESET_LIST.map(
    (preset, index) =>
      `<label class="preset">` +
      `<input type="radio" name="preset" value="${preset.id}" ${index === 0 ? 'checked' : ''}>` +
      `<span class="preset__copy"><strong>${esc(preset.name)}</strong>` +
      `<span>${esc(preset.desc)}</span></span></label>`
  ).join('');

  return (
    `<section class="view view--onboard">` +
    `<div class="onboard">` +
    `<div class="onboard__intro">` +
    `<p class="eyebrow">Primeira coleção</p>` +
    `<h1 class="onboard__title">Antes de analisar, defina o que será verificado.</h1>` +
    `<p class="onboard__lead">O SCAD organiza a análise como um arquivo: coleções agrupam processos; cada processo tem seus critérios, documentos e verificações. Você retoma exatamente de onde parou.</p>` +
    `<ol class="steps">` +
    `<li><span>01</span><div><b>Importe os arquivos.</b> PDFs, imagens, planilhas ou documentos do Word — quantos precisar.</div></li>` +
    `<li><span>02</span><div><b>Verifique cada critério.</b> Conforme, não conforme ou observação.</div></li>` +
    `<li><span>03</span><div><b>Registre o apontamento.</b> A nota fica presa ao documento e ao critério, não a um caderno à parte.</div></li>` +
    `</ol>` +
    `</div>` +
    `<form class="card onboard__form" id="onboard-form" novalidate>` +
    `<h2 class="onboard__form-title">Abrir coleção e processo</h2>` +
    `<p class="onboard__form-sub">Dá para ajustar nomes, critérios e documentos depois, em Ajustes.</p>` +
    `<div class="field"><label for="collection-name">Coleção</label>` +
    `<input id="collection-name" name="collection" type="text" maxlength="120" autocomplete="off" ` +
    `placeholder="Ex.: ISO 9001:2015" value="ISO 9001:2015" required></div>` +
    `<div class="field"><label for="process-name">Processo</label>` +
    `<input id="process-name" name="name" type="text" maxlength="120" autocomplete="off" ` +
    `placeholder="Ex.: DC, POP, Organograma" required></div>` +
    `<div class="field"><label for="process-desc">Descrição <span class="field__optional">opcional</span></label>` +
    `<textarea id="process-desc" name="description" rows="2" maxlength="1000" ` +
    `placeholder="Escopo, período, responsável…"></textarea></div>` +
    `<div class="field"><span class="field-label">Modelo de critérios</span>` +
    `<div class="presets">${presets}</div></div>` +
    `<div class="field"><span class="field-label">Critérios do processo <span id="criteria-count" class="field__optional">4 critérios</span></span>` +
    `<div class="criteria-chips" id="criteria-chips">${chipsHtml(PRESET_LIST[0].items)}</div>` +
    `<div class="form-row">` +
    `<input id="criteria-input" type="text" maxlength="160" autocomplete="off" placeholder="Adicionar critério…" aria-label="Novo critério">` +
    `<button class="btn btn--secondary btn--sm" type="button" data-action="preset-add">${icon('plus', 15)} Adicionar</button>` +
    `</div></div>` +
    `<button class="btn btn--primary btn--block" type="submit" id="onboard-submit">${icon('analyze', 17)} Criar coleção e processo</button>` +
    `<p class="onboard__hint">${icon('info', 13)} Tudo fica neste computador. O iPad acessa pelo endereço da rede local.</p>` +
    `</form>` +
    `</div>` +
    `</section>`
  );
}
