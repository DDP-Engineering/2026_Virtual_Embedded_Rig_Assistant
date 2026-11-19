// REQ-UX-9427b929
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/index.js";

export function useImageModelWarning(
  workbenchId: string | undefined,
  sessionId: string | undefined,
  modelRef: string | null,
  hasImages: boolean,
  catalogVersions: readonly number[],
) {
  const settings = useQuery({
    queryKey: ["app.settings"],
    queryFn: () => api.getSettings(),
    enabled: hasImages,
  });
  const workbench = useQuery({
    queryKey: ["workbench.active"],
    queryFn: () => api.invoke("workbench.config.get", {}),
    enabled: hasImages,
  });
  const enabled = !!workbenchId && !!sessionId && hasImages;
  const capability = useQuery({
    queryKey: [
      "session.image.capability",
      workbenchId,
      sessionId,
      modelRef,
      workbench.data?.config.agent.model,
      settings.data?.settings.defaultModel,
      settings.dataUpdatedAt,
      ...catalogVersions,
    ],
    queryFn: () =>
      api.invoke("session.image.capability", {
        workbenchId: workbenchId ?? "",
        sessionId: sessionId ?? "",
      }),
    enabled,
    networkMode: "always",
    retry: false,
  });
  return {
    imageModelPending: enabled && capability.isPending,
    warnTextOnly: hasImages && capability.data?.acceptsImages === false,
  };
}
