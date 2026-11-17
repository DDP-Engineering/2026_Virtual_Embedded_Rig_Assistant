import { useQuery } from "@tanstack/react-query";
import { type SettingsPatch, settingsPatchSchema } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

export function CommandSettings({
  shell,
  saving,
  update,
}: {
  shell: string | undefined;
  saving: boolean;
  update: (patch: SettingsPatch) => void;
}) {
  const { t } = useTranslation();
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
  const dirty = value.trim() !== (shell ?? "");
  const reset = () => {
    setValue(shell ?? "");
    setCustom(false);
  };
  return (
    <section className="surface" data-settings-section="commands">
      <header className="workbench-actions">
        <h2>{t("settings.commands")}</h2>
        <button type="button" disabled={saving || (!dirty && !custom)} onClick={reset}>
          {t("workbench.cancel")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={
            saving ||
            !dirty ||
            (selected === "custom" && !value.trim()) ||
            !settingsPatchSchema.safeParse({ shell: value }).success
          }
          onClick={() => update({ shell: value.trim() })}
        >
          {t("workbench.save")}
        </button>
      </header>
      <label htmlFor="command-shell">{t("settings.commandShell")}</label>
      <select
        id="command-shell"
        value={selected}
        disabled={saving || installed.isPending}
        onChange={(event) => {
          const choice = event.target.value;
          setCustom(choice === "custom");
          if (choice !== "custom")
            setValue(installed.data?.find((option) => option.id === choice)?.executable ?? "");
        }}
      >
        <option value="">{t("settings.automaticShell")}</option>
        {(installed.data ?? []).map((option) => (
          <option
            key={option.id}
            value={option.id}
            disabled={!option.executable}
            title={option.executable ?? undefined}
          >
            {labels[option.id]}
            {!option.executable && ` (${t("settings.shellNotInstalled")})`}
          </option>
        ))}
        <option value="custom">{t("settings.shellCustom")}</option>
      </select>
      {selected === "custom" && (
        <label htmlFor="command-shell-path">
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
