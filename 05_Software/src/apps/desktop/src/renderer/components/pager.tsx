// REQ-UX-052f5851 REQ-UX-441b5a9d
import { advancedSettings } from "@vera/shared";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppAdvanced } from "../hooks/app-advanced.js";

/** The sizes the pager offers: the Rows per page choices. */
const SIZES = advancedSettings.pageSize.options;

/**
 * One page of a list, with the state the shared Pager drives: rows per page and the current page.
 * A list starts at its own `initialSize`, else the resolved Rows per page; a size picked in the list stays.
 * The page falls back into range when the list shrinks (a filter, a removed row).
 */
export function usePaged<T>(items: readonly T[], initialSize?: (typeof SIZES)[number]) {
  const resolved = useAppAdvanced("pageSize");
  const [picked, setPicked] = useState<number>();
  const pageSize = picked ?? initialSize ?? resolved;
  const [page, setPage] = useState(1);
  // Any page size change, a saved Rows per page included, returns to page one (REQ-UX-052f5851).
  const [shownSize, setShownSize] = useState(pageSize);
  if (shownSize !== pageSize) {
    setShownSize(pageSize);
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const current = Math.min(page, pages);
  return {
    rows: items.slice((current - 1) * pageSize, current * pageSize),
    pager: {
      count: items.length,
      page: current,
      pageSize,
      setPage,
      setPageSize: (size: number) => {
        setPicked(size);
        setPage(1);
      },
    },
  };
}

/** Rows per page and page navigation under a list or table; hidden for lists of ten rows or fewer. */
export function Pager({ count, page, pageSize, setPage, setPageSize }: ReturnType<typeof usePaged>["pager"]) {
  const { t } = useTranslation();
  const id = useId();
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count <= SIZES[0]) return null;
  return (
    <div className="pager" data-pager>
      <span data-pager-range>
        {t("pager.range", {
          first: (page - 1) * pageSize + 1,
          last: Math.min(page * pageSize, count),
          count,
        })}
      </span>
      <label htmlFor={`${id}-size`}>
        {t("pager.pageSize")}
        <select
          id={`${id}-size`}
          data-pager-size
          value={pageSize}
          onChange={(event) => setPageSize(Number(event.target.value))}
        >
          {SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div className="pager-nav">
        <button type="button" data-pager-previous disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t("pager.previous")}
        </button>
        <span>{t("pager.page", { page, pages })}</span>
        <button type="button" data-pager-next disabled={page >= pages} onClick={() => setPage(page + 1)}>
          {t("pager.next")}
        </button>
      </div>
    </div>
  );
}
