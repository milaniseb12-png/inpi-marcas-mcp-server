import axios, { AxiosInstance, AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { LOGIN_URL, MARCAS_URL, MIN_REQUEST_INTERVAL_MS, REQUEST_TIMEOUT_MS } from "./constants.js";

export class PepiAuthError extends Error {}

/**
 * Client for the official Brazilian INPI trademark search system (pePI).
 * Holds one login session (cookie jar) per instance and re-authenticates
 * transparently if the session expires mid-use.
 */
export class PepiClient {
  private http: AxiosInstance;
  private loggedIn = false;
  private lastRequestAt = 0;

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {
    const jar = new CookieJar();
    // axios-cookiejar-support publica tipos contra uma faixa de versao do axios; a estrutura
    // muda o suficiente entre minors pra dar erro de tipo mesmo com JS 100% compativel em runtime.
    this.http = wrapper(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (axios as any).create({
        jar,
        withCredentials: true,
        timeout: REQUEST_TIMEOUT_MS,
        // o pePI redireciona bastante entre login e busca; seguir redirects e checar
        // depois se voltamos pra tela de login e' mais simples que tentar prever cada rota.
        maxRedirects: 5,
        // o pePI declara "charset=ISO-8859-1" no Content-Type, mas o axios sempre decodifica
        // resposta de texto como UTF-8 — corrompe todo acento. Pega os bytes crus aqui e
        // decodifica certo em cada chamada (ver decodeLatin1 abaixo).
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "inpi-marcas-mcp-server (+https://github.com)",
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    ) as unknown as AxiosInstance;
  }

  /** Espaca as chamadas pro pePI pra nao martelar um servico de governo sem API oficial. */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }

  private decodeLatin1(res: AxiosResponse): string {
    const data = res.data as ArrayBuffer | Buffer;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return buf.toString("latin1");
  }

  private looksLikeLoginPage(html: string): boolean {
    return html.includes('name="T_Login"') && html.includes('name="T_Senha"');
  }

  async login(): Promise<void> {
    await this.throttle();
    const params = new URLSearchParams({
      T_Login: this.username,
      T_Senha: this.password,
      action: "login",
      Usuario: "",
    });
    const res = await this.http.post(LOGIN_URL, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (this.looksLikeLoginPage(this.decodeLatin1(res))) {
      throw new PepiAuthError(
        "Login no pePI falhou. Confira INPI_USERNAME e INPI_PASSWORD (mesmo login do site oficial busca.inpi.gov.br/pePI).",
      );
    }
    this.loggedIn = true;
  }

  private async ensureSession(): Promise<void> {
    if (!this.loggedIn) {
      await this.login();
    }
  }

  /** POST autenticado ao MarcasServletController, com um retry de login se a sessao caiu. */
  async postMarcas(fields: Record<string, string>): Promise<string> {
    await this.ensureSession();
    await this.throttle();
    const params = new URLSearchParams(fields);
    const res = await this.http.post(MARCAS_URL, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    let html = this.decodeLatin1(res);
    if (this.looksLikeLoginPage(html)) {
      // sessao expirou no meio do caminho: loga de novo e tenta uma unica vez a mais
      this.loggedIn = false;
      await this.ensureSession();
      await this.throttle();
      const retry = await this.http.post(MARCAS_URL, params, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      html = this.decodeLatin1(retry);
      if (this.looksLikeLoginPage(html)) {
        throw new PepiAuthError("Sessao do pePI caiu e o login novamente nao restabeleceu acesso.");
      }
    }
    return html;
  }

  async getMarcas(query: Record<string, string>): Promise<string> {
    await this.ensureSession();
    await this.throttle();
    const res = await this.http.get(MARCAS_URL, { params: query });
    let html = this.decodeLatin1(res);
    if (this.looksLikeLoginPage(html)) {
      this.loggedIn = false;
      await this.ensureSession();
      await this.throttle();
      const retry = await this.http.get(MARCAS_URL, { params: query });
      html = this.decodeLatin1(retry);
      if (this.looksLikeLoginPage(html)) {
        throw new PepiAuthError("Sessao do pePI caiu e o login novamente nao restabeleceu acesso.");
      }
    }
    return html;
  }
}
