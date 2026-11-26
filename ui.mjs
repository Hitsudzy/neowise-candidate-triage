// Логика отображения без привязки к DOM-API, чтобы её можно было тестировать в Node.

export const TOPIC_LABELS = { delivery: "Доставка", pricing: "Цены и стоимость", other: "Другое" };

export const MESSAGES = {
  loading: "Разбираем заявку…",
  invalid: "Введите текст заявки.",
  manual:
    "AI не смог надёжно разобрать эту заявку. Разберите её вручную: определите тему и напишите ответ клиенту сами.",
};

const EMPTY = { topic: "", draft: "" };

export const LOADING_VIEW = Object.freeze({ kind: "loading", message: MESSAGES.loading, ...EMPTY });

/** Превращает ответ API (или его отсутствие) в то, что видит менеджер. Любой непонятный ответ — ручной разбор. */
export function toView(httpStatus, body) {
  if (body?.status === "invalid_input") return { kind: "invalid", message: MESSAGES.invalid, ...EMPTY };
  const ready =
    httpStatus === 200 &&
    body?.status === "ready" &&
    Object.hasOwn(TOPIC_LABELS, body.topic) &&
    typeof body.draft === "string" &&
    body.draft.trim() !== "";
  if (ready) return { kind: "ready", message: "", topic: TOPIC_LABELS[body.topic], draft: body.draft };
  return { kind: "manual", message: MESSAGES.manual, ...EMPTY };
}

/** Перерисовывает все поля целиком, поэтому старый черновик не может остаться на экране. */
export function render(elements, view) {
  elements.notice.textContent = view.message;
  elements.notice.hidden = view.message === "";
  elements.notice.dataset.kind = view.kind;
  elements.topic.textContent = view.topic;
  elements.draft.textContent = view.draft;
  elements.output.hidden = view.kind !== "ready";
}
