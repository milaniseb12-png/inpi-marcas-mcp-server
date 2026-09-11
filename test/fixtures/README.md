# Corpus de fixtures dos parsers

HTML real do pePI, capturado ao vivo (não fabricado), um caso por competência do parser. Cada
pasta tem `raw.html` (a resposta exata do pePI) e `expected.json` (os fatos-chave que o parser
tem que extrair certo). Se um teste aqui quebrar, **o parser perdeu uma competência real**, não
é ruído — investigue antes de ajustar o `expected.json`.

Capturados com `scripts/capture-fixtures.mjs` + `scripts/capture-fixtures-round2.mjs` (exigem
credencial real; rode de novo se o pePI mudar de layout). `codPedido` não é durável entre
sessões de login — os dois scripts sempre buscam e usam o `codPedido` na mesma sessão, nunca
reaproveitam um valor de execução anterior.

## O que cada fixture guarda

- **`busca_basica_tabela_google`** — tabela de resultados da busca básica por marca, o formato
  mais comum. Mistura de situações reais (inclui uma linha cujo texto de situação não bate
  nenhum padrão conhecido — `situacaoOperacional` cai em `indeterminado` honestamente, não
  inventa uma classificação).
- **`busca_avancada_cards_com_imagem`** — busca por Código de Viena (marcas figurativas).
  **Nota de escopo:** o nome original pensado pra este caso era literalmente a "grade de
  cartões" da busca avançada, acionada pelo checkbox `ListaFigura=E` ("Formato de saída"). Essa
  combinação foi investigada e **produz um formato híbrido tabela+cartão diferente**, com um
  bug de extração de marca real (`814218245:` em vez do nome) — mas `ListaFigura` **não é**
  enviado por nenhuma chamada atual da ferramenta (removido junto do fix do bug de checkbox),
  então esse formato é inalcançável hoje. Em vez de consertar um parser pra um parâmetro que
  não existe, este fixture usa a busca por Viena, que é o caminho real e testado pra marcas
  figurativas — nomes reais extraídos corretamente.
- **`titular_desambiguacao`** — busca por titular (nome, sem CNPJ) devolve lista de candidatos
  com `pos`, não marcas direto — o fluxo de duas etapas.
- **`detalhe_registro_vigente_com_logo`** — marca mista (`apresentacao: "Mista"`), vigente, com
  imagem de verdade (asset baixável via `salvar_evidencia`).
- **`detalhe_pedido_em_andamento_sem_concessao`** — pedido ainda não concedido: seção "Datas"
  só tem Depósito, sem Concessão nem Vigência. Testa que o parser não quebra com campos
  ausentes nem inventa data.
- **`detalhe_sem_representante_legal`** — processo sem a seção "Representante Legal" (processo
  911366920, do próprio pedido usado antes como exemplo de `pedido_em_andamento`, mas titular
  pessoa física sem procurador registrado). **Este é o caso que expôs um bug real**: antes da
  correção, `directRows()` devolvia `null` de verdade quando a seção não existe, e
  `.each()`/`.first()` num `null` derrubava `inpi_get_process_detail` inteiro.
- **`detalhe_com_prioridade_unionista`** — seção "Prioridade Unionista" (prioridade de depósito
  estrangeiro pela Convenção de Paris). Processo GOOGLE 821480880, prioridade de pedido dos EUA.
- **`detalhe_madrid`** — processo com designação via Protocolo de Madri (registro
  internacional). SPOTIFY, processo 929169743 — achado numa varredura de marcas globais
  depositadas depois de 2019 (quando o Brasil aderiu ao Protocolo), confirmando menção a
  "Registro Internacional"/"OMPI" no HTML.
- **`detalhe_extinto_ou_arquivado`** — processo não mais ativo, `situacaoOperacional`
  classifica certo como `registro_extinto`.
- **`detalhe_peticoes_multilinha`** — seção "Petições" com várias linhas (5, no caso real: o
  histórico de prorrogação, mudança de procurador e alteração de nome do mesmo processo GOOGLE
  821480880 ao longo de mais de uma década).

## O que NÃO está aqui

Nenhum caso foi fabricado. Os 10 casos da lista original foram todos obtidos com espécime real
— nenhuma lacuna conhecida a registrar desta vez.
