import * as cheerio from "cheerio";
import type { ClasseNice, MarcaResultRow, Peticao, ProcessoDetalhe, SearchResult } from "./types.js";
import { classificarSituacao } from "./situacao.js";

function clean(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function cleanOrNull(text: string | undefined | null): string | null {
  const c = clean(text);
  return c && c !== "-" ? c : null;
}

/**
 * Linhas de dados DIRETAS de uma tabela (so' o <tbody> daquela tabela). Varias secoes do pePI
 * escondem uma tabela de tooltip dentro do <thead> (ex: a ajuda "Leia-me" da coluna Data de
 * Vigencia) — usar find("tbody tr") pega tambem as linhas dessa tabela aninhada, porque find()
 * procura em qualquer profundidade. children() restringe a so' o nivel direto.
 */
function directRows(table: cheerio.Cheerio<any> | null | undefined): cheerio.Cheerio<any> {
  if (!table || !table.length) return table?.constructor ? table.filter(() => false) : (table as any);
  const tbody = table.children("tbody");
  return (tbody.length ? tbody : table).children("tr");
}

function directCells($: cheerio.CheerioAPI, row: any): cheerio.Cheerio<any> {
  return $(row).children("td, th");
}

/**
 * Varias celulas (ex: classe de Nice, especificacao) tem uma div de tooltip com
 * "visibility: hidden" plantada dentro, com o texto completo por baixo de um resumo curto
 * visivel via onmouseover. cheerio ignora CSS, entao .text() pega os dois; isola so' o
 * texto visivel removendo qualquer descendente com visibility:hidden antes de ler.
 */
function visibleText($: cheerio.CheerioAPI, cell: any): string {
  const $clone = $(cell).clone();
  $clone.find("div, span, table").each((_, el) => {
    const style = ($(el).attr("style") ?? "").toLowerCase();
    if (/visibility\s*:\s*hidden/.test(style)) $(el).remove();
  });
  return clean($clone.text());
}

/**
 * A tabela de resultado do pePI e' identificada pelo cabecalho com "Numero" + "Situacao" + "Titular",
 * nao por indice de posicao (o numero de tabelas antes dela varia por pagina/layout).
 */
function findResultTable($: cheerio.CheerioAPI): cheerio.Cheerio<any> | null {
  let found: cheerio.Cheerio<any> | null = null;
  $("table").each((_, table) => {
    const headerRow = directRows($(table)).first();
    const headerText = clean(headerRow.text());
    if (headerText.includes("Número") && headerText.includes("Situação") && headerText.includes("Titular")) {
      found = $(table);
      return false;
    }
  });
  return found;
}

/**
 * A busca por NOME de titular (aproximada) nao devolve marca nenhuma de cara: devolve os
 * nomes de titular que batem, cada um num link "...&pos=N" pra escolher qual ver de verdade.
 * Essa tabela tem cabecalho de uma coluna so' ("Titular"), sem "Situacao"/"Numero".
 */
function findOwnerDisambiguationTable($: cheerio.CheerioAPI): cheerio.Cheerio<any> | null {
  let found: cheerio.Cheerio<any> | null = null;
  $("table").each((_, table) => {
    const headerRow = directRows($(table)).first();
    const headerText = clean(headerRow.text());
    if (headerText === "Titular") {
      found = $(table);
      return false;
    }
  });
  return found;
}

/**
 * A busca avancada (BY_MARCA_CLASSIF_AVANCADA) nao devolve uma tabela de colunas como a busca
 * basica — devolve uma grade de "cartoes", um por marca, com Prioridade/Situacao/Titular/Classe
 * escondidos num tooltip (div visibility:hidden) que só aparece ao passar o mouse na miniatura.
 * cheerio ignora CSS, entao da' pra ler o tooltip direto sem simular o hover.
 */
function parseCardGridResults($: cheerio.CheerioAPI): MarcaResultRow[] {
  const resultados: MarcaResultRow[] = [];
  $("input[name='MeusPedidos']").each((_, checkbox) => {
    const numeroProcesso = ($(checkbox).attr("value") ?? "").trim();
    if (!numeroProcesso) return; // linha "Alto Renome" sem processo, mesmo padrao da busca basica

    const cell = $(checkbox).closest("td");
    const link = cell.find("a[href*='CodPedido']").first();
    const codPedidoMatch = (link.attr("href") ?? "").match(/CodPedido=(\d+)/);
    const codPedido = codPedidoMatch ? codPedidoMatch[1] : null;

    // nome da marca: dentro da mini-tabela VISIVEL (border=1, é a miniatura), nao a escondida
    const visibleThumb = cell.find("table[border='1']").first();
    const marca = clean(visibleThumb.find("b").first().text());

    // metadados: dentro do tooltip escondido, texto tipo "Prioridade: X Situação: Y Titular(es): Z Classe: W"
    const hiddenDiv = cell.find("div[style*='hidden' i]").first();
    const metaText = clean(hiddenDiv.text());
    const prioridadeMatch = metaText.match(/Prioridade:\s*([^]*?)\s*Situação:/);
    const situacaoMatch = metaText.match(/Situação:\s*([^]*?)\s*Titular/);
    const titularMatch = metaText.match(/Titular\(es\):\s*([^]*?)\s*Classe:/);
    const classeMatch = metaText.match(/Classe:\s*([^]*)$/);

    const situacaoCard = situacaoMatch ? clean(situacaoMatch[1]) : "";
    resultados.push({
      numeroProcesso,
      dataPrioridade: prioridadeMatch ? cleanOrNull(prioridadeMatch[1]) : null,
      marca,
      situacao: situacaoCard,
      situacaoOperacional: classificarSituacao(situacaoCard),
      titular: titularMatch ? cleanOrNull(titularMatch[1].replace(/^null$/, "")) : null,
      classe: classeMatch ? cleanOrNull(classeMatch[1]) : null,
      codPedido,
      urlDetalhe: codPedido ? `/pePI/servlet/MarcasServletController?Action=detail&CodPedido=${codPedido}` : null,
    });
  });
  return resultados;
}

export function parseSearchResults($html: string): SearchResult {
  const $ = cheerio.load($html);

  const totalMatch = $.root().text().match(/Foram encontrados\s+([\d.]+)\s+(?:processos?|registros?)/i);
  const totalEncontrado = totalMatch ? Number(totalMatch[1].replace(/\./g, "")) : null;
  const aviso = totalEncontrado === null ? null : null;

  const disambigTable = findOwnerDisambiguationTable($);
  const titularesCandidatos = disambigTable
    ? directRows(disambigTable)
        .slice(1)
        .map((_, tr) => {
          const link = $(tr).find("a[href*='pos=']");
          const posMatch = (link.attr("href") ?? "").match(/pos=(\d+)/);
          return { nome: clean(link.text()), pos: posMatch ? Number(posMatch[1]) : -1 };
        })
        .get()
        .filter((c) => c.nome && c.pos >= 0)
    : null;

  const pagMatch = $.root().text().match(/[Pp]ágina[s]?\s*(?:de\s*[Rr]esultados)?[:\s]*[^\d]*(\d+)/);
  const paginaAtual = pagMatch ? Number(pagMatch[1]) : 1;

  const pageLinks = $('a[href*="Action=nextPageMarca"]')
    .map((_, a) => {
      const m = ($(a).attr("href") ?? "").match(/page=(\d+)/);
      return m ? Number(m[1]) : null;
    })
    .get()
    .filter((n): n is number => n !== null);
  const totalPaginas = pageLinks.length ? Math.max(...pageLinks) : null;

  let resultados: MarcaResultRow[] = [];
  const table = findResultTable($);
  if (table) {
    const rows = directRows(table).slice(1); // pula o cabecalho
    rows.each((_, tr) => {
      const cells = directCells($, tr);
      if (cells.length < 8) return;

      const numLink = $(cells[1]).find("a[href*='CodPedido']");
      const numeroProcesso = cleanOrNull($(cells[1]).text());
      const codPedidoMatch = (numLink.attr("href") ?? "").match(/CodPedido=(\d+)/);
      const codPedido = codPedidoMatch ? codPedidoMatch[1] : null;

      const situacaoRow = clean($(cells[6]).text());
      resultados.push({
        numeroProcesso: numeroProcesso ?? "-",
        dataPrioridade: cleanOrNull($(cells[2]).text()),
        marca: clean($(cells[4]).text()),
        situacao: situacaoRow,
        situacaoOperacional: classificarSituacao(situacaoRow),
        titular: cleanOrNull($(cells[7]).text()),
        classe: cells.length > 8 ? cleanOrNull($(cells[8]).text()) : null,
        codPedido,
        urlDetalhe: codPedido ? `/pePI/servlet/MarcasServletController?Action=detail&CodPedido=${codPedido}` : null,
      });
    });
  } else if (!titularesCandidatos) {
    // busca avancada: sem tabela de colunas, mas pode ter a grade de cartoes com tooltip
    resultados = parseCardGridResults($);
  }

  return { totalEncontrado, paginaAtual, totalPaginas, resultados, aviso, titularesCandidatos };
}

/**
 * A pagina de detalhe do processo e' organizada em blocos "accordion", cada um com um
 * <label><font class="titulo">Nome da Secao</font></label> seguido de uma tabela de dados.
 * Extrai por rotulo de secao em vez de indice, porque secoes ausentes (ex: sem prioridade
 * unionista) deslocam a posicao das seguintes.
 */
export function parseProcessDetail(html: string): ProcessoDetalhe {
  const $ = cheerio.load(html);

  const fieldValue = (label: string): string | null => {
    let value: string | null = null;
    $("td font.normal, td font.marcador").each((_, el) => {
      const t = clean($(el).text());
      if (t === label) {
        const td = $(el).closest("td");
        const valueTd = td.next("td");
        value = cleanOrNull(valueTd.text());
        return false;
      }
    });
    return value;
  };

  const numeroProcesso = fieldValue("Nº do Processo:") ?? "";
  const marca = fieldValue("Marca:");
  const situacao = fieldValue("Situação:");
  const apresentacao = fieldValue("Apresentação:");
  const natureza = fieldValue("Natureza:");

  const sectionTable = (sectionLabel: string): cheerio.Cheerio<any> | null => {
    let found: cheerio.Cheerio<any> | null = null;
    $("font.titulo").each((_, el) => {
      if (clean($(el).text()) === sectionLabel) {
        const item = $(el).closest(".accordion-item");
        // a tabela de dados e' filha direta de .accordion-content; nao usar find() aqui evita
        // descer para dentro de qualquer tooltip aninhado antes da tabela real.
        found = item.find(".accordion-content").first().children("table").first();
        return false;
      }
    });
    return found;
  };

  const classes: ClasseNice[] = [];
  const classesTable = sectionTable("Classificação de Produtos / Serviços");
  directRows(classesTable).each((_, tr) => {
    const cells = directCells($, tr);
    if (cells.length < 3) return;
    const classe = visibleText($, cells[0]);
    if (!classe || classe === "Classe de Nice") return; // linha de cabecalho, se sobrar alguma
    classes.push({
      classe,
      situacao: visibleText($, cells[1]),
      especificacao: visibleText($, cells[2]),
    });
  });

  const titulares: string[] = [];
  const titularesTable = sectionTable("Titulares");
  directRows(titularesTable).each((_, tr) => {
    const cells = directCells($, tr);
    if (cells.length < 2) return;
    const nome = clean($(cells[1]).text());
    if (nome) titulares.push(nome);
  });

  let procurador: string | null = null;
  const repTable = sectionTable("Representante Legal");
  directRows(repTable).each((_, tr) => {
    const cells = directCells($, tr);
    if (cells.length >= 2) procurador = cleanOrNull($(cells[1]).text());
  });

  let dataDeposito: string | null = null;
  let dataConcessao: string | null = null;
  let dataVigencia: string | null = null;
  const datasTable = sectionTable("Datas");
  const datasRow = directRows(datasTable).first();
  if (datasRow && datasRow.length) {
    const cells = directCells($, datasRow[0]);
    dataDeposito = cleanOrNull(visibleText($, cells[0]));
    dataConcessao = cleanOrNull(visibleText($, cells[1]));
    dataVigencia = cleanOrNull(visibleText($, cells[2]));
  }

  let prioridadeUnionista: ProcessoDetalhe["prioridadeUnionista"] = null;
  const prioTable = sectionTable("Prioridade Unionista");
  const prioRow = directRows(prioTable).first();
  if (prioRow && prioRow.length) {
    const cells = directCells($, prioRow[0]);
    const numero = cleanOrNull($(cells[0]).text());
    if (numero) {
      prioridadeUnionista = {
        numero,
        pais: clean($(cells[1]).text()),
        data: clean($(cells[2]).text()),
      };
    }
  }

  const peticoes: Peticao[] = [];
  $("b:contains('Protocolo:')").each((_, el) => {
    const block = clean($(el).parent().text());
    const protocoloMatch = block.match(/Protocolo:\s*(\d+)\s*\(([\d/]+)\)/);
    if (!protocoloMatch) return;
    const servicoMatch = block.match(/Petição \(tipo\):\s*([^()]+?)\s*\(/);
    const clienteMatch = block.match(/(?:Titular|Requerente)(?:\(es\))?:\s*([^<\n]+?)(?:Procurador:|$)/);
    peticoes.push({
      protocolo: protocoloMatch[1],
      data: protocoloMatch[2],
      servico: servicoMatch ? clean(servicoMatch[1]) : null,
      cliente: clienteMatch ? clean(clienteMatch[1]) : null,
    });
  });

  return {
    numeroProcesso,
    marca,
    situacao,
    situacaoOperacional: classificarSituacao(situacao),
    apresentacao,
    natureza,
    classes,
    titulares,
    procurador,
    dataDeposito,
    dataConcessao,
    dataVigencia,
    prioridadeUnionista,
    peticoes,
  };
}
