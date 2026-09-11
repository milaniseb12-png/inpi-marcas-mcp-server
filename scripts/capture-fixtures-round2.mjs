#!/usr/bin/env node
/**
 * Segunda rodada de captura, só pros 4 casos que a primeira varredura (candidatos GOOGLE,
 * 15 primeiros) não achou: extinto/arquivado, sem representante legal, pedido em andamento
 * sem concessão, e registro vigente com logo (marca mista). Varre mais candidatos e mais
 * termos de busca. Ver scripts/capture-fixtures.mjs pro resto do corpus.
 */
import { PepiClient } from "../dist/client.js";
import { parseSearchResults, parseProcessDetail } from "../dist/parsers.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "test", "fixtures");

const client = new PepiClient(process.env.INPI_USERNAME, process.env.INPI_PASSWORD);

function save(name, html, expected) {
  const dir = path.join(FIXTURES_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "raw.html"), html, "utf-8");
  fs.writeFileSync(path.join(dir, "expected.json"), JSON.stringify(expected, null, 2) + "\n", "utf-8");
  console.log(`salvo: ${name} (${html.length} bytes html)`);
}

async function detailOf(codPedido) {
  return client.getMarcas({ Action: "detail", CodPedido: codPedido });
}
async function basicSearch(marca, exata, perPage) {
  return client.postMarcas({
    buscaExata: exata ? "sim" : "nao", txt: "", marca, classeInter: "",
    registerPerPage: perPage, botao: "", Action: "searchMarca", tipoPesquisa: "BY_MARCA_CLASSIF_BASICA",
  });
}

let achouExtintoArquivado = fs.existsSync(path.join(FIXTURES_DIR, "detalhe_extinto_ou_arquivado"));
let achouSemRepresentante = fs.existsSync(path.join(FIXTURES_DIR, "detalhe_sem_representante_legal"));
let achouEmAndamento = fs.existsSync(path.join(FIXTURES_DIR, "detalhe_pedido_em_andamento_sem_concessao"));
let achouVigenteLogo = fs.existsSync(path.join(FIXTURES_DIR, "detalhe_registro_vigente_com_logo"));

const termos = ["GOOGLE", "MICROSOFT", "APPLE", "TESLA", "SAMSUNG", "NIKE"];

for (const termo of termos) {
  if (achouExtintoArquivado && achouSemRepresentante && achouEmAndamento) break;
  const html = await basicSearch(termo, true, "100");
  const r = parseSearchResults(html);
  const rows = r.resultados.filter((x) => x.codPedido);
  console.log(`\n${termo}: ${rows.length} linhas com codPedido.`);

  for (const row of rows) {
    if (achouExtintoArquivado && achouSemRepresentante && achouEmAndamento) break;
    const detailHtml = await detailOf(row.codPedido);
    const d = parseProcessDetail(detailHtml);
    if (!d.numeroProcesso) continue;

    if (!achouExtintoArquivado && (d.situacaoOperacional === "registro_extinto" || d.situacaoOperacional === "pedido_arquivado")) {
      save("detalhe_extinto_ou_arquivado", detailHtml, {
        guarda: "processo não mais ativo — situacaoOperacional classifica corretamente extinto/arquivado",
        numeroProcesso: d.numeroProcesso, situacao: d.situacao, situacaoOperacional: d.situacaoOperacional,
      });
      achouExtintoArquivado = true;
    }
    if (!achouSemRepresentante && !d.procurador && d.titulares.length > 0) {
      save("detalhe_sem_representante_legal", detailHtml, {
        guarda: "processo sem seção 'Representante Legal' — directRows() precisa não quebrar com seção ausente",
        numeroProcesso: d.numeroProcesso, procurador: d.procurador,
      });
      achouSemRepresentante = true;
    }
    if (!achouEmAndamento && d.situacaoOperacional === "pedido_em_andamento" && !d.dataConcessao) {
      save("detalhe_pedido_em_andamento_sem_concessao", detailHtml, {
        guarda: "pedido ainda não concedido — seção 'Datas' sem Concessão nem Vigência, só Depósito",
        numeroProcesso: d.numeroProcesso, situacaoOperacional: d.situacaoOperacional,
        dataDeposito: d.dataDeposito, dataConcessao: d.dataConcessao,
      });
      achouEmAndamento = true;
    }
  }
}

// registro vigente com logo: tenta mais termos com apresentacao=mista
const termosMista = ["APPLE", "MICROSOFT", "SAMSUNG", "NIKE"];
for (const marca of termosMista) {
  if (achouVigenteLogo) break;
  const html = await client.postMarcas({
    precisao: "nao", txt: "", marca, FormaApresentacao: "2", FormaNatureza: "0",
    classeInter: "", registerPerPage: "40", botao: "", Action: "searchMarca", tipoPesquisa: "BY_MARCA_CLASSIF_AVANCADA",
  });
  const r = parseSearchResults(html);
  console.log(`\n${marca} mista: ${r.resultados.length} resultados.`);
  const vigente = r.resultados.find((row) => row.situacaoOperacional === "registro_vigente" && row.codPedido);
  if (vigente) {
    const detailHtml = await detailOf(vigente.codPedido);
    const d = parseProcessDetail(detailHtml);
    if (d.numeroProcesso) {
      save("detalhe_registro_vigente_com_logo", detailHtml, {
        guarda: "marca mista vigente com imagem de verdade (asset baixável) — apresentacao=Mista",
        numeroProcesso: d.numeroProcesso, apresentacao: d.apresentacao, situacaoOperacional: d.situacaoOperacional,
      });
      achouVigenteLogo = true;
    }
  }
}

console.log("\nResumo rodada 2:", { achouExtintoArquivado, achouSemRepresentante, achouEmAndamento, achouVigenteLogo });
