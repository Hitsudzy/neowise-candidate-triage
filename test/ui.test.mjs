import { test } from "node:test";
import assert from "node:assert/strict";
import { toView, render, MESSAGES, LOADING_VIEW } from "../ui.mjs";

function fakeElements() {
  const el = () => ({ textContent: "", hidden: true, dataset: {} });
  return { notice: el(), output: el(), topic: el(), draft: el() };
}

const READY = { status: "ready", topic: "delivery", draft: "Спасибо, уточним сроки доставки." };
const MANUAL = { status: "manual_review", topic: null, draft: null };

test("успех: показываем тему и черновик", () => {
  const els = fakeElements();
  render(els, toView(200, READY));
  assert.equal(els.output.hidden, false);
  assert.equal(els.topic.textContent, "Доставка");
  assert.equal(els.draft.textContent, READY.draft);
  assert.equal(els.notice.hidden, true);
});

test("manual_review после успеха: сообщение менеджеру и старый черновик стёрт", () => {
  const els = fakeElements();
  render(els, toView(200, READY));
  render(els, toView(200, MANUAL));
  assert.equal(els.draft.textContent, "");
  assert.equal(els.topic.textContent, "");
  assert.equal(els.output.hidden, true);
  assert.equal(els.notice.hidden, false);
  assert.equal(els.notice.textContent, MESSAGES.manual);
});

test("на время запроса старый черновик уже не виден", () => {
  const els = fakeElements();
  render(els, toView(200, READY));
  render(els, LOADING_VIEW);
  assert.equal(els.draft.textContent, "");
  assert.equal(els.output.hidden, true);
});

test("ошибка сервера, сеть или странный ответ — тоже ручной разбор", () => {
  for (const [status, body] of [
    [500, { status: "server_error" }],
    [0, null],
    [200, { status: "ready", topic: "refund", draft: "x" }],
    [200, { status: "ready", topic: "other", draft: "  " }],
  ]) {
    assert.equal(toView(status, body).kind, "manual", JSON.stringify({ status, body }));
  }
});

test("пустой ввод — просим ввести текст", () => {
  const view = toView(400, { status: "invalid_input" });
  assert.equal(view.kind, "invalid");
  assert.equal(view.message, MESSAGES.invalid);
  assert.equal(view.draft, "");
});
