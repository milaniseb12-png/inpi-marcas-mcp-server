export const PEPI_BASE_URL = "https://busca.inpi.gov.br/pePI";
export const LOGIN_URL = `${PEPI_BASE_URL}/servlet/LoginController`;
export const MARCAS_URL = `${PEPI_BASE_URL}/servlet/MarcasServletController`;

// Limite de resultados por pagina que o proprio pePI aceita (visto no <select name="registerPerPage">).
export const VALID_PAGE_SIZES = [20, 40, 60, 80, 100] as const;

// Tamanho maximo de resposta de texto por chamada, para nao estourar o contexto do agente.
export const CHARACTER_LIMIT = 20000;

// pePI e um sistema de producao do governo, sem SLA de API. Espacar chamadas evita bloqueio por IP
// e trata o servico com o mesmo cuidado que um humano navegando manualmente teria.
export const MIN_REQUEST_INTERVAL_MS = 1200;
// Medido: a maioria das buscas responde em poucos segundos, mas uma busca por código de
// Viena (27.5.1) chegou a levar 72s pra voltar com resultado real, não erro. 30s cortava
// consulta válida no meio.
export const REQUEST_TIMEOUT_MS = 60000;
