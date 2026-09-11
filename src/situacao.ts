/**
 * Classificação operacional da situação de um processo, derivada do texto livre que o pePI
 * devolve no campo "Situação". O pePI não tem um enum fechado — é texto de sistema legado,
 * então esta classificação é por padrão observado, NÃO exaustiva. A situação bruta do pePI é
 * sempre a fonte de verdade; isto existe só para facilitar filtro/leitura programática.
 *
 * Não calcula vigência a partir da LPI art. 133 (10 anos da concessão, prorrogável) porque o
 * próprio pePI já devolve a data de vigência corrente em "Datas" — computar de novo por conta
 * própria arriscaria divergir da fonte sem necessidade.
 */
export type SituacaoOperacional =
  | "registro_vigente"
  | "registro_extinto"
  | "pedido_em_andamento"
  | "pedido_arquivado"
  | "pedido_indeferido"
  | "indeterminado";

export const RESSALVA_SITUACAO_OPERACIONAL =
  "situacaoOperacional é uma classificação por padrão de texto sobre o campo bruto 'situacao' do pePI, cobrindo os casos mais comuns observados — não é exaustiva nem tem valor jurídico próprio. Em caso de dúvida, confira o campo 'situacao' bruto e, se necessário, a fonte oficial.";

const PATTERNS: [RegExp, SituacaoOperacional][] = [
  [/registro.*(em vigor|prorrogad)/i, "registro_vigente"],
  [/registro.*(extint|caduc)/i, "registro_extinto"],
  [/inexistente/i, "pedido_arquivado"],
  [/arquivad/i, "pedido_arquivado"],
  [/indeferid/i, "pedido_indeferido"],
  [/(em exame|oposi[çc][ãa]o|publica|deferid|recurso|sobrestad|liberar|aguardando|petição pendente)/i, "pedido_em_andamento"],
];

export function classificarSituacao(situacaoBruta: string | null | undefined): SituacaoOperacional {
  if (!situacaoBruta) return "indeterminado";
  for (const [pattern, resultado] of PATTERNS) {
    if (pattern.test(situacaoBruta)) return resultado;
  }
  return "indeterminado";
}
