#!/usr/bin/env node
/**
 * MCP server for the OFFICIAL Brazilian trademark search system (pePI, INPI).
 *
 * This talks directly to https://busca.inpi.gov.br/pePI, the same public system anyone
 * can use at inpi.gov.br. It requires a personal INPI login (the same credential you
 * use to open pePI in a browser) supplied via environment variables — this server never
 * ships, stores, or shares any credential, and does not touch any third-party database.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PepiClient, PepiAuthError } from "./client.js";
import { parseProcessDetail, parseSearchResults } from "./parsers.js";
import { CHARACTER_LIMIT, VALID_PAGE_SIZES } from "./constants.js";
import type { SearchResult } from "./types.js";

const username = process.env.INPI_USERNAME;
const password = process.env.INPI_PASSWORD;

if (!username || !password) {
  console.error(
    "ERRO: defina INPI_USERNAME e INPI_PASSWORD com o seu login pessoal do pePI " +
      "(o mesmo que voce usa em https://busca.inpi.gov.br/pePI). Nao ha credencial padrao.",
  );
  process.exit(1);
}

const client = new PepiClient(username, password);

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, CHARACTER_LIMIT) + "\n\n[...resposta cortada em " + CHARACTER_LIMIT + " caracteres. Refine a busca ou use registerPerPage menor.]", truncated: true };
}

function formatSearchResult(result: SearchResult, context: string): { text: string; structured: SearchResult } {
  const lines: string[] = [];
  lines.push(`# Resultado: ${context}`);
  lines.push("");
  if (result.totalEncontrado !== null) lines.push(`Total encontrado: ${result.totalEncontrado}`);
  lines.push(`Página atual: ${result.paginaAtual}${result.totalPaginas ? ` de ${result.totalPaginas}` : ""}`);
  lines.push("");
  if (result.titularesCandidatos) {
    lines.push(
      "O pePI encontrou vários titulares com esse nome. Escolha um pelo campo `pos` e refaça a chamada com esse valor para ver as marcas dele:",
      "",
    );
    for (const c of result.titularesCandidatos) lines.push(`- pos=${c.pos}: ${c.nome}`);
    return { text: lines.join("\n"), structured: result };
  }
  if (!result.resultados.length) {
    lines.push("Nenhum resultado retornado pelo pePI para esta consulta.");
  } else {
    for (const r of result.resultados) {
      lines.push(`## ${r.marca || "(sem marca)"} — processo ${r.numeroProcesso}`);
      if (r.dataPrioridade) lines.push(`- Prioridade: ${r.dataPrioridade}`);
      lines.push(`- Situação: ${r.situacao || "não informada"}`);
      if (r.titular) lines.push(`- Titular: ${r.titular}`);
      if (r.classe) lines.push(`- Classe: ${r.classe}`);
      if (r.codPedido) lines.push(`- CodPedido (use em inpi_get_process_detail): ${r.codPedido}`);
      lines.push("");
    }
  }
  if (result.totalPaginas && result.paginaAtual < result.totalPaginas) {
    lines.push(`Há mais páginas de resultado. Use inpi_next_page com page=${result.paginaAtual + 1}.`);
  }
  return { text: lines.join("\n"), structured: result };
}

function handleError(error: unknown): { content: { type: "text"; text: string }[] } {
  if (error instanceof PepiAuthError) {
    return { content: [{ type: "text", text: `Erro de autenticação no pePI: ${error.message}` }] };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: `Erro consultando o pePI: ${message}. O pePI é um sistema de governo sem SLA de API — tente novamente em alguns segundos; se persistir, o layout do site pode ter mudado (abra uma issue no repositório).`,
      },
    ],
  };
}

const server = new McpServer({
  name: "inpi-marcas-mcp-server",
  version: "0.1.0",
});

const RegisterPerPageSchema = z
  .union([z.literal(20), z.literal(40), z.literal(60), z.literal(80), z.literal(100)])
  .default(20)
  .describe(`Resultados por página. Valores aceitos pelo pePI: ${VALID_PAGE_SIZES.join(", ")}.`);

// --- 1. Busca por número (processo, GRU, protocolo ou registro internacional) ---
const SearchByProcessSchema = z
  .object({
    numero_processo: z.string().optional().describe("Número do processo/pedido, ex: 821480880"),
    numero_gru: z.string().optional().describe("Número da GRU (Guia de Recolhimento da União)"),
    numero_protocolo: z.string().optional().describe("Número do protocolo de petição"),
    numero_inscricao_internacional: z.string().optional().describe("Número da inscrição internacional (Protocolo de Madri)"),
  })
  .strict();

server.registerTool(
  "inpi_search_by_process_number",
  {
    title: "Buscar marca por número de processo",
    description: `Busca uma marca no pePI (INPI oficial) por número de processo, GRU, protocolo de petição ou inscrição internacional (Protocolo de Madri). Use exatamente um desses números — é a forma mais direta de achar um processo específico quando você já sabe o número.

Retorna o(s) processo(s) encontrado(s) com número, marca, situação, titular e classe. Para o detalhe completo (classes, titulares, datas, petições), use inpi_get_process_detail com o CodPedido retornado.`,
    inputSchema: SearchByProcessSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    if (!params.numero_processo && !params.numero_gru && !params.numero_protocolo && !params.numero_inscricao_internacional) {
      return { content: [{ type: "text" as const, text: "Informe pelo menos um número: processo, GRU, protocolo ou inscrição internacional." }] };
    }
    try {
      const html = await client.postMarcas({
        NumPedido: params.numero_processo ?? "",
        NumGRU: params.numero_gru ?? "",
        NumProtocolo: params.numero_protocolo ?? "",
        NumInscricaoInternacional: params.numero_inscricao_internacional ?? "",
        botao: "",
        Action: "searchMarca",
        tipoPesquisa: "BY_NUM_PROC",
      });
      const result = parseSearchResults(html);
      const { text } = formatSearchResult(result, "busca por número");
      const t = truncate(text);
      return { content: [{ type: "text", text: t.text }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      return handleError(error);
    }
  },
);

// --- 2. Busca básica por marca (exata/radical) ---
const SearchByMarkSchema = z
  .object({
    marca: z.string().min(1).describe("Texto da marca a buscar, ex: GOOGLE"),
    busca_exata: z.boolean().default(true).describe("true = busca exata; false = busca por radical (contém o texto)"),
    classe_nice: z.string().optional().describe("Filtra pela Classificação de Nice, ex: 09, 42"),
    resultados_por_pagina: RegisterPerPageSchema,
  })
  .strict();

server.registerTool(
  "inpi_search_by_mark",
  {
    title: "Buscar marca por texto (exata ou radical)",
    description: `Busca marcas no pePI (INPI oficial) pelo texto da marca, igual à aba "Marca" do site oficial. Suporta busca exata (o termo inteiro) ou por radical (o termo aparece em qualquer parte do nome). Pode filtrar por Classificação de Nice.

Use esta busca para descobrir se um nome já está registrado e quem são os titulares. Para busca mais avançada com apresentação, natureza ou operadores booleanos, use inpi_search_by_mark_advanced.`,
    inputSchema: SearchByMarkSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const html = await client.postMarcas({
        buscaExata: params.busca_exata ? "sim" : "nao",
        txt: "",
        marca: params.marca,
        classeInter: params.classe_nice ?? "",
        registerPerPage: String(params.resultados_por_pagina),
        botao: "",
        Action: "searchMarca",
        tipoPesquisa: "BY_MARCA_CLASSIF_BASICA",
      });
      const result = parseSearchResults(html);
      const { text } = formatSearchResult(result, `marca "${params.marca}"`);
      const t = truncate(text);
      return { content: [{ type: "text", text: t.text }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      return handleError(error);
    }
  },
);

// --- 3. Busca avançada (booleana/fuzzy, apresentação, natureza) ---
const SearchAdvancedSchema = z
  .object({
    marca: z.string().min(1).describe("Texto da marca. Aceita operadores booleanos quando fuzzy=false, ex: GOOGLE AND CLOUD"),
    busca_fuzzy: z.boolean().default(false).describe("false = busca booleana (padrão do pePI); true = busca fuzzy/aproximada"),
    apresentacao: z
      .enum(["qualquer", "nominativa", "mista", "figurativa", "tridimensional", "posicao"])
      .default("qualquer")
      .describe("Forma de apresentação da marca"),
    natureza: z
      .enum(["qualquer", "produto", "servico", "coletiva", "certificacao"])
      .default("qualquer")
      .describe("Natureza da marca"),
    classe_nice: z.string().optional().describe("Filtra pela Classificação de Nice, ex: 09, 42"),
    apenas_pedidos_vivos: z.boolean().default(true).describe("true = só processos ativos (Pedidos Vivos); false = inclui arquivados/extintos"),
    resultados_por_pagina: RegisterPerPageSchema,
  })
  .strict();

const APRESENTACAO_MAP: Record<string, string> = {
  qualquer: "0",
  nominativa: "1",
  mista: "2",
  figurativa: "3",
  tridimensional: "4",
  posicao: "5",
};
const NATUREZA_MAP: Record<string, string> = {
  qualquer: "0",
  produto: "1",
  servico: "2",
  coletiva: "3",
  certificacao: "4",
};

server.registerTool(
  "inpi_search_by_mark_advanced",
  {
    title: "Busca avançada de marca (booleana/fuzzy, apresentação, natureza)",
    description: `Busca avançada de marcas no pePI (INPI oficial), igual à Pesquisa Avançada do site oficial. Permite operadores booleanos (AND/OR) ou busca fuzzy, filtrar por forma de apresentação (nominativa/mista/figurativa/tridimensional/posição), natureza (produto/serviço/coletiva/certificação) e restringir a "Pedidos Vivos" (só processos ainda ativos).

Use quando a busca básica (inpi_search_by_mark) for imprecisa demais ou quando precisar filtrar por apresentação/natureza específica — por exemplo, checar colidência só entre marcas mistas na mesma classe.`,
    inputSchema: SearchAdvancedSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    try {
      const html = await client.postMarcas({
        precisao: params.busca_fuzzy ? "sim" : "nao",
        txt: "",
        marca: params.marca,
        FormaApresentacao: APRESENTACAO_MAP[params.apresentacao],
        FormaNatureza: NATUREZA_MAP[params.natureza],
        classeInter: params.classe_nice ?? "",
        ListaTodosPedidos: params.apenas_pedidos_vivos ? "" : "on",
        ListaFigura: "",
        registerPerPage: String(params.resultados_por_pagina),
        botao: "",
        Action: "searchMarca",
        tipoPesquisa: "BY_MARCA_CLASSIF_AVANCADA",
      });
      const result = parseSearchResults(html);
      const { text } = formatSearchResult(result, `busca avançada "${params.marca}"`);
      const t = truncate(text);
      return { content: [{ type: "text", text: t.text }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      return handleError(error);
    }
  },
);

// --- 4. Busca por titular ---
const SearchByOwnerSchema = z
  .object({
    cnpj_cpf: z.string().optional().describe("CNPJ ou CPF do titular, só números ou formatado"),
    nome: z.string().optional().describe("Nome ou razão social do titular"),
    pos: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Quando a busca por nome retorna uma lista de titulares candidatos (nomes parecidos), refaça a chamada com o mesmo nome e este 'pos' para ver as marcas do titular escolhido.",
      ),
    resultados_por_pagina: RegisterPerPageSchema,
  })
  .strict();

server.registerTool(
  "inpi_search_by_owner",
  {
    title: "Buscar marcas por titular (CNPJ/CPF ou nome)",
    description: `Lista as marcas registradas por um titular no pePI (INPI oficial), buscando por CNPJ/CPF ou por nome/razão social.

A busca por CNPJ/CPF é direta. A busca por nome é em DUAS ETAPAS, igual ao site oficial: primeiro devolve os nomes de titular parecidos com o termo (cada um com um número 'pos'), depois é preciso chamar de novo com esse 'pos' para ver as marcas do titular escolhido — não existe atalho, o próprio pePI funciona assim.

Útil para levantar o portfólio de marcas de uma empresa ou pessoa antes de uma due diligence de M&A, ou para conferir se um cliente já tem registros anteriores.`,
    inputSchema: SearchByOwnerSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    if (!params.cnpj_cpf && !params.nome) {
      return { content: [{ type: "text" as const, text: "Informe cnpj_cpf ou nome." }] };
    }
    try {
      let html: string;
      if (params.nome && params.pos !== undefined) {
        html = await client.getMarcas({ Action: "searchMarca", tipoPesquisa: "BY_CNPJ_NOME", pos: String(params.pos) });
      } else {
        html = await client.postMarcas({
          cpf_cgc_numINPI: params.cnpj_cpf ?? "",
          nomeTitular: params.nome ?? "",
          registerPerPage: String(params.resultados_por_pagina),
          botao: "",
          Action: "searchNome",
          precisao: "aproximacao",
          tipoPesquisa: "BY_CNPJ_NOME",
        });
      }
      const result = parseSearchResults(html);
      const { text } = formatSearchResult(result, `titular "${params.nome ?? params.cnpj_cpf}"`);
      const t = truncate(text);
      return { content: [{ type: "text", text: t.text }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      return handleError(error);
    }
  },
);

// --- 5. Busca por código figurativo (Viena) ---
const SearchByFigurativeSchema = z
  .object({
    viena_1: z.string().optional().describe("Primeiro grupo da Classificação de Viena, ex: 27"),
    viena_2: z.string().optional().describe("Segundo grupo da Classificação de Viena, ex: 05"),
    viena_3: z.string().optional().describe("Terceiro grupo da Classificação de Viena, ex: 01"),
    classe_nice: z.string().optional().describe("Filtra pela Classificação de Nice, ex: 09, 42"),
    resultados_por_pagina: RegisterPerPageSchema,
  })
  .strict();

server.registerTool(
  "inpi_search_by_figurative_code",
  {
    title: "Buscar marcas figurativas por código de Viena",
    description: `Busca marcas figurativas/mistas no pePI (INPI oficial) pelo Código de Viena (a classificação internacional de elementos figurativos — ex: 27.05.01 para letras estilizadas). Use quando estiver checando colidência de logotipo/elemento gráfico, não de texto.

A Classificação de Viena completa está em https://www.gov.br/inpi — se não souber o código, descreva o elemento gráfico ao usuário e peça para consultar a tabela oficial antes de buscar.`,
    inputSchema: SearchByFigurativeSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (params) => {
    if (!params.viena_1 && !params.viena_2 && !params.viena_3) {
      return { content: [{ type: "text" as const, text: "Informe pelo menos um grupo da Classificação de Viena." }] };
    }
    try {
      const html = await client.postMarcas({
        viena1: params.viena_1 ?? "",
        viena2: params.viena_2 ?? "",
        viena3: params.viena_3 ?? "",
        classeInter: params.classe_nice ?? "",
        ListaFigura: "",
        registerPerPage: String(params.resultados_por_pagina),
        botao: "",
        Action: "searchMarca",
        tipoPesquisa: "BY_FIGURA",
      });
      const result = parseSearchResults(html);
      const { text } = formatSearchResult(result, "código de Viena");
      const t = truncate(text);
      return { content: [{ type: "text", text: t.text }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      return handleError(error);
    }
  },
);

// --- 6. Próxima página de uma busca já feita ---
server.registerTool(
  "inpi_next_page",
  {
    title: "Buscar próxima página de resultados",
    description: `Avança para outra página de uma busca de marcas já realizada no pePI (INPI oficial). Use depois de qualquer uma das ferramentas de busca quando a resposta indicar que há mais páginas.`,
    inputSchema: { pagina: z.number().int().min(1).describe("Número da página a buscar (2 = segunda página, etc)") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ pagina }) => {
    try {
      const html = await client.getMarcas({ Action: "nextPageMarca", page: String(pagina) });
      const result = parseSearchResults(html);
      const { text } = formatSearchResult(result, `página ${pagina}`);
      const t = truncate(text);
      return { content: [{ type: "text", text: t.text }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      return handleError(error);
    }
  },
);

// --- 7. Detalhe completo de um processo ---
server.registerTool(
  "inpi_get_process_detail",
  {
    title: "Ver detalhe completo de um processo de marca",
    description: `Busca o detalhe completo de um processo de marca no pePI (INPI oficial): classes de Nice com especificação, todos os titulares, procurador/representante legal, datas de depósito/concessão/vigência, prioridade unionista e histórico de petições protocoladas.

Precisa do "cod_pedido" (CodPedido), que vem no campo "CodPedido (use em inpi_get_process_detail)" das ferramentas de busca — não é o número do processo público, é um ID interno do pePI.`,
    inputSchema: { cod_pedido: z.string().min(1).describe("CodPedido retornado por uma busca anterior") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ cod_pedido }) => {
    try {
      const html = await client.getMarcas({ Action: "detail", CodPedido: cod_pedido });
      const detail = parseProcessDetail(html);
      if (!detail.numeroProcesso) {
        return { content: [{ type: "text", text: `Nenhum processo encontrado para CodPedido=${cod_pedido}.` }] };
      }
      const lines: string[] = [];
      lines.push(`# Processo ${detail.numeroProcesso}${detail.marca ? ` — ${detail.marca}` : ""}`);
      lines.push("");
      if (detail.situacao) lines.push(`**Situação:** ${detail.situacao}`);
      if (detail.apresentacao) lines.push(`**Apresentação:** ${detail.apresentacao}`);
      if (detail.natureza) lines.push(`**Natureza:** ${detail.natureza}`);
      lines.push("");
      if (detail.classes.length) {
        lines.push("## Classes de Nice");
        for (const c of detail.classes) lines.push(`- ${c.classe} (${c.situacao}): ${c.especificacao}`);
        lines.push("");
      }
      if (detail.titulares.length) {
        lines.push("## Titulares");
        for (const t of detail.titulares) lines.push(`- ${t}`);
        lines.push("");
      }
      if (detail.procurador) lines.push(`**Procurador:** ${detail.procurador}`, "");
      if (detail.dataDeposito || detail.dataConcessao || detail.dataVigencia) {
        lines.push("## Datas");
        if (detail.dataDeposito) lines.push(`- Depósito: ${detail.dataDeposito}`);
        if (detail.dataConcessao) lines.push(`- Concessão: ${detail.dataConcessao}`);
        if (detail.dataVigencia) lines.push(`- Vigência: ${detail.dataVigencia}`);
        lines.push("");
      }
      if (detail.prioridadeUnionista) {
        lines.push(
          `## Prioridade unionista\n- Pedido ${detail.prioridadeUnionista.numero} (${detail.prioridadeUnionista.pais}), ${detail.prioridadeUnionista.data}`,
          "",
        );
      }
      if (detail.peticoes.length) {
        lines.push("## Petições");
        for (const p of detail.peticoes) {
          lines.push(`- Protocolo ${p.protocolo} (${p.data})${p.servico ? `: ${p.servico}` : ""}${p.cliente ? ` — ${p.cliente}` : ""}`);
        }
      }
      const t = truncate(lines.join("\n"));
      return { content: [{ type: "text", text: t.text }], structuredContent: detail as unknown as Record<string, unknown> };
    } catch (error) {
      return handleError(error);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("inpi-marcas-mcp-server rodando via stdio");
}

main().catch((error) => {
  console.error("Erro fatal no servidor:", error);
  process.exit(1);
});
