// REQ-UX-032aab57
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The title of an editable Settings page with Cancel and Save at the top right. Both buttons are disabled
 * once the page is clean, so focus moves to the title rather than being lost to the document.
 */
export function SettingsPageHeader({
  title,
  i18n,
  dirty,
  valid = true,
  saving,
  onCancel,
  onSave,
}: {
  title: string;
  /** The title's catalog key, as its `data-i18n` hook. */
  i18n: string;
  dirty: boolean;
  valid?: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const header = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef({ dirty, saving });
  useEffect(() => {
    const settled = (previous.current.dirty && !dirty) || (previous.current.saving && !saving);
    previous.current = { dirty, saving };
    if (!settled || saving) return;
    const active = document.activeElement;
    const lost = !active || active === document.body;
    const stuck = active instanceof HTMLButtonElement && active.disabled && header.current?.contains(active);
    if (lost || stuck) heading.current?.focus();
  }, [dirty, saving]);
  return (
    <header
      ref={header}
      className="workbench-actions settings-page-header"
      data-settings-header
      aria-busy={saving}
    >
      <h2 ref={heading} data-i18n={i18n} tabIndex={-1}>
        {title}
      </h2>
      <button type="button" data-settings-cancel disabled={saving || !dirty} onClick={onCancel}>
        {t("workbench.cancel")}
      </button>
      <button
        type="button"
        className="primary"
        data-settings-save
        disabled={saving || !dirty || !valid}
        onClick={onSave}
      >
        {t("workbench.save")}
      </button>
    </header>
  );
}

/**
 * A page draft over saved values: edits that equal the saved value are dropped, so the draft becomes
 * clean when a save is confirmed and stays when a save fails.
 */
export function useSettingsDraft<T extends Record<string, unknown>>(
  saved: T,
  dirtyChanged?: (dirty: boolean) => void,
) {
  const [edits, setEdits] = useState<Partial<T>>({});
  const same = (key: keyof T, value: unknown) => JSON.stringify(saved[key]) === JSON.stringify(value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pruning follows the saved values only.
  useEffect(() => {
    setEdits((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([key, value]) => !same(key as keyof T, value)),
      ) as Partial<T>;
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [JSON.stringify(saved)]);
  const dirty = Object.keys(edits).length > 0;
  useEffect(() => dirtyChanged?.(dirty), [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
  const draft = useMemo(() => ({ ...saved, ...edits }) as T, [saved, edits]);
  return {
    draft,
    edits,
    dirty,
    set: (patch: Partial<T>) =>
      setEdits((current) => {
        const next = { ...current } as Record<string, unknown>;
        for (const [key, value] of Object.entries(patch)) {
          if (same(key as keyof T, value)) delete next[key];
          else next[key] = value;
        }
        return next as Partial<T>;
      }),
    reset: () => setEdits({}),
  };
}
