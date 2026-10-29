import {
  commandBindings,
  type ShortcutCommand,
  type ShortcutOverrides,
  shortcutBindingSchema,
  shortcutCommands,
  shortcutOverridesSchema,
} from "@vera/shared";
import { Keyboard, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bindingFromEvent, displayBinding } from "../lib/shortcuts.js";

export function KeyboardShortcuts({
  bindings,
  disabled,
  update,
}: {
  bindings?: ShortcutOverrides | undefined;
  disabled: boolean;
  update: (bindings: ShortcutOverrides) => void;
}) {
  const { t } = useTranslation();
  const labels = {
    newSession: [t("keyboard.newSession"), t("keyboard.newSessionDesc")],
    newWorkbench: [t("keyboard.newWorkbench"), t("keyboard.newWorkbenchDesc")],
    openWorkbench: [t("keyboard.openWorkbench"), t("keyboard.openWorkbenchDesc")],
    settings: [t("keyboard.settings"), t("keyboard.settingsDesc")],
    shortcuts: [t("keyboard.shortcuts"), t("keyboard.shortcutsDesc")],
    toggleSidebar: [t("keyboard.toggleSidebar"), t("keyboard.toggleSidebarDesc")],
    toggleRightPanel: [t("keyboard.toggleRightPanel"), t("keyboard.toggleRightPanelDesc")],
    find: [t("keyboard.find"), t("keyboard.findDesc")],
    focusComposer: [t("keyboard.focusComposer"), t("keyboard.focusComposerDesc")],
    focusModel: [t("keyboard.focusModel"), t("keyboard.focusModelDesc")],
  };
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [keySearch, setKeySearch] = useState(false);
  const [record, setRecord] = useState<{ command: ShortcutCommand; index?: number | undefined }>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  function edit(command: ShortcutCommand, index?: number | undefined) {
    origin.current = document.activeElement as HTMLElement;
    setDraft(index === undefined ? "" : (commandBindings(command, bindings)[index] ?? ""));
    setError("");
    setRecord({ command, index });
  }
  useEffect(() => {
    if (!record) return;
    const node = dialog.current;
    node?.showModal();
    node?.querySelector("input")?.focus();
    return () => {
      node?.close();
      if (origin.current?.isConnected && !origin.current.matches(":disabled")) origin.current.focus();
      else document.querySelector<HTMLInputElement>(".shortcut-search input")?.focus();
    };
  }, [record]);
  function save() {
    if (!record || disabled) return;
    if (!shortcutBindingSchema.safeParse(draft).success) {
      setError(t("keyboard.invalid"));
      return;
    }
    const entries = [...commandBindings(record.command, bindings)];
    if (record.index === undefined) entries.push(draft);
    else entries[record.index] = draft;
    const next = { ...bindings, [record.command]: entries };
    if (!shortcutOverridesSchema.safeParse(next).success) {
      setError(t("keyboard.conflict"));
      return;
    }
    update(next);
    setRecord(undefined);
  }
  return (
    <section data-settings-section="shortcuts" className="shortcut-settings">
      <h2>{t("settings.shortcuts")}</h2>
      <div className="shortcut-search">
        <Search aria-hidden="true" />
        <input
          type="search"
          ref={searchInput}
          value={search}
          aria-label={keySearch ? t("keyboard.searchKeys") : t("keyboard.search")}
          placeholder={keySearch ? t("keyboard.searchKeys") : t("keyboard.search")}
          data-shortcut-capture={keySearch || undefined}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (!keySearch) return;
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setSearch("");
              return;
            }
            if (event.ctrlKey || event.metaKey) {
              event.preventDefault();
              const value = bindingFromEvent(event.nativeEvent);
              if (value) setSearch(displayBinding(value));
            }
          }}
        />
        <button
          type="button"
          aria-label={t("keyboard.searchKeys")}
          title={t("keyboard.searchKeys")}
          aria-pressed={keySearch}
          onClick={() => {
            setKeySearch((value) => !value);
            setSearch("");
            searchInput.current?.focus();
          }}
        >
          <Keyboard aria-hidden="true" />
        </button>
      </div>
      <p className="muted">{t("keyboard.intro")}</p>
      <div className="shortcut-list">
        {shortcutCommands
          .filter((command) => {
            const text = keySearch
              ? commandBindings(command, bindings).map(displayBinding).join(" ")
              : [...labels[command], ...commandBindings(command, bindings).map(displayBinding)].join(" ");
            return text.toLocaleLowerCase().includes(search.toLocaleLowerCase());
          })
          .map((command) => (
            <article className="shortcut-row" key={command} data-shortcut={command}>
              <div className="shortcut-description">
                <h3>{labels[command][0]}</h3>
                <p className="muted">{labels[command][1]}</p>
              </div>
              <div className="shortcut-bindings">
                {commandBindings(command, bindings).length === 0 && (
                  <span className="muted">{t("keyboard.unassigned")}</span>
                )}
                {commandBindings(command, bindings).map((binding, index) => (
                  <div className="shortcut-binding" key={binding}>
                    <kbd>{displayBinding(binding)}</kbd>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={t("keyboard.edit", {
                        action: labels[command][0],
                        binding: displayBinding(binding),
                      })}
                      onClick={() => edit(command, index)}
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={t("keyboard.remove", {
                        action: labels[command][0],
                        binding: displayBinding(binding),
                      })}
                      onClick={() =>
                        update({
                          ...bindings,
                          [command]: commandBindings(command, bindings).filter(
                            (_, position) => position !== index,
                          ),
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <div className="shortcut-row-actions">
                  <button
                    type="button"
                    disabled={disabled || commandBindings(command, bindings).length >= 4}
                    aria-label={t("keyboard.add", { action: labels[command][0] })}
                    onClick={() => edit(command)}
                  >
                    <Plus aria-hidden="true" />
                    {t("keyboard.addLabel")}
                  </button>
                  {bindings?.[command] !== undefined && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const next = { ...bindings };
                        delete next[command];
                        if (!shortcutOverridesSchema.safeParse(next).success) {
                          edit(command);
                          setError(t("keyboard.conflict"));
                          return;
                        }
                        update(next);
                      }}
                    >
                      {t("keyboard.reset")}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
      </div>
      <p className="muted">{t("keyboard.local")}</p>
      <button
        type="button"
        disabled={disabled || !Object.keys(bindings ?? {}).length}
        onClick={() => update({})}
      >
        {t("keyboard.resetAll")}
      </button>
      {record && (
        <dialog
          ref={dialog}
          className="pinned-dialog shortcut-recorder"
          aria-labelledby="shortcut-recorder-title"
          onCancel={(event) => {
            event.preventDefault();
            setRecord(undefined);
          }}
        >
          <h2 id="shortcut-recorder-title">{labels[record.command][0]}</h2>
          <p>{t("keyboard.record")}</p>
          <input
            readOnly
            aria-label={t("keyboard.record")}
            value={draft ? displayBinding(draft) : ""}
            placeholder={t("keyboard.press")}
            onKeyDown={(event) => {
              if (event.key === "Tab") return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "Escape") {
                setRecord(undefined);
                return;
              }
              if (event.repeat || event.nativeEvent.isComposing) return;
              const value = bindingFromEvent(event.nativeEvent);
              if (value) {
                setDraft(value);
                setError("");
              } else if (!["Control", "Meta", "Alt", "Shift"].includes(event.key)) {
                setDraft("");
                setError(t("keyboard.invalid"));
              }
            }}
          />
          <p className="muted">{t("keyboard.recordHint")}</p>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button type="button" onClick={() => setRecord(undefined)}>
              {t("projects.cancel")}
            </button>
            <button type="button" disabled={disabled || !draft} onClick={save}>
              {t("projects.save")}
            </button>
          </footer>
        </dialog>
      )}
    </section>
  );
}
