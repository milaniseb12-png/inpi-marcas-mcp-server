# Testando com o MCP Inspector

O [MCP Inspector](https://github.com/modelcontextprotocol/inspector) é uma UI web que fala o
protocolo MCP direto — dá pra chamar cada ferramenta, ver `content` e `structuredContent` lado
a lado, sem precisar configurar um cliente de verdade (Claude Desktop, etc.) primeiro. Use isso
antes de plugar o servidor em qualquer lugar, pra confirmar que o login funciona e que as
ferramentas respondem do jeito que você espera.

## Subir o Inspector

Compile o servidor primeiro (`npm run build`), depois:

```bash
INPI_USERNAME=seu_login_pepi INPI_PASSWORD=sua_senha npx @modelcontextprotocol/inspector node dist/index.js
```

**A env var precisa estar antes do comando**, na mesma linha — o Inspector sobe o servidor como
processo filho, então ele só recebe `INPI_USERNAME`/`INPI_PASSWORD` se estiverem no ambiente
*antes* dele iniciar (mesmo padrão usado em `test/e2e.mjs`). No PowerShell:

```powershell
$env:INPI_USERNAME="seu_login_pepi"; $env:INPI_PASSWORD="sua_senha"; npx @modelcontextprotocol/inspector node dist/index.js
```

Isso abre uma aba no navegador (`http://localhost:6274` por padrão).

## Primeiro teste

1. Na aba **Tools**, confirme que as 7 ferramentas aparecem (`inpi_search_by_process_number`,
   `inpi_search_by_mark`, `inpi_search_by_mark_advanced`, `inpi_search_by_owner`,
   `inpi_search_by_figurative_code`, `inpi_next_page`, `inpi_get_process_detail`).
2. Escolha `inpi_search_by_mark`, preencha `marca: "GOOGLE"`, `busca_exata: true`, execute.
3. Compare o painel **Result** (que mostra o `content` em Markdown) com o painel de JSON
   (`structuredContent`) — os dois vêm na mesma resposta, é o formato padrão de toda ferramenta
   aqui (ver README § Formato da resposta).
4. Se quiser ver evidência bruta de verdade, repita a chamada com `salvar_evidencia: true` e
   confira o caminho do `manifest.json` que volta na resposta.

## Timeout

O pePI é um sistema de governo sem SLA — uma busca legítima pode levar até ~90s sob carga (ver
README § Limites). O Inspector tem o próprio timeout de request nas configurações da sessão
(ícone de engrenagem); se uma chamada estourar antes de o pePI responder, aumente esse timeout
— o mesmo motivo pelo qual qualquer cliente MCP real precisa de um timeout generoso (documentado
no README, com o exemplo de `RequestOptions` usado em `test/e2e.mjs`).

## Erro de login

Se toda chamada devolver "Erro de autenticação no pePI", confira `INPI_USERNAME`/
`INPI_PASSWORD` — é o mesmo login que você usa em
[busca.inpi.gov.br/pePI](https://busca.inpi.gov.br/pePI). Não há credencial padrão; sem login
válido, nenhuma ferramenta funciona.

---

Este guia não foi testado clicando numa sessão real do Inspector neste ambiente (é UI
interativa em navegador) — os comandos e o comportamento vêm de flags documentadas do Inspector
e do comportamento já comprovado deste servidor via `test/e2e.mjs`. Se algo aqui não bater com
o que você vê na tela, abra uma issue.
