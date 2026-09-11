import type { SituacaoOperacional } from "./situacao.js";

export interface MarcaResultRow {
  numeroProcesso: string;
  dataPrioridade: string | null;
  marca: string;
  situacao: string;
  situacaoOperacional: SituacaoOperacional;
  titular: string | null;
  classe: string | null;
  codPedido: string | null;
  urlDetalhe: string | null;
}

/**
 * Caminhos do pacote de evidência bruta (ver src/evidence.ts) — presente só quando a chamada
 * usou salvar_evidencia: true. Guarda só CAMINHOS aqui (não o conteúdo): o HTML/assets em si
 * ficam em disco, não duplicados dentro do JSON cacheado.
 */
export interface EvidenciaCaptura {
  manifestPath: string;
  rawHtmlPath: string;
  snapshotHtmlPath: string;
  rawHtmlSha256: string;
  assetsBaixados: number;
  assetsFalharam: number;
}

/**
 * De onde e quando o dado veio, para quem precisa auditar (não vale pra decisão jurídica,
 * vale pra rastreabilidade: "esse número veio de onde, quando?").
 */
export interface Proveniencia {
  fonte: "pePI (INPI oficial)";
  urlConsulta: string;
  consultadoEm: string;
  evidencia?: EvidenciaCaptura;
}

export interface TitularCandidato {
  nome: string;
  pos: number;
}

export interface SearchResult {
  totalEncontrado: number | null;
  paginaAtual: number;
  totalPaginas: number | null;
  resultados: MarcaResultRow[];
  aviso: string | null;
  /**
   * A busca por nome de titular (aproximada) e' em duas etapas no pePI: primeiro devolve os
   * nomes de titular que batem com o termo (esta lista), depois e' preciso escolher um "pos"
   * pra ver as marcas dele de verdade. Fica null quando a resposta ja' e' a lista de marcas.
   */
  titularesCandidatos: TitularCandidato[] | null;
  /** Ausente no retorno cru do parser; anexado pelo servidor MCP antes de responder/cachear. */
  proveniencia?: Proveniencia;
}

export interface ClasseNice {
  classe: string;
  situacao: string;
  especificacao: string;
}

export interface Peticao {
  protocolo: string;
  data: string;
  servico: string | null;
  cliente: string | null;
}

export interface ProcessoDetalhe {
  numeroProcesso: string;
  marca: string | null;
  situacao: string | null;
  situacaoOperacional: SituacaoOperacional;
  apresentacao: string | null;
  natureza: string | null;
  classes: ClasseNice[];
  titulares: string[];
  procurador: string | null;
  dataDeposito: string | null;
  dataConcessao: string | null;
  dataVigencia: string | null;
  prioridadeUnionista: { numero: string; pais: string; data: string } | null;
  peticoes: Peticao[];
  /** Ausente no retorno cru do parser; anexado pelo servidor MCP antes de responder/cachear. */
  proveniencia?: Proveniencia;
}
