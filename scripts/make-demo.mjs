/**
 * Gera um processo de demonstração com PDFs sintéticos e verificações variadas.
 * Uso: node scripts/make-demo.mjs [baseUrl]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:4177';
const OUT = path.join(process.cwd(), '.demo-files');

function makePdf(title, lines = []) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  let body = `BT /F1 17 Tf 56 770 Td (${esc(title)}) Tj ET\n`;
  body += '0.6 w 56 752 m 539 752 l S\n';
  let y = 720;
  for (const line of lines) {
    body += `BT /F1 11 Tf 56 ${y} Td (${esc(line)}) Tj ET\n`;
    y -= 20;
  }
  body += `BT /F1 10 Tf 56 90 Td (Documento sintetico gerado para demonstracao do SCAD.) Tj ET\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const DOCS = [
  {
    name: 'contrato-014-2026.pdf',
    kind: 'pdf',
    body: ['Fornecedor: Alfa Insumos Ltda.', 'Objeto: fornecimento de materiais de escritorio', 'Vigencia: 01/03/2026 a 28/02/2027', 'Valor total: R$ 148.000,00'],
  },
  {
    name: 'contrato-027-2026.pdf',
    kind: 'pdf',
    body: ['Fornecedor: Beta Servicos Tecnicos', 'Objeto: manutencao preventiva', 'Vigencia: 01/09/2025 a 31/10/2026', 'Valor total: R$ 74.500,00'],
  },
  {
    name: 'termo-aditivo-03.pdf',
    kind: 'pdf',
    body: ['Contrato vinculado: 027/2026', 'Objeto: prorrogacao de prazo', 'Acrescimo: R$ 12.400,00', 'Assinatura: 14/10/2026'],
  },
  {
    name: 'proposta-comercial.pdf',
    kind: 'pdf',
    body: ['Proposta: 2026-118', 'Fornecedor: Gama Distribuidora', 'Condicao de pagamento: 30 dias', 'Validade: 60 dias'],
  },
  {
    name: 'anexo-tecnico.pdf',
    kind: 'pdf',
    body: ['Especificacao: paineis acusticos', 'Norma de referencia: NBR 10152', 'Quantidade: 240 unidades', 'Prazo de entrega: 45 dias'],
  },
  {
    name: 'certidao-negativa.pdf',
    kind: 'pdf',
    body: ['Certidao municipal negativa', 'Contribuinte: Alfa Insumos Ltda.', 'Emissao: 02/11/2026', 'Validade: 90 dias'],
  },
  {
    name: 'declaracao-fornecedor.pdf',
    kind: 'pdf',
    body: ['Declaracao de inexistencia de trabalho infantil', 'Fornecedor: Beta Servicos Tecnicos', 'CNPJ: 12.345.678/0001-90'],
  },
  {
    name: 'memoria-calculo.pdf',
    kind: 'pdf',
    body: ['Memoria de calculo - contrato 014/2026', 'Base: 148.000,00', 'Retencao tecnica: 5%'],
  },
  {
    name: 'ficha-cadastro.pdf',
    kind: 'pdf',
    body: ['Cadastro de fornecedor', 'Razao social: Delta Papeis', 'Situacao: em analise'],
  },
  {
    name: 'ata-reuniao.pdf',
    kind: 'pdf',
    body: ['Ata de reuniao de alinhamento', 'Data: 05/11/2026', 'Participantes: compras, juridico e fornecedor'],
  },
  {
    name: 'comprovante-endereco.png',
    kind: 'png',
  },
  {
    name: 'planilha-orcamento.csv',
    kind: 'csv',
    body: 'item;descricao;quantidade;valor\n1;Papel A4;200;34,90\n2;Toner;12;189,00\n3;Frete;1;210,00\n',
  },
];

const PROCESS = {
  name: 'Análise de fornecedores 2026',
  description: 'Conferência documental dos fornecedores homologados no ciclo 2026 — contratos, certidões e anexos técnicos.',
  criteria: [
    { label: 'Legibilidade e integridade' },
    { label: 'Vigência e data' },
    { label: 'Assinaturas e identificação' },
    { label: 'Consistência dos dados' },
  ],
};

async function api(method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${data?.error || ''}`);
  return data;
}

const NOTES = [
  ['contrato-014-2026.pdf', 'Legibilidade e integridade', 'nc', 'Cópia ilegível nas páginas 4 e 5; o texto não pôde ser conferido contra o original.'],
  ['contrato-014-2026.pdf', 'Assinaturas e identificação', 'obs', 'Assinatura da testemunha sem identificação de CPF.'],
  ['contrato-014-2026.pdf', 'Vigência e data', 'ok', ''],
  ['contrato-027-2026.pdf', 'Vigência e data', 'nc', 'Vigência encerrada em 31/10/2026, antes da data desta análise.'],
  ['contrato-027-2026.pdf', 'Legibilidade e integridade', 'ok', ''],
  ['termo-aditivo-03.pdf', 'Consistência dos dados', 'obs', 'Valor do aditivo diverge do contrato original: R$ 12.400,00 contra R$ 12.040,00.'],
  ['termo-aditivo-03.pdf', 'Assinaturas e identificação', 'nc', 'Termo sem assinatura do representante legal do fornecedor.'],
  ['proposta-comercial.pdf', 'Assinaturas e identificação', 'nc', 'Proposta sem assinatura do representante legal.'],
  ['proposta-comercial.pdf', 'Consistência dos dados', 'ok', ''],
  ['anexo-tecnico.pdf', 'Legibilidade e integridade', 'ok', ''],
  ['anexo-tecnico.pdf', 'Vigência e data', 'ok', ''],
  ['anexo-tecnico.pdf', 'Assinaturas e identificação', 'na', 'Anexo técnico não exige assinatura.'],
  ['anexo-tecnico.pdf', 'Consistência dos dados', 'ok', ''],
  ['certidao-negativa.pdf', 'Vigência e data', 'obs', 'Certidão vence em 12 dias — acompanhar renovação antes do encerramento.'],
  ['certidao-negativa.pdf', 'Legibilidade e integridade', 'ok', ''],
  ['declaracao-fornecedor.pdf', 'Legibilidade e integridade', 'ok', ''],
  ['declaracao-fornecedor.pdf', 'Vigência e data', 'ok', ''],
  ['declaracao-fornecedor.pdf', 'Assinaturas e identificação', 'ok', ''],
  ['declaracao-fornecedor.pdf', 'Consistência dos dados', 'ok', ''],
  ['comprovante-endereco.png', 'Legibilidade e integridade', 'ok', ''],
  ['planilha-orcamento.csv', 'Consistência dos dados', 'obs', 'Fórmula da aba “Resumo” ignora a linha de frete.'],
  ['memoria-calculo.pdf', 'Legibilidade e integridade', 'ok', ''],
  ['memoria-calculo.pdf', 'Vigência e data', 'ok', ''],
  ['ata-reuniao.pdf', 'Legibilidade e integridade', 'ok', ''],
];

async function ensurePng() {
  // PNG 1×1 cinza-claro: suficiente para testar imagem e miniatura
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  return png;
}

async function main() {
  let state = await api('GET', '/api/state');
  if (state.process) {
    console.log('Já existe um processo em', base, '— nada a fazer.');
    return;
  }

  await fs.mkdir(OUT, { recursive: true });
  await api('POST', '/api/process', PROCESS);

  for (const doc of DOCS) {
    let buffer;
    if (doc.kind === 'pdf') buffer = makePdf(doc.name.replace('.pdf', ''), doc.body);
    else if (doc.kind === 'png') buffer = await ensurePng();
    else buffer = Buffer.from(doc.body, 'utf8');
    await fs.writeFile(path.join(OUT, doc.name), buffer);
    const mime =
      doc.kind === 'pdf' ? 'application/pdf' : doc.kind === 'png' ? 'image/png' : 'text/csv';
    const res = await api('POST', '/api/documents', {
      name: doc.name,
      mime,
      size: buffer.length,
      data: buffer.toString('base64'),
    });
    state = res.state;
    console.log('  ↑', doc.name);
  }

  state = await api('GET', '/api/state');
  for (const [docName, criterionLabel, status, note] of NOTES) {
    const doc = state.documents.find((d) => d.name === docName);
    const criterion = state.criteria.find((c) => c.label === criterionLabel);
    const check = state.checks.find((c) => c.docId === doc?.id && c.criterionId === criterion?.id);
    if (!check) {
      console.warn('  ! não encontrado:', docName, criterionLabel);
      continue;
    }
    await api('PATCH', `/api/checks/${check.id}`, { status, note });
  }

  state = await api('GET', '/api/state');
  console.log(`\nDemo pronta: ${state.documents.length} documentos, ${state.checks.length} verificações.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
