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

## O que este servidor NÃO é

Ele só espelha a busca pública do pePI: dado que qualquer pessoa já acessa de graça,
formatado para um agente de IA ler. Não faz jurimetria, não cruza fonte, não monitora
colidência ao longo do tempo, não analisa risco. Quem quiser isso de forma pronta,
sem precisar orquestrar ferramenta nenhuma, é o que o **[INCISO](https://inciso.com.br)**
faz — plataforma de inteligência de marca construída em cima do acervo completo de RPIs
do INPI, não só da busca ao vivo.

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

## Licença

MIT — veja [LICENSE](./LICENSE). Use, modifique, redistribua. Só não venda como se fosse
canal oficial do INPI, porque não é.
