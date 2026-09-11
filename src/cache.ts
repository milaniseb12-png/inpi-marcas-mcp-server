import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Cache local em disco pras 6 ferramentas de busca/detalhe (não pra inpi_next_page — a
 * paginação depende da "última busca" guardada na sessão do servidor do pePI, então uma
 * mesma chamada de next_page pode significar buscas diferentes; cachear por página só
 * daria resultado errado).
 *
 * Evita martelar um sistema de governo sem SLA com a mesma pergunta repetida, e deixa
 * buscas comuns instantâneas na segunda vez. TTL curto por padrão porque o acervo do INPI
 * muda (novo despacho, nova petição) — não é um dado estático.
 */

const CACHE_DIR = process.env.INPI_CACHE_DIR ?? join(homedir(), ".cache", "inpi-marcas-mcp-server");
const DEFAULT_TTL_HOURS = 6;
const TTL_MS = (Number(process.env.INPI_CACHE_TTL_HORAS) || DEFAULT_TTL_HOURS) * 60 * 60 * 1000;

/**
 * Sobe sempre que o FORMATO do que a gente guarda (os campos de SearchResult/ProcessoDetalhe)
 * muda de um jeito que o dado antigo em disco não teria — ex: adicionar `proveniencia` ou
 * `situacaoOperacional`. Sem isso, uma entrada gravada pela versão anterior do servidor volta
 * do cache faltando o campo novo, silenciosamente, até o TTL expirar sozinho (até 6h por
 * padrão). A versão entra no HASH da chave, então uma mudança aqui invalida tudo que existia
 * de forma automática (cache-miss limpo, nunca dado incompleto).
 *
 * v3: adiciona proveniencia.evidencia (opcional). Na prática só é preenchido quando o chamador
 * pede salvar_evidencia=true, o que já força ida ao pePI ao vivo (evidência bruta precisa do
 * HTML da requisição real, que não fica guardado no cache — só o resultado parseado fica) — um
 * cache-hit normal nunca teria esse campo de qualquer forma. Subida por precaução/disciplina,
 * não porque um cache antigo desse errado silenciosamente desta vez.
 */
const SCHEMA_VERSION = 3;

interface CacheEntry<T> {
  cachedAt: string;
  tool: string;
  params: Record<string, unknown>;
  result: T;
}

function cacheKey(tool: string, params: Record<string, unknown>): string {
  const normalized = JSON.stringify(params, Object.keys(params).sort());
  const hash = createHash("sha256").update(`v${SCHEMA_VERSION}:${tool}:${normalized}`).digest("hex").slice(0, 24);
  return hash;
}

async function ensureDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
}

export async function readCache<T>(tool: string, params: Record<string, unknown>): Promise<{ result: T; cachedAt: string } | null> {
  if (TTL_MS <= 0) return null;
  try {
    const path = join(CACHE_DIR, `${cacheKey(tool, params)}.json`);
    const raw = await readFile(path, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry<T>;
    const age = Date.now() - new Date(entry.cachedAt).getTime();
    if (age > TTL_MS) return null;
    return { result: entry.result, cachedAt: entry.cachedAt };
  } catch {
    return null;
  }
}

export async function writeCache<T>(tool: string, params: Record<string, unknown>, result: T): Promise<void> {
  if (TTL_MS <= 0) return;
  try {
    await ensureDir();
    const entry: CacheEntry<T> = { cachedAt: new Date().toISOString(), tool, params, result };
    const path = join(CACHE_DIR, `${cacheKey(tool, params)}.json`);
    await writeFile(path, JSON.stringify(entry), "utf-8");
  } catch {
    // cache e' conveniencia, nunca motivo pra falhar a busca real
  }
}

/** Apaga entradas mais velhas que o TTL. Roda espontaneamente, uma vez por processo. */
export async function pruneExpiredCache(): Promise<number> {
  if (TTL_MS <= 0) return 0;
  let removed = 0;
  try {
    const files = await readdir(CACHE_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const path = join(CACHE_DIR, file);
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > TTL_MS) {
        await unlink(path);
        removed++;
      }
    }
  } catch {
    // diretorio pode nao existir ainda
  }
  return removed;
}

export function getCacheDir(): string {
  return CACHE_DIR;
}

export function getCacheTtlMs(): number {
  return TTL_MS;
}
