import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";

const MANUAL = { status: "manual_review", topic: null, draft: null };
let server;
let baseUrl;

function startServer(options) {
  return new Promise((resolve) => {
    const app = createApp({ log: () => {}, ...options });
    app.listen(0, "127.0.0.1", () => resolve(app));
  });
}

const urlOf = (app) => `http://127.0.0.1:${app.address().port}/api/triage`;

async function post(url, body) {
  const reply = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: reply.status, body: await reply.json() };
}

before(async () => {
  server = await startServer();
  baseUrl = urlOf(server);
});
after(() => server.close());

test("корректная заявка — тема и черновик", async () => {
  const { status, body } = await post(baseUrl, { text: "Когда будет доставка заказа?" });
  assert.equal(status, 200);
  assert.deepEqual(body, { status: "ready", topic: "delivery", draft: "Спасибо за обращение. Уточним детали заявки." });
});

test("тема pricing распознаётся", async () => {
  const { body } = await post(baseUrl, { text: "Какая стоимость подписки?" });
  assert.equal(body.topic, "pricing");
});

for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`сбой модели ${marker} → manual_review`, async () => {
    const { status, body } = await post(baseUrl, { text: `Где мой заказ? ${marker}` });
    assert.equal(status, 200);
    assert.deepEqual(body, MANUAL);
  });
}

test("таймаут модели → manual_review не дольше чем примерно за 300 мс", async () => {
  const started = Date.now();
  const { status, body } = await post(baseUrl, { text: "Доставка [timeout]" });
  const elapsed = Date.now() - started;
  assert.equal(status, 200);
  assert.deepEqual(body, MANUAL);
  assert.ok(elapsed < 1000, `ответ занял ${elapsed} мс, имитатор ждёт 1200 мс`);
});

test("модель, игнорирующая abort-сигнал, всё равно обрывается по таймауту", async () => {
  const hanging = await startServer({ classify: () => new Promise(() => {}), timeoutMs: 50 });
  try {
    const { body } = await post(urlOf(hanging), { text: "привет" });
    assert.deepEqual(body, MANUAL);
  } finally {
    hanging.close();
  }
});

test("лишние поля из ответа модели не попадают в API", async () => {
  const leaky = await startServer({
    classify: async () => JSON.stringify({ topic: "other", draft: "Ответ", secret: "x", status: "hacked" }),
  });
  try {
    const { body } = await post(urlOf(leaky), { text: "привет" });
    assert.deepEqual(body, { status: "ready", topic: "other", draft: "Ответ" });
  } finally {
    leaky.close();
  }
});

const invalidBodies = {
  "пустая строка": { text: "" },
  "только пробелы": { text: "   \n\t" },
  "нет поля text": {},
  "text не строка": { text: 42 },
  "text = null": { text: null },
  "тело — массив": [{ text: "привет" }],
  "тело — null": "null",
  "битый JSON": "{ text: ",
  "пустое тело": "",
};
for (const [name, body] of Object.entries(invalidBodies)) {
  test(`некорректный ввод (${name}) → 400 invalid_input`, async () => {
    const reply = await post(baseUrl, body);
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, { status: "invalid_input" });
  });
}
