#!/usr/bin/env node
/**
 * Teste de ponta a ponta pelo protocolo MCP real (stdio + JSON-RPC), não pela lógica interna
 * direto — sobe o servidor compilado de verdade, conecta como um cliente MCP conectaria, e
 * exercita as 7 ferramentas contra o pePI ao vivo (as 5 buscas, paginação e detalhe).
 *
 * Precisa de INPI_USERNAME e INPI_PASSWORD no ambiente (as mesmas do .env.example).
 * Faz chamadas de rede reais — não roda em CI sem credencial, e não deve rodar em loop.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";

if (!process.env.INPI_USERNAME || !process.env.INPI_PASSWORD) {
  console.error("Defina INPI_USERNAME e INPI_PASSWORD no ambiente antes de rodar este teste.");
  process.exit(1);
}

const EXPECTED_TOOLS = [
  "inpi_search_by_process_number",
  "inpi_search_by_mark",
  "inpi_search_by_mark_advanced",
  "inpi_search_by_owner",
  "inpi_search_by_figurative_code",
  "inpi_next_page",
  "inpi_get_process_detail",
];

const transport = new StdioClientTransport({
  command: "node",
  args: [new URL("../dist/index.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  env: process.env,
});

const client = new Client({ name: "inpi-marcas-mcp-server-e2e-test", version: "1.0.0" });
await client.connect(transport);

// O SDK do MCP tem timeout PRÓPRIO do lado do cliente (padrão 60s), separado do timeout do
// nosso servidor pra falar com o pePI (REQUEST_TIMEOUT_MS, 90s). Se o timeout do cliente MCP
// for igual ou menor que o do servidor, o cliente desiste ANTES do servidor conseguir
// responder — mesmo com sucesso do lado do pePI. Precisa ficar ACIMA de REQUEST_TIMEOUT_MS;
// qualquer integração real com este servidor deveria configurar o timeout do lado do cliente
// da mesma forma, não só este teste.
const TOOL_TIMEOUT_MS = 120_000;
async function call(name, args) {
  return client.callTool({ name, arguments: args }, undefined, { timeout: TOOL_TIMEOUT_MS });
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FALHOU:", msg);
    failures++;
  } else {
    console.log("ok  ", msg);
  }
}

const { tools } = await client.listTools();
const toolNames = tools.map((t) => t.name);
for (const expected of EXPECTED_TOOLS) {
  assert(toolNames.includes(expected), `ferramenta ${expected} anunciada`);
}

// --- inpi_search_by_mark ---
const result = await call("inpi_search_by_mark", { marca: "GOOGLE", busca_exata: true, resultados_por_pagina: 20 });
const structured = result.structuredContent;
assert(!!result.content?.[0]?.text, "busca por marca: resposta tem conteúdo de texto");
assert(typeof structured?.totalEncontrado === "number" && structured.totalEncontrado > 0, "busca por marca: totalEncontrado é um número > 0");
assert(Array.isArray(structured?.resultados) && structured.resultados.length > 0, "busca por marca: resultados não vazio");
const real = structured.resultados.find((r) => r.numeroProcesso !== "-" && r.codPedido);
assert(!!real?.codPedido, "busca por marca: pelo menos um resultado real tem codPedido");
assert(real?.titular?.includes("GOOGLE"), "busca por marca: titular do primeiro resultado real contém GOOGLE");
assert(!!real?.situacaoOperacional, "busca por marca: resultado tem situacaoOperacional classificada");
assert(
  structured?.proveniencia?.fonte === "pePI (INPI oficial)" && !!structured?.proveniencia?.consultadoEm,
  "busca por marca: structuredContent tem proveniencia (fonte + consultadoEm)",
);
assert(result.content?.[0]?.text?.includes("anterioridade"), "busca por marca: texto traz o aviso de anterioridade × colidência");

// --- inpi_get_process_detail ---
if (real?.codPedido) {
  const detail = await call("inpi_get_process_detail", { cod_pedido: real.codPedido });
  const d = detail.structuredContent;
  assert(d?.numeroProcesso === real.numeroProcesso, "detalhe: bate com o processo da busca");
  assert(Array.isArray(d?.classes) && d.classes.length > 0, "detalhe: tem pelo menos uma classe");
  assert(!!d?.situacaoOperacional, "detalhe: tem situacaoOperacional classificada");
  assert(!!d?.proveniencia?.consultadoEm, "detalhe: structuredContent tem proveniencia");
}

// --- inpi_search_by_process_number (encadeado com o número achado na busca por marca) ---
if (real?.numeroProcesso) {
  const byNum = await call("inpi_search_by_process_number", { numero_processo: real.numeroProcesso });
  const s = byNum.structuredContent;
  assert(
    Array.isArray(s?.resultados) && s.resultados.some((r) => r.numeroProcesso === real.numeroProcesso),
    "busca por número: acha o mesmo processo",
  );
}

// --- inpi_search_by_mark_advanced ---
const adv = await call("inpi_search_by_mark_advanced", {
  marca: "GOOGLE",
  busca_fuzzy: false,
  apresentacao: "qualquer",
  natureza: "qualquer",
  apenas_pedidos_vivos: true,
  resultados_por_pagina: 20,
});
const sAdv = adv.structuredContent;
assert(typeof sAdv?.totalEncontrado === "number" && sAdv.totalEncontrado > 0, "busca avançada: totalEncontrado é um número > 0");
assert(Array.isArray(sAdv?.resultados) && sAdv.resultados.length > 0, "busca avançada: resultados não vazio");

// --- inpi_search_by_owner (nome -> disambiguation -> pos) ---
const owner1 = await call("inpi_search_by_owner", { nome: "GOOGLE", resultados_por_pagina: 20 });
const sOwner1 = owner1.structuredContent;
if (Array.isArray(sOwner1?.titularesCandidatos) && sOwner1.titularesCandidatos.length > 0) {
  const pos = sOwner1.titularesCandidatos[0].pos;
  const owner2 = await call("inpi_search_by_owner", { nome: "GOOGLE", pos, resultados_por_pagina: 20 });
  const sOwner2 = owner2.structuredContent;
  assert(Array.isArray(sOwner2?.resultados) && sOwner2.resultados.length > 0, "busca por titular: 2ª etapa (pos) devolve marcas");
} else {
  assert(Array.isArray(sOwner1?.resultados) && sOwner1.resultados.length > 0, "busca por titular: resultados diretos (sem disambiguation)");
}

// --- inpi_search_by_figurative_code (código oficial com zero à esquerda — prova a
// normalização: o pePI só casa "26.4.1" no armazenamento, não "26.04.01") ---
const fig = await call("inpi_search_by_figurative_code", { viena_1: "26.04.01", resultados_por_pagina: 20 });
const sFig = fig.structuredContent;
assert(typeof sFig?.totalEncontrado === "number" && sFig.totalEncontrado > 0, "código de Viena: totalEncontrado é um número > 0 (normalização de zero à esquerda funcionou)");
assert(Array.isArray(sFig?.resultados) && sFig.resultados.length > 0, "código de Viena: resultados não vazio");

// --- inpi_next_page (pagina a ÚLTIMA busca feita na sessão do servidor; por isso refaz a
// busca por marca por último, imediatamente antes de paginar) ---
const markAgain = await call("inpi_search_by_mark", { marca: "GOOGLE", busca_exata: true, resultados_por_pagina: 20 });
const sMarkAgain = markAgain.structuredContent;
if (sMarkAgain?.totalPaginas > 1) {
  const next = await call("inpi_next_page", { pagina: 2 });
  const sNext = next.structuredContent;
  assert(Array.isArray(sNext?.resultados) && sNext.resultados.length > 0 && sNext.paginaAtual === 2, "próxima página: devolve a página 2");
}

// --- cache local + exportação HTML ---
// forcar_atualizacao=true na 1ª chamada garante estado limpo mesmo que uma execução anterior
// (deste teste ou de uma verificação manual) já tenha deixado essa busca em cache — o cache
// é em disco e sobrevive entre processos, de propósito.
const cacheArgs = { marca: "MICROSOFT", busca_exata: true, resultados_por_pagina: 20 };
const htmlCall = await call("inpi_search_by_mark", { ...cacheArgs, salvar_html: true, forcar_atualizacao: true });
const htmlText = htmlCall.content?.[0]?.text ?? "";
assert(!htmlText.includes("resultado do cache local"), "cache: forcar_atualizacao=true na 1ª chamada vai ao pePI ao vivo");
const htmlMatch = htmlText.match(/Relatório HTML salvo em: (.+\.html)/);
assert(!!htmlMatch, "cache: resposta com salvar_html=true aponta o caminho do relatório");
if (htmlMatch) {
  const htmlPath = htmlMatch[1].trim();
  const exists = fs.existsSync(htmlPath);
  assert(exists, "cache: arquivo HTML foi realmente escrito em disco");
  if (exists) {
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");
    assert(htmlContent.includes("<!doctype html>") && htmlContent.includes("<table>"), "cache: HTML salvo é um documento válido com tabela");
  }
}

const cachedCall = await call("inpi_search_by_mark", cacheArgs);
const cachedText = cachedCall.content?.[0]?.text ?? "";
assert(cachedText.includes("resultado do cache local"), "cache: 2ª chamada idêntica vem do cache local");

const forcedCall = await call("inpi_search_by_mark", { ...cacheArgs, forcar_atualizacao: true });
const forcedText = forcedCall.content?.[0]?.text ?? "";
assert(!forcedText.includes("resultado do cache local"), "cache: forcar_atualizacao=true ignora o cache");

await client.close();

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTodas as verificações passaram.");
