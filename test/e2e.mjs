#!/usr/bin/env node
/**
 * Teste de ponta a ponta pelo protocolo MCP real (stdio + JSON-RPC), não pela lógica interna
 * direto — sobe o servidor compilado de verdade, conecta como um cliente MCP conectaria, lista
 * as ferramentas e chama uma busca real contra o pePI ao vivo.
 *
 * Precisa de INPI_USERNAME e INPI_PASSWORD no ambiente (as mesmas do .env.example).
 * Faz UMA chamada de rede real — não roda em CI sem credencial, e não deve rodar em loop.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

const result = await client.callTool({
  name: "inpi_search_by_mark",
  arguments: { marca: "GOOGLE", busca_exata: true, resultados_por_pagina: 20 },
});
const structured = result.structuredContent;
assert(!!result.content?.[0]?.text, "resposta tem conteúdo de texto");
assert(typeof structured?.totalEncontrado === "number" && structured.totalEncontrado > 0, "totalEncontrado é um número > 0");
assert(Array.isArray(structured?.resultados) && structured.resultados.length > 0, "resultados não vazio");
const real = structured.resultados.find((r) => r.numeroProcesso !== "-");
assert(!!real?.codPedido, "pelo menos um resultado real tem codPedido");
assert(real?.titular?.includes("GOOGLE"), "titular do primeiro resultado real contém GOOGLE");

if (real?.codPedido) {
  const detail = await client.callTool({
    name: "inpi_get_process_detail",
    arguments: { cod_pedido: real.codPedido },
  });
  const d = detail.structuredContent;
  assert(d?.numeroProcesso === real.numeroProcesso, "detalhe bate com o processo da busca");
  assert(Array.isArray(d?.classes) && d.classes.length > 0, "detalhe tem pelo menos uma classe");
}

await client.close();

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTodas as verificações passaram.");
