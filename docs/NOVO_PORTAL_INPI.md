# Reconhecimento: novo portal de busca de marcas do INPI

Documento vivo, resultado de reconhecimento passivo em `https://servicos.busca.inpi.gov.br/marcas`
(11/09/2026), pedido pelo Leo pra avaliar como possível fonte futura pro `inpi-marcas-mcp-server`
e, mais amplamente, pro banco de marcas da Zorya. **Este servidor continua sobre o pePI** —
nenhum código muda por causa deste documento. Cada afirmação aqui remonta a uma captura de tela,
uma chamada de rede real, ou um teste feito e observado — onde não deu pra confirmar, está dito
explicitamente.

## O que é, hoje

- URL: `servicos.busca.inpi.gov.br/marcas` (frontend) + `api-servicos.busca.inpi.gov.br` (API).
- A própria página se declara **"Ambiente de homologação — versão de avaliação"**. Não é produção.
- Versão 2 (21/08/2026), dados atualizados em 07/07/2026, telas "Busca rápida" e "Busca", PT/ES/EN.
- **Roadmap oficial** (confirmado em
  [gov.br/inpi/pt-br/projetos-estrategicos/portal-de-servicos](https://www.gov.br/inpi/pt-br/projetos-estrategicos/portal-de-servicos),
  atualizado 29/08/2026):

  | Versão | Previsão | Entrega |
  |---|---|---|
  | v2 | ✅ concluída | cards/grid, busca estruturada, comparação de patentes, estatísticas |
  | v3 | 3º tri/2026 | **exportação CSV/XML/JSON, API oficial (padrão ST.96 da OMPI), login gov.br** |
  | v4 | 4º tri/2026 | Portal de Estatística, módulo RPI |
  | v5 | 2º tri/2027 | área autenticada do usuário |
  | v6-7 | 3º tri/2027 | finalização RPI e área do usuário |

  **A API mapeada abaixo é a interna da v2, não a oficial.** A oficial, documentada, com
  contrato de exportação, só chega na v3. Login também só chega na v5 — bate com o fato de a
  busca de hoje ser inteiramente pública, sem nenhum fluxo de autenticação encontrado.

## Arquitetura observada

- Frontend: SPA (bundle Vite, `assets/index-*.js`/`.css`). Sem `robots.txt` nem `sitemap.xml`
  reais — qualquer caminho cai no shell da SPA (não há regra de rastreamento a respeitar/violar).
- Backend de busca: subdomínio separado `api-servicos.busca.inpi.gov.br`, servidor `gunicorn`
  (Python). Formato de request/response bate com **Elastic Search UI / App Search**
  (`queryConfig`, `facets`, `result_fields`, `state.searchTerm/resultsPerPage/current`) —
  sugere Elasticsearch por trás, não um banco relacional raspado feito o pePI.
- `Access-Control-Allow-Origin` das respostas aponta pra `https://busca-prd.inpi.gov.br` — um
  domínio de **produção que hoje não resolve publicamente** (`curl` dá falha de DNS). Indício de
  que existe (ou está planejado) um ambiente de produção separado do de homologação.

## Endpoint de busca: `POST /api/trademarks/search`

**Sem autenticação. Funciona chamado direto, fora do navegador — testado com `curl` puro, sem
cookie, sem token, sem header especial além de `Content-Type: application/json`.** Isso é o
teste decisivo pra "dá pra consultar em massa": dá.

- **Velocidade medida**: ~250ms por chamada (4 amostras). Pra comparação, o pePI leva de poucos
  segundos a ~90s sob carga (medido no repo deste projeto). Ordem de grandeza mais rápido.
- **Limite de taxa**: nenhum sinal (`429`, `Retry-After`) em 4 chamadas espaçadas ~1,5s.
  **Amostra pequena — não prova ausência de limite em volume real** (centenas/milhares de
  chamadas). Não testado além disso por decisão de não martelar um ambiente de homologação de
  governo sem necessidade.
- **Schema do resultado** (28+ campos observados, request com `result_fields` completo):
  `mark_name`, `process_number`, `id`/`id_internal`, `status`, `presentation_code`/`presentation_text`,
  `nature_code`/`nature_text`, `country_code`, `filing_date`, `grant_date`, `publication_date`,
  `received_inpi_date`, `validity_date`, `caducity_date`, `post_deadline_status_date`,
  `last_update`, `holders[]` (`name`, `cnpj`, `person_type`, `pfpj_id`), `procurator`
  (mesma forma), `specifications[]` (`nice_class_code`, `nice_class_description`, `text`),
  `vienna_classification[]`, `priority_claims[]` (`local_code`, `priority_date`,
  `priority_number`), `international_registration`, `mark_translation`, `classification_code`,
  `dispatches[]` (despacho completo: código, descrição, texto público em HTML, protocolo, nº da
  RPI, data de publicação — o histórico que no pePI só vem no detalhe, aqui já vem na busca).

### CNPJ — confiável pra pessoa jurídica

`holders[].cnpj` e `procurator.cnpj` vêm preenchidos de forma confiável quando `person_type` é
`"J"` (pessoa jurídica) — testado com "SILVA" (13/20 titulares com CNPJ) e "OLIVEIRA" (9/20).
Fica `null` corretamente quando o titular é estrangeiro sem CNPJ (ex: GOOGLE LLC) — não é gap,
é realidade (empresa americana não tem CNPJ).

### CPF — não existe no schema

Testado com titular pessoa física real (`MARCO ANTONIO MARQUES FELIX`, `person_type: "F"`):
`cnpj` vem `null`, e **não existe nenhum campo `cpf` em lugar nenhum do schema**. Pessoa física
não tem identificador pessoal exposto por esta API — provavelmente decisão de privacidade
(LGPD: CPF é dado pessoal sensível, CNPJ é registro público de empresa), não falha de captura.
**Esta fonte não resolve o gap de CPF do banco.**

### Achado colateral: qualidade de dado da própria fonte

Buscando "GOOGLE" apareceu um resultado com titular `"GOOGLE LLC"` marcado como
`person_type: "F"` (pessoa física) — claramente errado, é uma empresa. Bug de rotulagem na
própria base do INPI, não do nosso lado. Relevante pra quem for usar `person_type` como filtro
confiável: não é 100%.

### E-mail / telefone — ausentes

Não aparecem em nenhum dos 28+ campos testados. **Esta fonte não ajuda com e-mail nem telefone**
— isso continua dependendo de outra base (ex: Receita Federal, já registrada como pendência
separada na memória do projeto).

## Imagem da marca: `GET /api/v1/images/trademarks/{process_number}`

Dois passos, não um:
1. `GET .../images/trademarks/{process_number}` devolve um JSON pequeno — um array de caminho,
   ex: `["/public/img/9c36cf23-a375-4b2c-8027-bb0eaa2b1f76"]`. **Precisa do header `Referer`**
   (`https://servicos.busca.inpi.gov.br/`) — sem ele, a chamada trava sem responder (timeout,
   não erro explícito). A busca principal não precisa desse header; a imagem precisa.
2. `GET {mesma origem}/public/img/{uuid}` devolve o binário — confirmado JPEG real (magic bytes
   `ffd8ff...`), 3.993 bytes no caso testado, sem autenticação nenhuma além do `Referer`.

## Frescor do dado: pePI está na frente, agora

O portal novo declara "Dados atualizados em: 07/07/2026". O pePI, consultado na mesma sessão
pro mesmo processo (GOOGLE, prioridade unionista), declara **"Dados atualizados até 08/09/2026"**
(RPI 2905) — mais de dois meses mais recente. Contraintuitivo (é o sistema novo que devia estar
na frente), mas medido, não suposto. Faz sentido pra um ambiente de homologação: provavelmente
sincronizado de um snapshot, não em tempo real com a base de produção.

## O que NÃO foi mapeado ainda

- Mecanismo de login (não encontrado — coerente com o roadmap, login só chega na v5).
- Botão "Ajuda" (conteúdo não inspecionado).
- Mecanismo de troca de idioma PT/ES/EN (parâmetro? cookie? não verificado).
- Campos da tela "Busca" avançada (filtros disponíveis, comparação com o pePI).
- Botão de exportação (a v2 não deveria ter — exportação é prometida só na v3).

Nada disso bloqueia o achado principal. Ficam como próximo passo se for do interesse do Leo.

## Comparação direta com o pePI

| | pePI | Portal novo (homologação, v2) |
|---|---|---|
| Formato | HTML servido, raspagem | JSON (Elasticsearch) |
| Autenticação p/ buscar | Login pePI obrigatório | Nenhuma |
| Velocidade medida | segundos a ~90s sob carga | ~250ms |
| CNPJ do titular | Não vem na busca nem no detalhe | Vem na busca, confiável p/ pessoa jurídica |
| CPF do titular | Não exposto | Não exposto (schema não tem o campo) |
| E-mail/telefone | Não exposto | Não exposto |
| Histórico de despachos | Só no detalhe | Já vem na própria busca |
| Imagem da marca | Servlet autenticado | Endpoint público (2 passos + `Referer`) |
| Frescor medido (mesmo processo) | 08/09/2026 | 07/07/2026 |
| Estabilidade/contrato | Sistema de produção, sem SLA formal | Homologação, sem contrato, API não documentada |
| Suporte oficial a export/API | Não | Prometido pra v3 (3º tri/2026) |

## Recomendação

**Não migrar nem construir cliente novo em cima disso agora.** Três motivos, medidos, não
supostos: (1) é ambiente de homologação, sem contrato de estabilidade; (2) a API oficial
documentada — a que faz sentido depender pra produção — tem data prevista, 3º trimestre de 2026,
poucos meses; (3) o dado está mais desatualizado que o pePI hoje.

**Vale como fonte de enriquecimento pontual, testada com cautela, pro que ela cobre bem**: CNPJ
de titular pessoa jurídica, em volume, rápido — isso é real e testado. Não serve pra CPF, e-mail
ou telefone. Se o Leo quiser seguir essa frente antes da v3 oficial, é decisão dele — o risco
técnico (API não documentada, pode mudar) é dele assumir conscientemente, não algo a decidir
por conta própria.
