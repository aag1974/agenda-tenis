// HTTP-only client for Tênis Integrado — keeps a cookie jar across requests.
// Replaces the Puppeteer-based scraper to keep memory/binary size small.

const BASE = 'https://www.tenisintegrado.com.br';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

export class TIClient {
  constructor() {
    this.cookies = new Map(); // name -> value
    this.athleteId = null;
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  saveCookies(setCookieHeaders) {
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
    for (const sc of list) {
      if (!sc) continue;
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  async request(url, { method = 'GET', body, headers = {}, follow = true, maxRedirects = 5 } = {}) {
    const fullUrl = url.startsWith('http') ? url : BASE + url;
    const h = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      ...headers,
    };
    const cookies = this.cookieHeader();
    if (cookies) h['Cookie'] = cookies;
    const res = await fetch(fullUrl, { method, headers: h, body, redirect: 'manual' });
    // Save Set-Cookie
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.raw?.()?.['set-cookie'] || []);
    this.saveCookies(setCookies);

    // Follow redirect
    if (follow && [301, 302, 303, 307, 308].includes(res.status) && maxRedirects > 0) {
      const loc = res.headers.get('location');
      if (loc) {
        const nextUrl = new URL(loc, fullUrl).toString();
        // Body is dropped on 303 (POST → GET), we always GET on redirect for simplicity
        return this.request(nextUrl, { method: 'GET', follow: true, maxRedirects: maxRedirects - 1 });
      }
    }
    return res;
  }

  async getText(url, opts) {
    const res = await this.request(url, opts);
    if (!res.ok && res.status !== 0) {
      throw new Error(`GET ${url} retornou ${res.status}`);
    }
    return res.text();
  }

  async login(email, password) {
    // Hit login page first to get any session cookie
    await this.request('/login');
    const form = new URLSearchParams({ id_login: email, senha: password });
    const res = await this.request('/login/validar_login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': BASE + '/login' },
      body: form.toString(),
      follow: false,
    });
    // Successful login redirects (302) to /perfil2/inicio/{id}
    const loc = res.headers.get('location') || '';
    const m = loc.match(/\/perfil2\/(?:inicio|index)\/(\d+)/);
    if (!m) {
      // If not redirected, login may have failed
      const bodyText = await res.text().catch(() => '');
      const reason = /senha|inv[áa]lid/i.test(bodyText) ? 'credenciais inválidas' : `status ${res.status}, location=${loc}`;
      throw new Error(`Falha no login: ${reason}`);
    }
    this.athleteId = m[1];
    // Follow to load any session state
    await this.request(loc);
    return { athleteId: this.athleteId };
  }
}
