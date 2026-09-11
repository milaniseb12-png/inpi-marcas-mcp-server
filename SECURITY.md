# Postura de segurança

## Credencial

- `INPI_USERNAME`/`INPI_PASSWORD` são o **seu** login pessoal do pePI. Este servidor roda **local**, no seu processo — a credencial nunca sai da sua máquina, nunca é logada, nunca é enviada a nenhum serviço além de `busca.inpi.gov.br`.
- Nunca cole sua senha numa conversa com um agente de IA. `INPI_PASSWORD` deve vir de variável de ambiente ou de um `.env` local (já no `.gitignore`), nunca de texto solto.
- Nunca rode este servidor num host compartilhado ou multi-tenant com a credencial de outra pessoa configurada por padrão — cada instância é de um usuário.
- Se sua senha do pePI vazar por qualquer canal, troque-a em [busca.inpi.gov.br/pePI](https://busca.inpi.gov.br/pePI) imediatamente; este servidor não tem como revogar nem rotacionar nada por você.

## O que este servidor NÃO faz

- Não guarda a senha em disco (nem cache, nem log, nem relatório HTML).
- Não expõe a credencial em `structuredContent` nem em nenhuma resposta de ferramenta.
- Não faz scraping em massa: throttle de ~1 chamada/segundo, e o cache local existe justamente pra evitar repetir a mesma consulta contra o servidor do INPI.
- Não é um proxy de rede aberto — só fala com `busca.inpi.gov.br`.

## O que o cache/relatório/evidência grava em disco

`~/.cache/inpi-marcas-mcp-server/` (configurável via `INPI_CACHE_DIR`) guarda os **resultados** das buscas (o mesmo dado público que o pePI mostra), não a credencial. `~/inpi-marcas-mcp-server/relatorios/` (via `INPI_HTML_DIR`) guarda os relatórios HTML gerados com `salvar_html: true`, e `~/inpi-marcas-mcp-server/evidencias/` (via `INPI_EVIDENCE_DIR`) guarda o pacote de evidência bruta de `salvar_evidencia: true` — HTML original, cópia offline e imagens/CSS baixados do próprio pePI. Em todos os casos, só dado público de marca (o mesmo que qualquer pessoa vê navegando o pePI), nunca login nem cookie de sessão.

Todos os diretórios ficam fora do repositório e sob o seu usuário do sistema operacional; trate-os como qualquer outra pasta com dado de negócio, não como segredo, mas também não como algo público.

## Reportar um problema de segurança

Abra uma issue no repositório sem incluir nenhuma credencial, cookie de sessão ou dado pessoal de terceiro no relato.
