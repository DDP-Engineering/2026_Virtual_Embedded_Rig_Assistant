import type { ComposerImage } from "@vera/shared";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function ImageAttachmentChip({ image, remove }: { image: ComposerImage; remove: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const data = Uint8Array.from(atob(image.thumbnail), (character) => character.charCodeAt(0));
    const preview = URL.createObjectURL(new Blob([data], { type: "image/png" }));
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [image.thumbnail]);
  return (
    <li className="attachment-chip" data-image-attachment={image.path} title={image.path}>
      {url && <img className="attachment-preview" src={url} alt="" draggable={false} />}
      <span>{image.name}</span>
      <button type="button" aria-label={t("chat.removeAttachment", { path: image.name })} onClick={remove}>
        <X aria-hidden="true" />
      </button>
    </li>
  );
}
