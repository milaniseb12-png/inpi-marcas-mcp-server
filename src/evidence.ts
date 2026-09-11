import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { PEPI_BASE_URL } from "./constants.js";
import type { PepiClient } from "./client.js";

/**
 * Captura de EVIDÊNCIA bruta — diferente do relatório HTML (htmlExport.ts), que é conveniência
 * de leitura. Aqui o objetivo é auditoria/prova: o HTML original tal como veio do pePI, uma
 * cópia reescrita pra abrir offline com as imagens/CSS locais, e um manifest com hash de cada
 * arquivo. "Parser é conveniência; snapshot completo é evidência" — regra do Leo, 11/09/2026.
 *
 * Escopo dos assets: só MESMA ORIGEM (busca.inpi.gov.br). É o que compõe a prova em si
 * (logo/figura da marca, estilo da página); script de terceiro ou CDN externo não faz parte do
 * dado e só infla o pacote.
 */

const EVIDENCE_DIR = process.env.INPI_EVIDENCE_DIR ?? join(homedir(), "inpi-marcas-mcp-server", "evidencias");

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/webp": ".webp",
  "text/css": ".css",
};

interface AssetManifestEntry {
  urlOriginal: string;
  path: string | null;
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  sha256: string | null;
  ok: boolean;
  erro?: string;
}

export interface EvidenciaCaptura {
  manifestPath: string;
  rawHtmlPath: string;
  snapshotHtmlPath: string;
  rawHtmlSha256: string;
  assetsBaixados: number;
  assetsFalharam: number;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(PEPI_BASE_URL).origin;
  } catch {
    return false;
  }
}

function resolveUrl(ref: string, baseUrl: string): string | null {
  try {
    return new URL(ref, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractCssUrls(css: string): string[] {
  const urls: string[] = [];
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) urls.push(m[1]);
  return urls;
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

export async function captureEvidence(
  client: PepiClient,
  html: string,
  requestUrl: string,
  contextoHint: string,
): Promise<EvidenciaCaptura> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(EVIDENCE_DIR, `${slug(contextoHint) || "captura"}-${timestamp}`);
  const assetsDir = join(dir, "assets");
  await mkdir(assetsDir, { recursive: true });

  const $ = cheerio.load(html);

  // 1. coleta toda referência de asset, resolvida pra URL absoluta, só mesma origem
  const refs = new Set<string>();
  $("img[src]").each((_, el) => {
    const v = $(el).attr("src");
    if (v) refs.add(v);
  });
  $("img[srcset]").each((_, el) => {
    const v = $(el).attr("srcset");
    if (v) for (const part of v.split(",")) { const u = part.trim().split(/\s+/)[0]; if (u) refs.add(u); }
  });
  $("link[rel='stylesheet'][href]").each((_, el) => {
    const v = $(el).attr("href");
    if (v) refs.add(v);
  });
  $("style").each((_, el) => { for (const u of extractCssUrls($(el).text())) refs.add(u); });
  $("[style]").each((_, el) => { for (const u of extractCssUrls($(el).attr("style") ?? "")) refs.add(u); });

  const resolvedByRef = new Map<string, string>(); // referência como está no HTML -> URL absoluta
  for (const ref of refs) {
    const abs = resolveUrl(ref, requestUrl);
    if (abs && isSameOrigin(abs)) resolvedByRef.set(ref, abs);
  }

  // 2. baixa cada asset (dedup por URL absoluta) — falha vira entrada "ok: false", nunca some
  const byAbsUrl = new Map<string, AssetManifestEntry & { localRel: string | null }>();
  for (const abs of new Set(resolvedByRef.values())) {
    try {
      const { data, contentType, status } = await client.getBinary(abs);
      if (status < 200 || status >= 300) {
        byAbsUrl.set(abs, { urlOriginal: abs, path: null, status, contentType, bytes: null, sha256: null, ok: false, erro: `HTTP ${status}`, localRel: null });
        continue;
      }
      const hash = sha256Hex(data);
      const ext = EXT_BY_CONTENT_TYPE[contentType.split(";")[0].trim()] ?? "";
      const filename = `${hash}${ext}`;
      await writeFile(join(assetsDir, filename), data);
      const localRel = `assets/${filename}`;
      byAbsUrl.set(abs, { urlOriginal: abs, path: localRel, status, contentType, bytes: data.length, sha256: hash, ok: true, localRel });
    } catch (err) {
      byAbsUrl.set(abs, {
        urlOriginal: abs,
        path: null,
        status: null,
        contentType: null,
        bytes: null,
        sha256: null,
        ok: false,
        erro: err instanceof Error ? err.message : String(err),
        localRel: null,
      });
    }
  }

  // 3. reescreve uma cópia do HTML apontando pros assets locais (o raw.html original fica intocado)
  $("img[src]").each((_, el) => {
    const abs = resolvedByRef.get($(el).attr("src") ?? "");
    const local = abs ? byAbsUrl.get(abs)?.localRel : undefined;
    if (local) $(el).attr("src", local);
  });
  // srcset com múltiplas URLs+descritor fica ambíguo de reescrever com segurança; o "src" já
  // reescrito acima cobre a imagem principal offline, então só removemos o srcset original.
  $("img[srcset]").each((_, el) => { $(el).removeAttr("srcset"); });
  $("link[rel='stylesheet'][href]").each((_, el) => {
    const abs = resolvedByRef.get($(el).attr("href") ?? "");
    const local = abs ? byAbsUrl.get(abs)?.localRel : undefined;
    if (local) $(el).attr("href", local);
  });
  const rewriteCss = (css: string): string =>
    css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (full, ref) => {
      const abs = resolvedByRef.get(ref);
      const local = abs ? byAbsUrl.get(abs)?.localRel : undefined;
      return local ? `url(${local})` : full;
    });
  $("style").each((_, el) => { $(el).text(rewriteCss($(el).text())); });
  $("[style]").each((_, el) => { $(el).attr("style", rewriteCss($(el).attr("style") ?? "")); });

  // <script src="..."> não faz parte da evidência (não é dado da marca, é comportamento de
  // página — ex: JS decorativo da barra do governo) e por isso nunca é baixado como asset. Mas
  // deixar o atributo src apontando pro domínio real quebraria a promessa de "abre offline sem
  // pedir rede nenhuma": o navegador tentaria buscar o script mesmo sem internet. Neutraliza só
  // os de MESMA ORIGEM (script de terceiro real, se algum dia aparecer, fica intocado — não é
  // nosso escopo mexer nele de qualquer forma).
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    const abs = src ? resolveUrl(src, requestUrl) : null;
    if (abs && isSameOrigin(abs)) $(el).removeAttr("src");
  });

  const snapshotHtml = $.html();

  // 4. grava raw.html (intocado), snapshot.html (offline), manifest.json
  const rawHtmlSha256 = sha256Hex(Buffer.from(html, "utf-8"));
  const rawHtmlPath = join(dir, "raw.html");
  const snapshotHtmlPath = join(dir, "snapshot.html");
  const manifestPath = join(dir, "manifest.json");
  await writeFile(rawHtmlPath, html, "utf-8");
  await writeFile(snapshotHtmlPath, snapshotHtml, "utf-8");

  const assets = [...byAbsUrl.values()].map(({ localRel: _localRel, ...entry }) => entry);
  const assetsBaixados = assets.filter((a) => a.ok).length;
  const assetsFalharam = assets.filter((a) => !a.ok).length;

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        capturadoEm: new Date().toISOString(),
        contexto: contextoHint,
        urlConsulta: requestUrl,
        rawHtml: { path: "raw.html", sha256: rawHtmlSha256, bytes: Buffer.byteLength(html, "utf-8") },
        snapshotHtml: { path: "snapshot.html", bytes: Buffer.byteLength(snapshotHtml, "utf-8") },
        assets,
      },
      null,
      2,
    ),
    "utf-8",
  );

  return { manifestPath, rawHtmlPath, snapshotHtmlPath, rawHtmlSha256, assetsBaixados, assetsFalharam };
}

export function getEvidenceDir(): string {
  return EVIDENCE_DIR;
}
