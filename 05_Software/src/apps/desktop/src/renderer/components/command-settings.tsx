// REQ-UX-032aab57
import { useQuery } from "@tanstack/react-query";
import { type SettingsPatch, settingsPatchSchema } from "@vera/shared";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { SettingsPageHeader } from "./settings-page-header.js";

export function CommandSettings({
  shell,
  saving,
  update,
  dirtyChanged,
}: {
  shell: string | undefined;
  saving: boolean;
  update: (patch: SettingsPatch) => void;
  dirtyChanged?: ((dirty: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const shellGroup = useId();
  const [value, setValue] = useState(shell ?? "");
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    setValue(shell ?? "");
    setCustom(false);
  }, [shell]);
  const installed = useQuery({
    queryKey: ["commands.shells"],
    queryFn: () => api.invoke("commands.shells", {}),
    refetchOnMount: "always",
    retry: false,
  });
  const labels = {
    pwsh: t("settings.shellPowerShell7"),
    powershell: t("settings.shellWindowsPowerShell"),
    cmd: t("settings.shellCmd"),
    bash: t("settings.shellBash"),
  };
  const pathKey = (path: string) =>
    /^[a-z]:[\\/]/i.test(path) ? path.replaceAll("\\", "/").toLowerCase() : path;
  const match = installed.data?.find(
    (option) =>
      (option.executable && pathKey(option.executable) === pathKey(value)) ||
      option.id === value.replace(/\.exe$/i, "").toLowerCase(),
  );
  const selected = custom ? "custom" : !value ? "" : (match?.id ?? "custom");
  const choices = [
    { id: "", label: t("settings.automaticShell"), executable: undefined },
    ...(installed.data ?? []).map(({ id, executable }) => ({ id, label: labels[id], executable })),
    { id: "custom", label: t("settings.shellCustom"), executable: undefined },
  ];
  const dirty = value.trim() !== (shell ?? "");
  useEffect(() => dirtyChanged?.(dirty || custom), [dirty, custom, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
  const reset = () => {
    setValue(shell ?? "");
    setCustom(false);
  };
  return (
    <section className="surface" data-settings-section="commands">
      <SettingsPageHeader
        title={t("settings.commands")}
        i18n="settings.commands"
        dirty={dirty || custom}
        valid={
          dirty &&
          !(selected === "custom" && !value.trim()) &&
          settingsPatchSchema.safeParse({ shell: value }).success
        }
        saving={saving}
        onCancel={reset}
        onSave={() => update({ shell: value.trim() })}
      />
      <fieldset id="command-shell" className="command-shell-options" disabled={saving || installed.isPending}>
        <legend>{t("settings.commandShell")}</legend>
        {choices.map(({ id, label, executable }) => {
          const labelId = `${shellGroup}-${id}-label`;
          const detailId = `${shellGroup}-${id}-detail`;
          return (
            <label className="command-shell-option" key={id}>
              <input
                type="radio"
                name={shellGroup}
                value={id}
                aria-labelledby={labelId}
                aria-describedby={executable === undefined ? undefined : detailId}
                checked={selected === id}
                disabled={executable === null}
                onChange={() => {
                  setCustom(id === "custom");
                  if (id !== "custom") setValue(executable ?? "");
                }}
              />
              <span id={labelId}>{label}</span>
              {executable === null && (
                <span className="command-shell-detail" id={detailId}>
                  {t("settings.shellNotInstalled")}
                </span>
              )}
              {executable && (
                <code className="command-shell-detail" id={detailId} title={executable}>
                  {executable}
                </code>
              )}
            </label>
          );
        })}
      </fieldset>
      {selected === "custom" && (
        <label className="command-shell-path" htmlFor="command-shell-path">
          {t("settings.shellPath")}
          <input
            id="command-shell-path"
            value={value}
            disabled={saving}
            maxLength={4096}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      )}
      {installed.isError && (
        <>
          <ErrorMessage error={installed.error} />
          <button type="button" onClick={() => void installed.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      )}
    </section>
  );
}
