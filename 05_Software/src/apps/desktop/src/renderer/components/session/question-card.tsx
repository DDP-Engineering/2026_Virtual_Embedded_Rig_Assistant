import { type QuestionReply, questionAnswerMax, type SessionQuestion } from "@vera/shared";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";

export function QuestionCard({
  question,
  sessionId,
  workbenchId,
  disabled,
}: {
  question: SessionQuestion;
  sessionId?: string | undefined;
  workbenchId?: string | undefined;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const label = useId();
  const [selected, setSelected] = useState<number>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const submitting = useRef(false);
  const { outcome } = question;
  async function submit(reply: QuestionReply) {
    if (!sessionId || !workbenchId || disabled || outcome || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api.invoke("session.question.answer", {
        workbenchId,
        sessionId,
        questionId: question.questionId,
        reply,
      });
    } catch (failure) {
      setError(failure);
      submitting.current = false;
      setBusy(false);
    }
  }
  const date = question.deadline
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "short", timeStyle: "medium" }).format(
        new Date(question.deadline),
      )
    : null;
  return (
    <section
      className="question-card"
      aria-labelledby={label}
      data-pending-question={outcome === null ? question.questionId : undefined}
      tabIndex={-1}
    >
      <h3 id={label}>{question.question}</h3>
      {outcome ? (
        <p role="status">
          {outcome.kind === "cancelled"
            ? t("question.cancelled")
            : outcome.source === "automatic"
              ? t("question.automaticAnswer", { answer: outcome.answer })
              : t("question.userAnswer", { answer: outcome.answer })}
        </p>
      ) : (
        <>
          <fieldset disabled={disabled || busy || !sessionId || !workbenchId}>
            <legend className="sr-only">{t("question.choices")}</legend>
            {question.choices.map((choice, index) => {
              const position = index + 1;
              return (
                <label key={position}>
                  <input
                    type="radio"
                    name={label}
                    checked={selected === position}
                    onChange={() => setSelected(position)}
                  />
                  <span>{choice}</span>
                  {question.recommended === position && <strong>{t("question.recommended")}</strong>}
                </label>
              );
            })}
            <label>
              <span>{t("question.freeText")}</span>
              <input
                type="text"
                maxLength={questionAnswerMax}
                value={text}
                onChange={(event) => {
                  setText(event.currentTarget.value);
                  setSelected(undefined);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing || !text.trim()) return;
                  event.preventDefault();
                  void submit({ kind: "text", text: text.trim() });
                }}
              />
            </label>
            {date && <p>{t("question.deadline", { date })}</p>}
            <div className="question-actions">
              <button
                type="button"
                className="primary"
                disabled={selected === undefined && !text.trim()}
                onClick={() =>
                  void submit(
                    selected === undefined
                      ? { kind: "text", text: text.trim() }
                      : { kind: "choice", choice: selected },
                  )
                }
              >
                {t("question.submit")}
              </button>
              <button type="button" onClick={() => void submit({ kind: "cancel" })}>
                {t("question.cancel")}
              </button>
            </div>
          </fieldset>
          {error !== undefined && <ErrorMessage error={error} />}
        </>
      )}
    </section>
  );
}
