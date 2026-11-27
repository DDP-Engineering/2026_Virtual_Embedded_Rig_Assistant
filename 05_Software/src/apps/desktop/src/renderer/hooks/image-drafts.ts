// REQ-UX-c3961c76 REQ-FUNC-4436607c
import { type ComposerImage, type ComposerImageSource, veraError } from "@vera/shared";
import { useCallback, useRef, useState } from "react";
import { api } from "../api/index.js";
import { appAdvancedValue } from "./app-advanced.js";

const empty: readonly ComposerImage[] = [];
interface Draft {
  images: readonly ComposerImage[];
  pending: boolean;
  error?: unknown;
  full?: boolean;
}
const blank: Draft = { images: empty, pending: false };

async function imageSource(file: File): Promise<ComposerImageSource> {
  const maxMB = appAdvancedValue("imageFileMB");
  if (file.size > maxMB * 1024 * 1024) throw { ...veraError("IMAGE_TOO_LARGE"), params: { maxMB } };
  if (!file.size) throw veraError("IMAGE_FORMAT");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = typeof reader.result === "string" && reader.result.split(",")[1];
      if (base64) resolve(base64);
      else reject(veraError("IMAGE_FORMAT"));
    };
    reader.onerror = () => reject(veraError("DENIED"));
    reader.readAsDataURL(file);
  });
  return { name: file.name, data };
}

/** App-owned image drafts stay with the originating workbench and session. */
export function useImageDrafts() {
  const drafts = useRef(new Map<string, Draft>());
  const [, setRevision] = useState(0);
  const imageDraft = useCallback(
    (workbenchId: string, sessionId: string) => drafts.current.get(`${workbenchId}/${sessionId}`) ?? blank,
    [],
  );
  const update = useCallback(
    (workbenchId: string, sessionId: string, patch: Partial<Draft>) => {
      const key = `${workbenchId}/${sessionId}`;
      const next = { ...imageDraft(workbenchId, sessionId), ...patch };
      if (next.images.length || next.pending || next.error || next.full) drafts.current.set(key, next);
      else drafts.current.delete(key);
      setRevision((current) => current + 1);
    },
    [imageDraft],
  );

  const addImages = useCallback(
    async (workbenchId: string, sessionId: string, inputs: readonly (File | string)[]) => {
      if (!inputs.length) return;
      if (imageDraft(workbenchId, sessionId).pending) {
        update(workbenchId, sessionId, { error: veraError("BUSY") });
        return;
      }
      update(workbenchId, sessionId, { pending: true, error: undefined, full: false });
      try {
        for (const input of inputs) {
          const { images } = imageDraft(workbenchId, sessionId);
          if (typeof input === "string" && images.some((image) => image.path === input)) continue;
          if (images.length >= appAdvancedValue("imagesPerMessage")) {
            update(workbenchId, sessionId, { full: true });
            break;
          }
          try {
            const source = typeof input === "string" ? { path: input } : await imageSource(input);
            const image = await api.invoke("session.image.attach", { workbenchId, sessionId, source });
            const { images: current } = imageDraft(workbenchId, sessionId);
            if (!current.some(({ path }) => path === image.path))
              update(workbenchId, sessionId, { images: [...current, image] });
          } catch (error) {
            update(workbenchId, sessionId, { error });
          }
        }
      } finally {
        update(workbenchId, sessionId, { pending: false });
      }
    },
    [imageDraft, update],
  );

  const clearImages = useCallback(
    (workbenchId: string, sessionId: string, paths: readonly string[]) => {
      update(workbenchId, sessionId, {
        images: imageDraft(workbenchId, sessionId).images.filter(({ path }) => !paths.includes(path)),
        error: undefined,
        full: false,
      });
    },
    [imageDraft, update],
  );
  return { imageDraft, addImages, clearImages };
}
