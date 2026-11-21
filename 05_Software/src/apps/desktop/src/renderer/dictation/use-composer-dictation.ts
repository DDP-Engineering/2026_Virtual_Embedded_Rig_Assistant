import type { DictationRecordingMode } from "@vera/shared";
import { useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api/index.js";
import { ShortcutContext, shortcutCommand } from "../lib/shortcuts.js";
import {
  createDictationCapture,
  type DictationCapture,
  type DictationCaptureResult,
  type DictationPhase,
} from "./capture.js";

type KeyHold = { key: string; code: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean };
type Hold = { pointer: number } | KeyHold;
type Notice = DictationCaptureResult["status"];

function heldKey(event: KeyboardEvent): KeyHold {
  return {
    key: event.key.toLowerCase(),
    code: event.code,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

function released(hold: KeyHold, event: KeyboardEvent): boolean {
  return (
    (hold.code && event.code ? hold.code === event.code : hold.key === event.key.toLowerCase()) ||
    (hold.ctrl && !event.ctrlKey) ||
    (hold.meta && !event.metaKey) ||
    (hold.shift && !event.shiftKey) ||
    (hold.alt && !event.altKey)
  );
}

/** Route composer gestures to one capture and deliver only its still-owned draft result. */
export function useComposerDictation<Draft>({
  sessionId,
  enabled,
  mode,
  readDraft,
  insert,
}: {
  sessionId?: string | undefined;
  enabled: boolean;
  mode: DictationRecordingMode;
  readDraft: () => Draft;
  insert: (draft: Draft, transcript: string) => void;
}) {
  const bindings = useContext(ShortcutContext);
  const capture = useRef<DictationCapture>(undefined);
  const attempt = useRef<{ hold: Hold | undefined }>(undefined);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [notice, setNotice] = useState<Notice>();

  const cancel = useCallback(() => {
    if (!attempt.current) return;
    attempt.current = undefined;
    capture.current?.cancel();
    setNotice("cancelled");
  }, []);

  useLayoutEffect(() => {
    if (!enabled || !sessionId) return;
    const controller = createDictationCapture(api, setPhase);
    controller.capture.setSession(sessionId);
    capture.current = controller.capture;
    setNotice(undefined);
    return () => {
      attempt.current = undefined;
      capture.current = undefined;
      controller.dispose();
    };
  }, [enabled, sessionId]);

  const activate = useCallback(
    (hold?: Hold) => {
      const controller = capture.current;
      if (!controller || !sessionId) return;
      if (attempt.current) {
        if (mode === "toggle" || (!hold && !attempt.current.hold)) controller.stop();
        return;
      }
      const job = { hold };
      const draft = readDraft();
      attempt.current = job;
      setNotice(undefined);
      void controller.start().then((result) => {
        if (attempt.current !== job) return;
        attempt.current = undefined;
        if (result.status === "complete") {
          if (result.session !== sessionId) return;
          insert(draft, result.text);
        }
        setNotice(result.status);
      });
    },
    [insert, mode, readDraft, sessionId],
  );

  useLayoutEffect(() => {
    if (!enabled || !sessionId) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        event.repeat ||
        event.defaultPrevented ||
        !attempt.current
      )
        return;
      cancel();
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (shortcutCommand(event, bindings) !== "dictate") return;
      event.preventDefault();
      activate(mode === "hold" ? heldKey(event) : undefined);
    };
    const keyUp = (event: KeyboardEvent) => {
      const job = attempt.current;
      const hold = job?.hold;
      if (!job || !hold || "pointer" in hold || !released(hold, event)) return;
      if (hold.key === " " || hold.key === "enter") event.preventDefault();
      job.hold = undefined;
      capture.current?.stop();
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape, true);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [activate, bindings, cancel, enabled, mode, sessionId]);

  return {
    phase,
    notice,
    cancel,
    activate: () => activate(),
    keyDown: (event: KeyboardEvent) => {
      if (
        (event.key !== " " && event.key !== "Enter") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      event.preventDefault();
      if (!event.repeat) activate(mode === "hold" ? heldKey(event) : undefined);
    },
    pointerDown: (id: number) => activate({ pointer: id }),
    pointerUp: (id: number) => {
      const job = attempt.current;
      if (job?.hold && "pointer" in job.hold && job.hold.pointer === id) {
        job.hold = undefined;
        capture.current?.stop();
      }
    },
    pointerCancel: (id: number) => {
      const hold = attempt.current?.hold;
      if (hold && "pointer" in hold && hold.pointer === id) cancel();
    },
  };
}
