import { Bookmark } from "lucide-react";
import { useTranslation } from "react-i18next";

export function BookmarkButton({
  bookmarked,
  disabled,
  onToggle,
}: {
  bookmarked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="bookmark-button"
      data-bookmark
      aria-label={bookmarked ? t("chat.removeBookmark") : t("chat.bookmark")}
      aria-pressed={bookmarked}
      disabled={disabled}
      onClick={onToggle}
    >
      <Bookmark aria-hidden="true" size={16} fill={bookmarked ? "currentColor" : "none"} />
    </button>
  );
}
