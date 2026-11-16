# Bibliotecas de terceiros usadas na prévia de documentos

Estes arquivos não fazem parte do código do SCAD: são bibliotecas com licença
permissiva, copiadas para cá (sem `npm install`, sem etapa de build) e baixadas
pelo navegador **somente quando alguém abre a prévia de um `.docx`**. O servidor
não usa nenhuma delas.

| arquivo | projeto | versão | licença |
|---|---|---|---|
| `jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT (ou GPLv3, à escolha) |
| `docx-preview.min.js` | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) | 0.3.6 | Apache-2.0 |

Origem dos arquivos:

- `https://unpkg.com/jszip@3.10.1/dist/jszip.min.js`
- `https://unpkg.com/docx-preview@0.3.6/dist/docx-preview.min.js`

Ambas permitem uso comercial e redistribuição; a Apache-2.0 pede apenas que o
aviso de licença seja mantido (o cabeçalho original está preservado dentro de
cada arquivo minimizado, e este documento registra a origem). Nenhuma das duas
envia dados para fora: todo o processamento acontece no navegador de quem está
olhando o documento.
