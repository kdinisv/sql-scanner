// Общие типы библиотеки

export type Method = "GET" | "POST";
export type InjectionKind =
  | "query"
  | "path"
  | "form"
  | "json"
  | "cookie"
  | "header";

export type InjectionPoint = {
  kind: InjectionKind;
  name: string;
  meta?: Record<string, unknown>;
};

export type ScanInput = {
  target: string;
  method?: Method;
  jsonBody?: Record<string, unknown>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  timeThresholdMs?: number;
  requestTimeoutMs?: number;
  parallel?: number;
  maxRequests?: number;
  enable: Partial<
    Record<InjectionKind | "error" | "boolean" | "time", boolean>
  >;
};

export type Detail = {
  point: InjectionPoint;
  payload: string;
  technique: "error" | "boolean_truefalse" | "time";
  vulnerable: boolean;
  responseMeta?: {
    status: number;
    elapsedMs?: number;
    len?: number;
    location?: string;
  };
  evidence?: string;
  confirmations?: string[];
};

export type ResultShape = { vulnerable: boolean; details: Detail[] };

export type SmartScanOptions = {
  baseUrl: string;
  maxDepth?: number;
  maxPages?: number;
  sameOriginOnly?: boolean;
  requestTimeoutMs?: number;
  usePlaywright?: boolean;
  playwrightMaxPages?: number;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
};

export type DiscoveredTarget =
  | { kind: "url-with-query"; url: string }
  | {
      kind: "form";
      action: string;
      method: Method;
      enctype?: string;
      fields: Array<{ name: string; value: string }>;
    }
  | {
      kind: "json-endpoint";
      url: string;
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: any;
      headers?: Record<string, string>;
    };

export type SmartScanResult = {
  crawledPages: number;
  candidates: DiscoveredTarget[];
  sqli: ResultShape[];
};
