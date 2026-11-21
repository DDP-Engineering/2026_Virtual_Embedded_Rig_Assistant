import type { DictationRecordingMode } from "@vera/shared";
import { AudioLines, LoaderCircle, Mic, Square, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { useComposerDictation } from "../../dictation/use-composer-dictation.js";

export function DictationButton({
  dictation,
  disabled,
  mode,
}: {
  dictation: ReturnType<typeof useComposerDictation>;
  disabled: boolean;
  mode: DictationRecordingMode;
}) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const cancelledFromButton = useRef(false);
  const { phase } = dictation;
  const active = phase !== "idle";
  const listening = phase === "opening" || phase === "recording";
  const hold = mode === "hold";
  const label = hold ? t("dictation.holdToTalk") : t("dictation.toggleMicrophone");
  const Icon = phase === "transcribing" ? LoaderCircle : listening ? (hold ? AudioLines : Square) : Mic;

  useLayoutEffect(() => {
    if (!active && cancelledFromButton.current) {
      cancelledFromButton.current = false;
      button.current?.focus();
    }
  }, [active]);

  return (
    <>
      <button
        ref={button}
        type="button"
        data-action="dictate"
        data-listening={listening || undefined}
        disabled={disabled}
        aria-disabled={phase === "transcribing" || undefined}
        aria-label={label}
        title={label}
        aria-pressed={hold ? undefined : listening}
        onKeyDown={(event) => dictation.keyDown(event.nativeEvent)}
        onPointerDown={(event) => {
          if (!hold || !event.isPrimary || event.button !== 0 || phase !== "idle") return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dictation.pointerDown(event.pointerId);
        }}
        onPointerUp={(event) => dictation.pointerUp(event.pointerId)}
        onPointerCancel={(event) => dictation.pointerCancel(event.pointerId)}
        onLostPointerCapture={(event) => dictation.pointerCancel(event.pointerId)}
        onClick={(event) => {
          if (!hold || event.detail === 0) dictation.activate();
        }}
      >
        <Icon aria-hidden="true" />
      </button>
      {active && (
        <button
          type="button"
          data-action="cancel-dictation"
          aria-label={t("dictation.cancelCapture")}
          title={t("dictation.cancelCapture")}
          onFocus={() => {
            cancelledFromButton.current = true;
          }}
          onBlur={() => {
            cancelledFromButton.current = false;
          }}
          onClick={dictation.cancel}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </>
  );
}

export function DictationStatus({
  dictation,
  running,
}: {
  dictation: ReturnType<typeof useComposerDictation>;
  running: boolean;
}) {
  const { t } = useTranslation();
  const errors = {
    busy: t("dictation.busy"),
    "missing-model": t("dictation.missingModel"),
    "permission-denied": t("dictation.permissionDenied"),
    "microphone-unavailable": t("dictation.microphoneUnavailable"),
    "microphone-disconnected": t("dictation.microphoneDisconnected"),
    "no-speech": t("dictation.noSpeech"),
    "transcription-failed": t("dictation.transcriptionFailed"),
  };
  const phases = {
    opening: t("dictation.opening"),
    recording: t("dictation.recording"),
    transcribing: t("dictation.transcribing"),
  };
  const { phase, notice } = dictation;
  const error =
    phase === "idle" && notice && notice !== "complete" && notice !== "cancelled"
      ? errors[notice]
      : undefined;
  let message = running ? "" : t("chat.enterHint");
  if (phase !== "idle") message = phases[phase];
  else if (notice === "complete") message = t("dictation.inserted");
  else if (notice === "cancelled") message = t("dictation.cancelled");

  return (
    <p className="composer-hint">
      {running && (
        <span className="muted" role="status" data-chat-working="">
          {t("chat.working")}{" "}
        </span>
      )}
      {message && !error && (
        <span
          role="status"
          data-dictation-status
          className={phase === "idle" && !notice ? "muted" : undefined}
        >
          {message}
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </p>
  );
}
