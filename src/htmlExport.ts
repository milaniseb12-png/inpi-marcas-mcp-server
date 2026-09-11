import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProcessoDetalhe, SearchResult } from "./types.js";

const OUTPUT_DIR = process.env.INPI_HTML_DIR ?? join(homedir(), "inpi-marcas-mcp-server", "relatorios");

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const STYLE = `
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 880px; margin: 32px auto; padding: 0 16px; color: #1a2236; line-height: 1.5; }
  header { border-bottom: 2px solid #2b5daa; padding-bottom: 12px; margin-bottom: 24px; }
  header h1 { font-size: 20px; margin: 0 0 4px; }
  header .meta { color: #667; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e2e6; vertical-align: top; }
  th { background: #f4f6fb; font-weight: 600; }
  tr:hover { background: #fafbfe; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; background: #eef2fb; color: #2b5daa; }
  section { margin: 24px 0; }
  section h2 { font-size: 16px; border-left: 3px solid #2b5daa; padding-left: 8px; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e2e6; font-size: 12px; color: #889; }
  footer a { color: #2b5daa; }
`;

function shell(title: string, meta: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">${meta}</div>
</header>
${body}
<footer>
  Gerado por <strong>inpi-marcas-mcp-server</strong>, projeto independente que espelha a busca pública do pePI (INPI oficial).
  Não é canal oficial do INPI. Análise de risco de marca de verdade é o <a href="https://inciso.com.br">INCISO</a>.
</footer>
</body>
</html>`;
}

export function renderSearchResultHtml(result: SearchResult, context: string): string {
  const meta = `Consulta: ${escapeHtml(context)} &middot; ${new Date().toLocaleString("pt-BR")} &middot; ${
    result.totalEncontrado !== null ? `${result.totalEncontrado} encontrados` : "total não informado"
  } &middot; página ${result.paginaAtual}${result.totalPaginas ? ` de ${result.totalPaginas}` : ""}`;

  if (result.titularesCandidatos?.length) {
    const rows = result.titularesCandidatos.map((c) => `<tr><td>${c.pos}</td><td>${escapeHtml(c.nome)}</td></tr>`).join("\n");
    const body = `<section><h2>Titulares candidatos</h2><p>Refaça a busca com o campo <code>pos</code> escolhido para ver as marcas.</p>
<table><thead><tr><th>pos</th><th>Nome</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    return shell(`pePI — ${context}`, meta, body);
  }

  if (!result.resultados.length) {
    return shell(`pePI — ${context}`, meta, `<section><p>Nenhum resultado retornado pelo pePI para esta consulta.</p></section>`);
  }

  const rows = result.resultados
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.marca || "(sem marca)")}</td>
      <td>${escapeHtml(r.numeroProcesso)}</td>
      <td><span class="badge">${escapeHtml(r.situacao || "não informada")}</span></td>
      <td>${escapeHtml(r.titular || "")}</td>
      <td>${escapeHtml(r.classe || "")}</td>
      <td>${r.dataPrioridade ? escapeHtml(r.dataPrioridade) : ""}</td>
    </tr>`,
    )
    .join("\n");

  const body = `<section><table>
<thead><tr><th>Marca</th><th>Processo</th><th>Situação</th><th>Titular</th><th>Classe</th><th>Prioridade</th></tr></thead>
<tbody>${rows}</tbody>
</table></section>`;

  return shell(`pePI — ${context}`, meta, body);
}

export function renderProcessDetailHtml(detail: ProcessoDetalhe): string {
  const meta = `Processo ${escapeHtml(detail.numeroProcesso)} &middot; ${new Date().toLocaleString("pt-BR")}`;
  const parts: string[] = [];

  parts.push(
    `<section><table><tbody>
      ${detail.situacao ? `<tr><th>Situação</th><td>${escapeHtml(detail.situacao)}</td></tr>` : ""}
      ${detail.apresentacao ? `<tr><th>Apresentação</th><td>${escapeHtml(detail.apresentacao)}</td></tr>` : ""}
      ${detail.natureza ? `<tr><th>Natureza</th><td>${escapeHtml(detail.natureza)}</td></tr>` : ""}
      ${detail.procurador ? `<tr><th>Procurador</th><td>${escapeHtml(detail.procurador)}</td></tr>` : ""}
      ${detail.dataDeposito ? `<tr><th>Depósito</th><td>${escapeHtml(detail.dataDeposito)}</td></tr>` : ""}
      ${detail.dataConcessao ? `<tr><th>Concessão</th><td>${escapeHtml(detail.dataConcessao)}</td></tr>` : ""}
      ${detail.dataVigencia ? `<tr><th>Vigência</th><td>${escapeHtml(detail.dataVigencia)}</td></tr>` : ""}
    </tbody></table></section>`,
  );

  if (detail.classes.length) {
    const rows = detail.classes
      .map((c) => `<tr><td>${escapeHtml(c.classe)}</td><td>${escapeHtml(c.situacao)}</td><td>${escapeHtml(c.especificacao)}</td></tr>`)
      .join("\n");
    parts.push(`<section><h2>Classes de Nice</h2><table><thead><tr><th>Classe</th><th>Situação</th><th>Especificação</th></tr></thead><tbody>${rows}</tbody></table></section>`);
  }

  if (detail.titulares.length) {
    parts.push(`<section><h2>Titulares</h2><ul>${detail.titulares.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></section>`);
  }

  if (detail.peticoes.length) {
    const rows = detail.peticoes
      .map((p) => `<tr><td>${escapeHtml(p.protocolo)}</td><td>${escapeHtml(p.data)}</td><td>${escapeHtml(p.servico ?? "")}</td><td>${escapeHtml(p.cliente ?? "")}</td></tr>`)
      .join("\n");
    parts.push(`<section><h2>Petições</h2><table><thead><tr><th>Protocolo</th><th>Data</th><th>Serviço</th><th>Cliente</th></tr></thead><tbody>${rows}</tbody></table></section>`);
  }

  return shell(`pePI — Processo ${detail.numeroProcesso}${detail.marca ? ` (${detail.marca})` : ""}`, meta, parts.join("\n"));
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
}

export async function saveHtmlReport(html: string, filenameHint: string): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${slug(filenameHint) || "resultado"}-${timestamp}.html`;
  const path = join(OUTPUT_DIR, filename);
  await writeFile(path, html, "utf-8");
  return path;
}

export function getHtmlOutputDir(): string {
  return OUTPUT_DIR;
}
