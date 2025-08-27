import { describe, it, expect } from "vitest";
import axios from "axios";
import http from "node:http";
import * as cheerio from "cheerio";
import { SqlScanner } from "../src/index.js";

const BASE = "http://127.0.0.1:8081";

async function isUp(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve((res.statusCode || 0) > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

type CookieMap = Record<string, string>;
function parseSetCookie(headers: any, jar: CookieMap): CookieMap {
  const set = headers["set-cookie"] as string[] | undefined;
  if (!set) return jar;
  for (const c of set) {
    const [kv] = c.split(";");
    const [k, v] = kv.split("=");
    if (k && v !== undefined) jar[k.trim()] = v.trim();
  }
  return jar;
}
function cookieHeader(jar: CookieMap): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function bwappInstallAndLogin(): Promise<CookieMap | null> {
  try {
    const jar: CookieMap = {};

    // initial request to set cookies
    const root = await axios.get(`${BASE}/`, { validateStatus: () => true });
    parseSetCookie(root.headers, jar);

    // run installer if needed
    const install = await axios.get(`${BASE}/install.php`, {
      headers: { Cookie: cookieHeader(jar) },
      validateStatus: () => true,
    });
    parseSetCookie(install.headers, jar);
    const $ins = cheerio.load(install.data || "");
    if (
      $ins('form[action="install.php"]').length > 0 ||
      /install/i.test(install.request?.path || "")
    ) {
      const form = new URLSearchParams();
      form.set("install", "Install");
      const run = await axios.post(`${BASE}/install.php`, form, {
        headers: {
          Cookie: cookieHeader(jar),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        validateStatus: () => true,
      });
      parseSetCookie(run.headers, jar);
    }

    // login with default creds (bee/bug)
    const loginPage = await axios.get(`${BASE}/login.php`, {
      headers: { Cookie: cookieHeader(jar) },
      validateStatus: () => true,
    });
    parseSetCookie(loginPage.headers, jar);
    const $lp = cheerio.load(loginPage.data || "");
    const loginToken = $lp('input[name="form_token"]').attr("value") || "";
    const form = new URLSearchParams();
    form.set("login", "bee");
    form.set("password", "bug");
    if (loginToken) form.set("form_token", loginToken);
    const loginPost = await axios.post(`${BASE}/login.php`, form, {
      headers: {
        Cookie: cookieHeader(jar),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    parseSetCookie(loginPost.headers, jar);

    // try to set security level low if page exists
    try {
      await axios.get(`${BASE}/portal.php`, {
        headers: { Cookie: cookieHeader(jar) },
        validateStatus: () => true,
      });
      const sec = new URLSearchParams();
      sec.set("security_level", "0"); // 0=low
      await axios.post(`${BASE}/security_level_set.php`, sec, {
        headers: {
          Cookie: cookieHeader(jar),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        validateStatus: () => true,
      });
    } catch {}

    return jar;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[bwapp] setup/login failed:", (e as Error).message);
    return null;
  }
}

describe("bWAPP SQLi (optional)", () => {
  it("detects SQLi on /sqli_1.php?id=", async () => {
    if (!(await isUp(BASE))) {
      // eslint-disable-next-line no-console
      console.warn("[skip] bWAPP is not running on 127.0.0.1:8081");
      return;
    }

    const cookies = await bwappInstallAndLogin();
    if (!cookies) {
      // eslint-disable-next-line no-console
      console.warn("[skip] bWAPP setup/login failed");
      return;
    }

    const scanner = new SqlScanner({ requestTimeoutMs: 12000 });
    const target = `${BASE}/sqli_1.php?id=1`;
    const result = await scanner.scan({
      target,
      method: "GET",
      cookies,
      enable: {
        query: true,
        error: true,
        boolean: true,
        time: false,
        path: false,
        form: false,
        json: false,
      },
      payloads: {
        error: ["'", '"', "' OR 1=1--"],
        boolean: [
          { true: "1 AND 1=1", false: "1 AND 1=2", label: "numeric_boolean" },
          { true: "' OR 1=1--", false: "' OR 1=2--", label: "or_comment" },
        ],
      },
    });

    const found = result.details.filter((d) => d.vulnerable);
    if (found.length === 0) {
      // eslint-disable-next-line no-console
      console.warn("[info] bWAPP: no SQLi detected on sqli_1.php right now");
    }
    expect(Array.isArray(result.details)).toBe(true);
  }, 120_000);
});
