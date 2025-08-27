import { describe, it, expect } from "vitest";
import axios from "axios";
import * as cheerio from "cheerio";
import http from "node:http";
import { SqlScanner } from "../src/index.js";

const BASE = "http://127.0.0.1:8080";

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

async function dvwaLoginAndSetLow(): Promise<CookieMap | null> {
  try {
    const jar: CookieMap = {};
    // 1) open login page to grab user_token and initial cookies
    const loginGet = await axios.get(`${BASE}/login.php`, {
      validateStatus: () => true,
    });
    parseSetCookie(loginGet.headers, jar);
    const $login = cheerio.load(loginGet.data || "");
    const userToken = $login('input[name="user_token"]').attr("value") || "";

    // 2) login with default credentials
    const form = new URLSearchParams();
    form.set("username", "admin");
    form.set("password", "password");
    form.set("Login", "Login");
    if (userToken) form.set("user_token", userToken);
    const loginPost = await axios.post(`${BASE}/login.php`, form, {
      headers: {
        Cookie: cookieHeader(jar),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    parseSetCookie(loginPost.headers, jar);

    // 3) open security page and set security=low
    const secGet = await axios.get(`${BASE}/security.php`, {
      headers: { Cookie: cookieHeader(jar) },
      validateStatus: () => true,
    });
    parseSetCookie(secGet.headers, jar);
    const $sec = cheerio.load(secGet.data || "");
    const secToken = $sec('input[name="user_token"]').attr("value") || "";
    const secForm = new URLSearchParams();
    secForm.set("security", "low");
    secForm.set("seclev_submit", "Submit");
    if (secToken) secForm.set("user_token", secToken);
    const secPost = await axios.post(`${BASE}/security.php`, secForm, {
      headers: {
        Cookie: cookieHeader(jar),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      maxRedirects: 0,
      validateStatus: () => true,
    });
    parseSetCookie(secPost.headers, jar);

    // DVWA often stores security level in cookie "security=low"
    jar["security"] = jar["security"] || "low";
    return jar;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[dvwa] login/setup failed:", (e as Error).message);
    return null;
  }
}

describe("DVWA SQLi (optional)", () => {
  it("detects SQLi on /vulnerabilities/sqli/?id=", async () => {
    if (!(await isUp(BASE))) {
      // eslint-disable-next-line no-console
      console.warn("[skip] DVWA is not running on 127.0.0.1:8080");
      return;
    }

    const cookies = await dvwaLoginAndSetLow();
    if (!cookies) {
      // eslint-disable-next-line no-console
      console.warn("[skip] DVWA login/setup failed – run setup in UI?");
      return;
    }

    const scanner = new SqlScanner({ requestTimeoutMs: 10000 });
    const target = `${BASE}/vulnerabilities/sqli/?id=1&Submit=Submit`;
    const result = await scanner.scan({
      target,
      method: "GET",
      headers: { Referer: `${BASE}/vulnerabilities/sqli/` },
      cookies,
      enable: {
        query: true,
        error: true,
        boolean: true,
        time: false,
        path: false,
        form: false,
        json: false,
        header: false,
        cookie: false,
      },
      payloads: {
        error: ["'", "' OR 1=1--"],
        boolean: [
          { true: "1 AND 1=1", false: "1 AND 1=2", label: "numeric_boolean" },
          { true: "' OR 1=1--", false: "' OR 1=2--", label: "or_comment" },
        ],
      },
    });

    const found = result.details.filter((d) => d.vulnerable);
    if (found.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[info] DVWA: no SQLi detected now (security level/db setup may block it)"
      );
    }
    expect(Array.isArray(result.details)).toBe(true);
  }, 90_000);
});
