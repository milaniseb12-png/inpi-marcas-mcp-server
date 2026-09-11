# inpi-marcas-mcp-server

Servidor [MCP](https://modelcontextprotocol.io) para a busca **oficial** de marcas do INPI
(pePI, `busca.inpi.gov.br/pePI`) — o mesmo sistema público que qualquer pessoa usa no
navegador, só que disponível como ferramenta para Claude e outros agentes de IA.

Cada usuário entra com o **próprio login do pePI** (gratuito, cadastro em
[gov.br/inpi/cadastro-no-e-inpi](https://www.gov.br/inpi/pt-br/cadastro-no-e-inpi)). Este
servidor não guarda, expõe nem compartilha credencial nenhuma — cada instância roda local,
autenticada como você.

**Projeto independente, sem vínculo oficial com o INPI.** Automatiza o mesmo formulário que
existe no site público; não é um canal alternativo, não pula fila nem burla limite nenhum.

## O que dá pra fazer

| Ferramenta | Para quê |
|---|---|
| `inpi_search_by_process_number` | Achar um processo pelo número, GRU, protocolo ou inscrição internacional (Madri) |
| `inpi_search_by_mark` | Buscar marca por texto, exata ou por radical |
| `inpi_search_by_mark_advanced` | Busca booleana/fuzzy, filtro por apresentação, natureza e "Pedidos Vivos" |
| `inpi_search_by_owner` | Levantar o portfólio de marcas de um titular (CNPJ/CPF ou nome) |
| `inpi_search_by_figurative_code` | Buscar marcas figurativas pelo Código de Viena |
| `inpi_next_page` | Paginar um resultado grande |
| `inpi_get_process_detail` | Ficha completa: classes, titulares, procurador, datas, prioridade unionista, petições |

## Instalação

```bash
git clone https://github.com/<seu-usuario>/inpi-marcas-mcp-server.git
cd inpi-marcas-mcp-server
npm install
npm run build
```

Configure o login no `claude_desktop_config.json` (ou equivalente do seu cliente MCP):

```json
{
  "mcpServers": {
    "inpi-marcas": {
      "command": "node",
      "args": ["/caminho/completo/para/inpi-marcas-mcp-server/dist/index.js"],
      "env": {
        "INPI_USERNAME": "seu_login_pepi",
        "INPI_PASSWORD": "sua_senha_pepi"
      }
    }
  }
}
```

Veja `.env.example` se preferir rodar localmente com `npm run dev` durante o desenvolvimento.

## Limites (os mesmos do pePI, não deste servidor)

O pePI é um sistema de governo sem API oficial nem SLA. Este servidor espaça as chamadas
(~1 por segundo) para não martelar um serviço público além do que uma pessoa navegando
manualmente faria. Não existe teto diário embutido aqui — o que existir é do lado do INPI.
Se o layout do site mudar, os parsers podem quebrar; abra uma issue com o HTML que veio,
sem incluir nenhuma credencial.

**Configure um timeout generoso no seu cliente MCP.** Medido sob carga: uma busca legítima
pode levar até ~70-90s pra voltar do pePI. O servidor já espera até 90s antes de desistir
(`REQUEST_TIMEOUT_MS`), mas o SDK do MCP tem o próprio timeout do lado do **cliente**
(padrão de 60s) — se ele for igual ou menor que o do servidor, o cliente desiste antes do
servidor ter chance de responder, mesmo quando o pePI ia responder com sucesso. Configure pelo
menos 120s por chamada (`{ timeout: 120_000 }` na opção `RequestOptions` do `callTool`, se você
estiver integrando via SDK TypeScript — veja `test/e2e.mjs` para um exemplo).

## O que este servidor NÃO é

Ele só espelha a busca pública do pePI: dado que qualquer pessoa já acessa de graça,
formatado para um agente de IA ler. Não faz jurimetria, não cruza fonte, não monitora
colidência ao longo do tempo, não analisa risco. Quem quiser isso de forma pronta,
sem precisar orquestrar ferramenta nenhuma, é o que o **[INCISO](https://inciso.com.br)**
faz — plataforma de inteligência de marca construída em cima do acervo completo de RPIs
do INPI, não só da busca ao vivo.

## Fronteira jurídica: anterioridade × colidência

As ferramentas de busca fazem **busca de anterioridade** — mostram o que já está registrado
ou em processo, hoje, no pePI. Isso **não é** uma **análise de colidência**: colidência avalia
semelhança gráfica, fonética, ideológica e afinidade mercadológica entre sinais, conforme o
item 5.11 do [Manual de Marcas do INPI](https://manualdemarcas.inpi.gov.br/projects/manual-de-marcas-3-edicao-6-revisao-20-08-2024/wiki/5%C2%B711_An%C3%A1lise_do_requisito_da_disponibilidade_do_sinal_marc%C3%A1rio),
e exige avaliação humana (idealmente de advogado especialista em PI). Toda resposta de busca
traz esse aviso, e `structuredContent` nunca inclui um veredito de "pode registrar" — só o dado
bruto do pePI, mais uma classificação auxiliar (ver abaixo).

## Proveniência e situação operacional

Todo `structuredContent` (de busca ou de detalhe) traz um campo `proveniencia` — `fonte`,
`urlConsulta` e `consultadoEm` (ISO 8601) — pra dar rastreabilidade: de onde e quando aquele
dado específico veio, útil pra quem precisa auditar ou anexar a um parecer.

Cada resultado também traz `situacaoOperacional` — uma classificação (`registro_vigente`,
`registro_extinto`, `pedido_em_andamento`, `pedido_arquivado`, `pedido_indeferido`,
`indeterminado`) derivada por **padrão de texto** sobre o campo bruto `situacao` do pePI. Não é
exaustiva nem tem valor jurídico próprio — o pePI é sistema legado sem enum fechado de status,
então isso é conveniência de filtro, não fonte de verdade. O campo `situacao` bruto continua
disponível e é sempre a referência final.

## Formato da resposta

Cada ferramenta devolve **duas coisas na mesma chamada**: um `content` em texto (Markdown,
pra ler direto) e um `structuredContent` com os mesmos dados em JSON (pra outro programa
processar). Isso é o padrão do protocolo MCP e não muda.

Além disso, toda ferramenta de busca e a de detalhe aceitam `salvar_html: true` — aí, **além**
do Markdown e do JSON, o servidor também escreve um relatório HTML autocontido (tabela, sem
depender de MCP nem de internet pra abrir) em `~/inpi-marcas-mcp-server/relatorios/` (ou em
`INPI_HTML_DIR`, se definido), e devolve o caminho do arquivo na resposta.

## Cache local

Toda busca (exceto `inpi_next_page`, que depende da sessão do servidor do pePI) passa primeiro
por um cache em disco — `~/.cache/inpi-marcas-mcp-server/` por padrão, configurável em
`INPI_CACHE_DIR`. A mesma busca repetida dentro de `INPI_CACHE_TTL_HORAS` (padrão: 6h) volta
instantânea, sem chamada nenhuma ao pePI. Use `forcar_atualizacao: true` em qualquer ferramenta
pra ignorar o cache e ir direto ao pePI ao vivo. `INPI_CACHE_TTL_HORAS=0` desliga o cache.

Isso existe pra não martelar um sistema de governo sem SLA com a mesma pergunta de novo — e
pra deixar buscas repetidas (ex: um agente checando a mesma marca em turnos diferentes de uma
conversa) instantâneas.

## Evidência bruta

`salvar_html: true` gera um relatório **legível** — bom pra humano ler, mas é uma tabela
formatada por nós, sem o HTML original, sem as imagens. Pra prova de marca de verdade —
sobretudo mista/figurativa, onde a imagem *é* o dado — isso não basta. Regra: **parser é
conveniência; snapshot completo é evidência.**

Toda ferramenta de busca e a de detalhe também aceitam `salvar_evidencia: true`, que grava um
pacote completo em `~/inpi-marcas-mcp-server/evidencias/` (ou `INPI_EVIDENCE_DIR`):

```text
evidencias/<contexto>-<timestamp>/
  manifest.json     # URL original, sha256, tamanho e content-type de cada arquivo; falha nunca some
  raw.html           # exatamente o que o pePI devolveu, sem edição nenhuma
  snapshot.html       # cópia reescrita pra abrir offline, sem pedir nada de rede
  assets/<sha256>.<ext>  # cada imagem/CSS baixado, nomeado pelo próprio hash
```

`structuredContent.proveniencia.evidencia` aponta pros caminhos (não duplica o conteúdo dentro
do JSON). Escopo dos assets: só **mesma origem** (`busca.inpi.gov.br`) — é o que compõe a prova
em si (logo/figura da marca, estilo da página); script de terceiro ou CDN externo não entra, pra
não inflar o pacote com o que não é o dado.

`salvar_evidencia: true` sempre vai ao pePI ao vivo (ignora o cache), porque a evidência precisa
do HTML da requisição real — um resultado servido do cache não carrega o HTML bruto consigo.

**Limite conhecido do "offline":** `snapshot.html` reescreve `src`/`href`/`url(...)` estáticos
(imagem, CSS) pros arquivos locais, e neutraliza `<script src>` de mesma origem — mas o pePI é
HTML legado com alguns efeitos de rollover via `onmouseover`/`onmouseout` inline (ex: um ícone
decorativo "Fale Conosco" no rodapé) que trocam o `src` de volta pro domínio real no hover.
Reescrever string dentro de JS arbitrário com segurança é um problema maior que o valor de
corrigir um ícone decorativo que não é dado de marca — o conteúdo evidencial (imagem/dado da
marca) sempre fica local; só esse tipo pontual de elemento decorativo pode tentar uma chamada de
rede se o usuário passar o mouse em cima.

## Desenvolvimento

```bash
npm run dev     # roda com tsx, recarrega ao salvar
npm run build   # compila pra dist/
```

Testar com o [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Teste de ponta a ponta de verdade — sobe o servidor compilado, conecta como um cliente MCP
conectaria (stdio + JSON-RPC, não a lógica interna direto) e faz uma busca real contra o pePI:

```bash
INPI_USERNAME=seu_login INPI_PASSWORD=sua_senha npm run test:e2e
```

Faz chamada de rede de verdade contra um sistema de governo sem SLA — se der timeout uma vez,
rode de novo antes de abrir issue.

CI (`.github/workflows/ci.yml`) roda `typecheck`, `build` e `npm audit` a cada push/PR —
**não** roda `test:e2e`, porque isso exigiria uma credencial pessoal do pePI como secret de
CI pública, o que não faz sentido pedir de quem for contribuir. Rode `npm run test:e2e`
localmente com sua própria credencial antes de abrir um PR.

## Segurança

Veja [SECURITY.md](./SECURITY.md) para a postura de credenciais — resumo: a senha nunca sai
do seu processo local, nunca é logada, nunca é gravada em disco (nem no cache, nem no relatório
HTML).

## Limitações conhecidas

- **Cobertura de teste é e2e ao vivo, não fixtures.** `test/e2e.mjs` prova as 7 ferramentas
  contra o pePI real, mas não tem um conjunto de HTMLs salvos (marca com/sem prioridade
  unionista, processo extinto, arquivado, indeferido, busca avançada em grade de cartões etc.)
  pra testar os parsers offline, rápido e sem depender do pePI estar de pé. Fica como próximo
  passo — vale mais que crescer superfície de ferramenta nova agora.
- **Não fiz plano de migração pra um "novo portal" do INPI.** Existe uma URL
  `servicos.busca.inpi.gov.br` que parece ser uma interface nova do INPI, mas é uma SPA
  (JavaScript), não dá pra confirmar por fetch simples se é uma busca de marcas, se está em
  produção, ou se substitui o pePI. Não construí abstração de fonte em cima disso sem verificar
  — se alguém confirmar que é estável e substitui o pePI, abra uma issue com a evidência.

## Licença

MIT — veja [LICENSE](./LICENSE). Use, modifique, redistribua. Só não venda como se fosse
canal oficial do INPI, porque não é.
