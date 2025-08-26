export * from "./types.js";
export { runScan } from "./core/runScan.js";
export { smartScan } from "./crawl/smartCrawler.js";

import type {
  ScanInput,
  ResultShape,
  SmartScanOptions,
  SmartScanResult,
} from "./types.js";
import { runScan } from "./core/runScan.js";
import { smartScan } from "./crawl/smartCrawler.js";

export interface SqlScannerOptions {
  requestTimeoutMs?: number;
  timeThresholdMs?: number;
  parallel?: number;
  maxRequests?: number;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}

/**
 * Основной класс для сканирования SQL-инъекций
 */
export class SqlScanner {
  private readonly options: Required<
    Omit<SqlScannerOptions, "headers" | "cookies">
  > & {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
  };

  constructor(options: SqlScannerOptions = {}) {
    this.options = {
      requestTimeoutMs: options.requestTimeoutMs ?? 10000,
      timeThresholdMs: options.timeThresholdMs ?? 2500,
      parallel: options.parallel ?? 4,
      maxRequests: options.maxRequests ?? 500,
      headers: options.headers,
      cookies: options.cookies,
    };
  }

  /**
   * Сканирует указанную цель на SQL-инъекции
   */
  async scan(
    input: Omit<
      ScanInput,
      "requestTimeoutMs" | "parallel" | "maxRequests" | "timeThresholdMs"
    > & {
      requestTimeoutMs?: number;
      parallel?: number;
      maxRequests?: number;
      timeThresholdMs?: number;
    }
  ): Promise<ResultShape> {
    const scanInput: ScanInput = {
      ...input,
      requestTimeoutMs: input.requestTimeoutMs ?? this.options.requestTimeoutMs,
      timeThresholdMs: input.timeThresholdMs ?? this.options.timeThresholdMs,
      parallel: input.parallel ?? this.options.parallel,
      maxRequests: input.maxRequests ?? this.options.maxRequests,
      headers: { ...this.options.headers, ...(input.headers || {}) },
      cookies: { ...this.options.cookies, ...(input.cookies || {}) },
    };

    return runScan(scanInput);
  }

  /**
   * Выполняет умное сканирование с краулингом сайта
   */
  async smartScan(
    options: Omit<
      SmartScanOptions,
      "requestTimeoutMs" | "headers" | "cookies"
    > & {
      requestTimeoutMs?: number;
      headers?: Record<string, string>;
      cookies?: Record<string, string>;
    }
  ): Promise<SmartScanResult> {
    const smartOptions: SmartScanOptions = {
      ...options,
      requestTimeoutMs:
        options.requestTimeoutMs ?? this.options.requestTimeoutMs,
      headers: { ...this.options.headers, ...(options.headers || {}) },
      cookies: { ...this.options.cookies, ...(options.cookies || {}) },
    };

    return smartScan(smartOptions);
  }
}
