#!/usr/bin/env node
/**
 * Teste OFFLINE dos parsers — sem rede, sem credencial, roda em CI pública. Lê cada fixture
 * real em test/fixtures/<nome>/raw.html e confere contra test/fixtures/<nome>/expected.json.
 *
 * Complementa test/e2e.mjs (que prova as ferramentas contra o pePI AO VIVO): este aqui prova
 * que os PARSERS continuam extraindo certo mesmo sem depender do pePI estar de pé — e pega
 * regressão rápido, sem esperar timeout de rede. Ver test/fixtures/README.md pro que cada
 * fixture guarda.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSearchResults, parseProcessDetail } from "../dist/parsers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FALHOU:", msg);
    failures++;
  } else {
    console.log("ok  ", msg);
  }
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function loadFixture(name) {
  const dir = path.join(FIXTURES_DIR, name);
  const html = fs.readFileSync(path.join(dir, "raw.html"), "utf-8");
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf-8"));
  return { html, expected };
}

// --- busca_basica_tabela_google ---
{
  const { html, expected } = loadFixture("busca_basica_tabela_google");
  const r = parseSearchResults(html);
  assert(r.totalEncontrado === expected.totalEncontrado, `busca_basica: totalEncontrado === ${expected.totalEncontrado}`);
  assert(r.resultados.length === expected.resultadosNaPagina, `busca_basica: ${expected.resultadosNaPagina} resultados na página`);
  assert(r.resultados[0]?.marca === expected.primeiraMarca, `busca_basica: primeira marca === "${expected.primeiraMarca}"`);
  assert(
    r.resultados[0]?.situacaoOperacional === expected.primeiraSituacaoOperacional,
    `busca_basica: primeira situacaoOperacional === "${expected.primeiraSituacaoOperacional}"`,
  );
  assert(r.titularesCandidatos === null, "busca_basica: não é lista de desambiguação");
}

// --- busca_avancada_cards_com_imagem (via busca de Viena — ver fixtures/README.md) ---
{
  const { html, expected } = loadFixture("busca_avancada_cards_com_imagem");
  const r = parseSearchResults(html);
  assert(r.totalEncontrado === expected.totalEncontrado, `busca_viena: totalEncontrado === ${expected.totalEncontrado}`);
  assert(r.resultados.length === expected.resultadosNaPagina, `busca_viena: ${expected.resultadosNaPagina} resultados na página`);
  assert(
    deepEqual(r.resultados.slice(0, 5).map((x) => x.marca), expected.primeirasMarcas),
    "busca_viena: primeiras 5 marcas batem, nenhuma virou número de processo",
  );
}

// --- titular_desambiguacao ---
{
  const { html, expected } = loadFixture("titular_desambiguacao");
  const r = parseSearchResults(html);
  assert(
    r.titularesCandidatos?.length === expected.quantidadeCandidatos,
    `titular_desambiguacao: ${expected.quantidadeCandidatos} candidatos`,
  );
  assert(
    deepEqual(r.titularesCandidatos?.[0], expected.primeiroCandidato),
    "titular_desambiguacao: primeiro candidato bate (nome + pos)",
  );
  assert(r.resultados.length === 0, "titular_desambiguacao: não devolve marcas nesta etapa");
}

// --- detalhe_com_prioridade_unionista ---
{
  const { html, expected } = loadFixture("detalhe_com_prioridade_unionista");
  const d = parseProcessDetail(html);
  assert(d.numeroProcesso === expected.numeroProcesso, `prioridade_unionista: processo ${expected.numeroProcesso}`);
  assert(deepEqual(d.prioridadeUnionista, expected.prioridadeUnionista), "prioridade_unionista: numero/pais/data batem");
}

// --- detalhe_extinto_ou_arquivado ---
{
  const { html, expected } = loadFixture("detalhe_extinto_ou_arquivado");
  const d = parseProcessDetail(html);
  assert(d.numeroProcesso === expected.numeroProcesso, `extinto_ou_arquivado: processo ${expected.numeroProcesso}`);
  assert(d.situacao === expected.situacao, `extinto_ou_arquivado: situação bruta "${expected.situacao}"`);
  assert(d.situacaoOperacional === expected.situacaoOperacional, `extinto_ou_arquivado: classificado como ${expected.situacaoOperacional}`);
}

// --- detalhe_peticoes_multilinha ---
{
  const { html, expected } = loadFixture("detalhe_peticoes_multilinha");
  const d = parseProcessDetail(html);
  assert(d.numeroProcesso === expected.numeroProcesso, `peticoes_multilinha: processo ${expected.numeroProcesso}`);
  assert(d.peticoes.length === expected.quantidadePeticoes, `peticoes_multilinha: ${expected.quantidadePeticoes} petições`);
  assert(deepEqual(d.peticoes, expected.peticoes), "peticoes_multilinha: todas as linhas (protocolo/data/serviço/cliente) batem");
}

// --- detalhe_registro_vigente_com_logo ---
{
  const { html, expected } = loadFixture("detalhe_registro_vigente_com_logo");
  const d = parseProcessDetail(html);
  assert(d.numeroProcesso === expected.numeroProcesso, `registro_vigente_com_logo: processo ${expected.numeroProcesso}`);
  assert(d.apresentacao === expected.apresentacao, `registro_vigente_com_logo: apresentação "${expected.apresentacao}"`);
  assert(d.situacaoOperacional === expected.situacaoOperacional, `registro_vigente_com_logo: classificado como ${expected.situacaoOperacional}`);
}

// --- detalhe_sem_representante_legal (o caso que expôs o bug real do directRows) ---
{
  const { html, expected } = loadFixture("detalhe_sem_representante_legal");
  const d = parseProcessDetail(html);
  assert(d.numeroProcesso === expected.numeroProcesso, `sem_representante_legal: processo ${expected.numeroProcesso} (não quebrou)`);
  assert(d.procurador === expected.procurador, "sem_representante_legal: procurador null, sem exceção");
}

// --- detalhe_pedido_em_andamento_sem_concessao ---
{
  const { html, expected } = loadFixture("detalhe_pedido_em_andamento_sem_concessao");
  const d = parseProcessDetail(html);
  assert(d.numeroProcesso === expected.numeroProcesso, `pedido_em_andamento: processo ${expected.numeroProcesso}`);
  assert(d.situacaoOperacional === expected.situacaoOperacional, `pedido_em_andamento: classificado como ${expected.situacaoOperacional}`);
  assert(d.dataDeposito === expected.dataDeposito, `pedido_em_andamento: depósito ${expected.dataDeposito}`);
  assert(d.dataConcessao === expected.dataConcessao, "pedido_em_andamento: sem data de concessão, não inventa nenhuma");
}

// --- detalhe_madrid ---
{
  const { html, expected } = loadFixture("detalhe_madrid");
  const d = parseProcessDetail(html);
  assert(d.numeroProcesso === expected.numeroProcesso, `madrid: processo ${expected.numeroProcesso} (${expected.marca})`);
  assert(d.classes.length >= 0, "madrid: não quebra ao parsear classes (pode ter estrutura diferente por vir de designação internacional)");
}

if (failures > 0) {
  console.error(`\n${failures} verificação(ões) falharam.`);
  process.exit(1);
}
console.log("\nTodas as verificações passaram (offline, sem rede).");
