import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify as mockClassify } from "./mock-ai.mjs";

export const TOPICS = new Set(["delivery", "pricing", "other"]);
export const MODEL_TIMEOUT_MS = 300;
const MAX_BODY_BYTES = 64 * 1024;
const MANUAL_REVIEW = Object.freeze({ status: "manual_review", topic: null, draft: null });

const html = await readFile(new URL("./index.html", import.meta.url));
const uiScript = await readFile(new URL("./ui.mjs", import.meta.url));

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

class PayloadTooLarge extends Error {}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new PayloadTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Возвращает текст заявки или null, если ввод некорректен. */
export function parseTriageInput(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isPlainObject(body)) return null;
  const { text } = body;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text;
}

/**
 * Единственное место, где проверяется ответ модели.
 * Возвращает { topic, draft } или null, если ответу нельзя доверять.
 */
export function parseModelOutput(raw) {
  if (typeof raw !== "string") return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(data)) return null;
  const { topic, draft } = data;
  if (!TOPICS.has(topic)) return null;
  if (typeof draft !== "string" || draft.trim() === "") return null;
  return { topic, draft: draft.trim() };
}

/** Вызывает модель с жёстким лимитом: abort-сигнал плюс race на случай, если модель сигнал игнорирует. */
async function callModel(classify, text, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("model timeout"));
    }, timeoutMs);
  });
  try {
    const call = Promise.resolve().then(() => classify(text, { signal: controller.signal }));
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function triage(text, { classify = mockClassify, timeoutMs = MODEL_TIMEOUT_MS, log = console.warn } = {}) {
  let raw;
  try {
    raw = await callModel(classify, text, timeoutMs);
  } catch (error) {
    log(`[triage] manual_review: ${error?.message === "model timeout" ? "timeout" : "model error"}`);
    return MANUAL_REVIEW;
  }
  const parsed = parseModelOutput(raw);
  if (!parsed) {
    log("[triage] manual_review: invalid model output");
    return MANUAL_REVIEW;
  }
  return { status: "ready", ...parsed };
}

export function createApp(options = {}) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }
      if (request.method === "GET" && request.url === "/ui.mjs") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        response.end(uiScript);
        return;
      }
      if (request.method !== "POST" || request.url !== "/api/triage") {
        return json(response, 404, { status: "not_found" });
      }
      const text = parseTriageInput(await readBody(request));
      if (text === null) return json(response, 400, { status: "invalid_input" });
      return json(response, 200, await triage(text, options));
    } catch (error) {
      if (error instanceof PayloadTooLarge) return json(response, 413, { status: "payload_too_large" });
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
}
