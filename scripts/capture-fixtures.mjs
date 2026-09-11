#!/usr/bin/env node
/**
 * Captura HTMLs reais do pePI pra virar fixture de teste offline dos parsers
 * (test/fixtures/<nome>/raw.html + expected.json). Não é parte da suíte automática — é
 * ferramenta de autoria/manutenção do corpus, pra rodar de novo se o pePI mudar de layout.
 * Exige credencial real (INPI_USERNAME/INPI_PASSWORD).
 *
 * codPedido não é durável entre sessões de login (medido: um valor que funcionou numa sessão
 * devolveu "Pedido inexistente" numa sessão posterior) — por isso este script SEMPRE busca e
 * usa o codPedido na MESMA sessão, nunca copia um valor de execução anterior.
 *
 * Cada fixture prova uma competência específica do parser — ver test/fixtures/README.md.
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

async function basicSearch(marca, exata = true, perPage = "100") {
  return client.postMarcas({
    buscaExata: exata ? "sim" : "nao", txt: "", marca, classeInter: "",
    registerPerPage: perPage, botao: "", Action: "searchMarca", tipoPesquisa: "BY_MARCA_CLASSIF_BASICA",
  });
}

// --- 1. busca_basica_tabela_google ---
const buscaBasicaHtml = await basicSearch("GOOGLE", true, "40");
const buscaBasicaResult = parseSearchResults(buscaBasicaHtml);
save("busca_basica_tabela_google", buscaBasicaHtml, {
  guarda: "tabela de resultados da busca básica por marca (formato mais comum)",
  totalEncontrado: buscaBasicaResult.totalEncontrado,
  resultadosNaPagina: buscaBasicaResult.resultados.length,
  primeiraMarca: buscaBasicaResult.resultados[0]?.marca,
  primeiraSituacaoOperacional: buscaBasicaResult.resultados[0]?.situacaoOperacional,
});

// --- 2. busca_avancada_cards_com_imagem (via busca por código de Viena — ver README do corpus) ---
const vienaHtml = await client.postMarcas({
  viena1: "27.5", viena2: "", viena3: "", classeInter: "", registerPerPage: "20",
  botao: "", Action: "searchMarca", tipoPesquisa: "BY_FIGURA",
});
const vienaResult = parseSearchResults(vienaHtml);
save("busca_avancada_cards_com_imagem", vienaHtml, {
  guarda: "busca de marcas figurativas (código de Viena) — nomes reais extraídos corretamente, não confundidos com número de processo",
  totalEncontrado: vienaResult.totalEncontrado,
  resultadosNaPagina: vienaResult.resultados.length,
  primeirasMarcas: vienaResult.resultados.slice(0, 5).map((r) => r.marca),
});

// --- 3. titular_desambiguacao ---
const titularHtml = await client.postMarcas({
  cpf_cgc_numINPI: "", nomeTitular: "GOOGLE", registerPerPage: "20",
  botao: "", Action: "searchNome", precisao: "aproximacao", tipoPesquisa: "BY_CNPJ_NOME",
});
const titularResult = parseSearchResults(titularHtml);
save("titular_desambiguacao", titularHtml, {
  guarda: "busca por titular (nome) sem CNPJ devolve lista de candidatos com pos, não marcas direto",
  quantidadeCandidatos: titularResult.titularesCandidatos?.length ?? 0,
  primeiroCandidato: titularResult.titularesCandidatos?.[0] ?? null,
});

// --- busca de trabalho pra achar codPedido dos casos de detalhe ---
const googleHtml = await basicSearch("GOOGLE", true, "100");
const googleResult = parseSearchResults(googleHtml);
const googleRows = googleResult.resultados.filter((r) => r.codPedido);
console.log(`\nGOOGLE: ${googleRows.length} linhas com codPedido pra explorar.`);

function findRow(pred) {
  return googleRows.find(pred);
}

// --- 7. detalhe_com_prioridade_unionista + 9. detalhe_extinto_ou_arquivado + 10. peticoes_multilinha:
// varre os candidatos e escolhe pelo que o DETALHE de verdade tem, não pela linha da busca.
const candidatos = googleRows.slice(0, 15);
let achouPrioridade = false;
let achouExtintoArquivado = false;
let achouPeticoesMultiplas = false;
let achouSemRepresentante = false;
let achouEmAndamento = false;

for (const row of candidatos) {
  const html = await detailOf(row.codPedido);
  const d = parseProcessDetail(html);
  if (!d.numeroProcesso) continue;

  if (!achouPrioridade && d.prioridadeUnionista) {
    save("detalhe_com_prioridade_unionista", html, {
      guarda: "seção 'Prioridade Unionista' (prioridade de depósito estrangeiro, Convenção de Paris)",
      numeroProcesso: d.numeroProcesso,
      prioridadeUnionista: d.prioridadeUnionista,
    });
    achouPrioridade = true;
  }
  if (!achouExtintoArquivado && (d.situacaoOperacional === "registro_extinto" || d.situacaoOperacional === "pedido_arquivado")) {
    save("detalhe_extinto_ou_arquivado", html, {
      guarda: "processo não mais ativo — situacaoOperacional classifica corretamente extinto/arquivado",
      numeroProcesso: d.numeroProcesso,
      situacao: d.situacao,
      situacaoOperacional: d.situacaoOperacional,
    });
    achouExtintoArquivado = true;
  }
  if (!achouPeticoesMultiplas && d.peticoes.length > 1) {
    save("detalhe_peticoes_multilinha", html, {
      guarda: "seção 'Petições' com mais de uma linha (histórico de protocolo)",
      numeroProcesso: d.numeroProcesso,
      quantidadePeticoes: d.peticoes.length,
      peticoes: d.peticoes,
    });
    achouPeticoesMultiplas = true;
  }
  if (!achouSemRepresentante && !d.procurador) {
    save("detalhe_sem_representante_legal", html, {
      guarda: "processo sem seção 'Representante Legal' — directRows() precisa não quebrar com seção ausente",
      numeroProcesso: d.numeroProcesso,
      procurador: d.procurador,
    });
    achouSemRepresentante = true;
  }
  if (!achouEmAndamento && d.situacaoOperacional === "pedido_em_andamento" && !d.dataConcessao) {
    save("detalhe_pedido_em_andamento_sem_concessao", html, {
      guarda: "pedido ainda não concedido — seção 'Datas' sem Concessão nem Vigência, só Depósito",
      numeroProcesso: d.numeroProcesso,
      situacaoOperacional: d.situacaoOperacional,
      dataDeposito: d.dataDeposito,
      dataConcessao: d.dataConcessao,
    });
    achouEmAndamento = true;
  }

  if (achouPrioridade && achouExtintoArquivado && achouPeticoesMultiplas && achouSemRepresentante && achouEmAndamento) break;
}

console.log("\nResumo da varredura GOOGLE:", {
  achouPrioridade, achouExtintoArquivado, achouPeticoesMultiplas, achouSemRepresentante, achouEmAndamento,
});

// --- 4. detalhe_registro_vigente_com_logo: marca mista/figurativa, vigente, com imagem de verdade ---
const misticaHtml = await client.postMarcas({
  precisao: "nao", txt: "", marca: "APPLE", FormaApresentacao: "2", FormaNatureza: "0",
  classeInter: "", registerPerPage: "20", botao: "", Action: "searchMarca", tipoPesquisa: "BY_MARCA_CLASSIF_AVANCADA",
});
const misticaResult = parseSearchResults(misticaHtml);
const vigenteMista = misticaResult.resultados.find((r) => r.situacaoOperacional === "registro_vigente" && r.codPedido);
if (vigenteMista) {
  const html = await detailOf(vigenteMista.codPedido);
  const d = parseProcessDetail(html);
  save("detalhe_registro_vigente_com_logo", html, {
    guarda: "marca mista vigente com imagem de verdade (asset baixável) — apresentacao=Mista",
    numeroProcesso: d.numeroProcesso,
    apresentacao: d.apresentacao,
    situacaoOperacional: d.situacaoOperacional,
  });
} else {
  console.log("\nAVISO: não achei marca mista vigente pra detalhe_registro_vigente_com_logo nesta varredura.");
}

// --- 8. detalhe_madrid: best-effort ---
const candidatosMadrid = ["SPOTIFY", "NETFLIX", "TESLA", "UBER", "AIRBNB"];
let achouMadrid = false;
for (const marca of candidatosMadrid) {
  const html = await basicSearch(marca, true, "40");
  const r = parseSearchResults(html);
  const posMadrid = r.resultados.find((row) => row.dataPrioridade && Number(row.dataPrioridade.slice(-4)) >= 2019 && row.codPedido);
  if (!posMadrid) continue;
  const detailHtml = await detailOf(posMadrid.codPedido);
  if (/[Mm]adri|OMPI|[Rr]egistro [Ii]nternacional/.test(detailHtml)) {
    const d = parseProcessDetail(detailHtml);
    save("detalhe_madrid", detailHtml, {
      guarda: "processo com designação via Protocolo de Madri (registro internacional)",
      numeroProcesso: d.numeroProcesso,
      marca,
    });
    achouMadrid = true;
    break;
  }
}
if (!achouMadrid) {
  console.log("\nAVISO: não achei especime real de Madrid nos candidatos testados — fica como lacuna conhecida (ver README do corpus).");
}

console.log("\nCaptura concluída.");
