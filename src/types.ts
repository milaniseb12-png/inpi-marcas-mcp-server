export interface MarcaResultRow {
  numeroProcesso: string;
  dataPrioridade: string | null;
  marca: string;
  situacao: string;
  titular: string | null;
  classe: string | null;
  codPedido: string | null;
  urlDetalhe: string | null;
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
}
