// REQ-UX-0f1a32c4 REQ-FUNC-37261edc
import { useQuery } from "@tanstack/react-query";
import { type BuiltinToolName, coreToolNames, modelReferenceSchema } from "@vera/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { useSettingsSnapshot } from "../hooks/use-preferences.js";
import { Pager, usePaged } from "./pager.js";

type ToolControls = {
  disabled: readonly string[];
  toggle: (name: BuiltinToolName, enabled: boolean) => void;
};

export function WorkbenchCoreTools({ modelRef, ...controls }: ToolControls & { modelRef: string | null }) {
  const settings = useSettingsSnapshot();
  const capability = useQuery({
    queryKey: ["providers.image.capability", modelRef, settings.dataUpdatedAt],
    queryFn: () => api.invoke("providers.image.capability", { modelRef }),
    enabled: modelRef === null ? settings.isSuccess : modelReferenceSchema.safeParse(modelRef).success,
    retry: false,
    networkMode: "always",
  });
  const names = coreToolNames.filter(
    (name) => name !== "view_image" || capability.data?.acceptsImages === true,
  );
  return <WorkbenchTools {...controls} names={names} />;
}

export function WorkbenchTools({
  disabled,
  toggle,
  names,
  locked = false,
}: ToolControls & {
  names: readonly BuiltinToolName[];
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const descriptions: Record<BuiltinToolName, string> = {
    terminal_read: t("workbenchTools.terminal_read"),
    read: t("workbenchTools.read"),
    view_image: t("workbenchTools.view_image"),
    list: t("workbenchTools.list"),
    glob: t("workbenchTools.glob"),
    grep: t("workbenchTools.grep"),
    parse_log: t("workbenchTools.parse_log"),
    decode_register: t("workbenchTools.decode_register"),
    write: t("workbenchTools.write"),
    edit: t("workbenchTools.edit"),
    artifact_save: t("workbenchTools.artifact_save"),
    todo: t("workbenchTools.todo"),
    search_docs: t("workbenchTools.search_docs"),
    read_doc: t("workbenchTools.read_doc"),
    load_skill: t("workbenchTools.load_skill"),
    web_search: t("workbenchTools.web_search"),
    web_read: t("workbenchTools.web_read"),
    web_download: t("workbenchTools.web_download"),
    parts_search: t("workbenchTools.parts_search"),
    run_program: t("workbenchTools.run_program"),
    run_command: t("workbenchTools.run_command"),
    program_output: t("workbenchTools.program_output"),
    program_stop: t("workbenchTools.program_stop"),
    help: t("workbenchTools.help"),
    plugin_validate: t("workbenchTools.plugin_validate"),
    plugin_install: t("workbenchTools.plugin_install"),
    apply_candidate: t("workbenchTools.apply_candidate"),
    electrical_model: t("workbenchTools.electrical_model"),
    electrical_model_change: t("workbenchTools.electrical_model_change"),
    industrial_catalog: t("workbenchTools.industrial_catalog"),
    electrical_network: t("workbenchTools.electrical_network"),
    protection_coordination: t("workbenchTools.protection_coordination"),
    motor_drives: t("workbenchTools.motor_drives"),
    power_quality: t("workbenchTools.power_quality"),
    lighting_design: t("workbenchTools.lighting_design"),
  };
  const { rows, pager } = usePaged(names, 50);
  return (
    <div className="workbench-tools">
      <ul>
        {rows.map((name) => (
          <li key={name}>
            <label className="workbench-tool-option">
              <input
                type="checkbox"
                data-tool-toggle={name}
                aria-label={name}
                aria-describedby={`${id}-${name}`}
                disabled={locked}
                checked={!disabled.includes(name)}
                onChange={(event) => toggle(name, event.currentTarget.checked)}
              />
              <span>
                <strong>{name}</strong>
                <span id={`${id}-${name}`} data-tool-description={name} className="muted">
                  {descriptions[name]}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Pager {...pager} />
    </div>
  );
}
