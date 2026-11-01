// REQ-UX-541a5bee REQ-UX-89cdb49d
import { ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TreeMenuItem {
  action: string;
  label: string;
  /** Accessible name when it says more than the label, such as the file it acts on. */
  name?: string;
  /** Shown but inert (`aria-disabled`), still reachable by the arrow keys (TASK-2fef1397). */
  disabled?: boolean;
  /** A submenu's items (TASK-eae3a69e); an item has either these or `run`. */
  items?: readonly TreeMenuItem[];
  run?: () => void;
}

/**
 * The context menu of a Docs tree row (TASK-66b7d4aa), placed at a viewport point and kept inside
 * the window. Focus starts on the first item; arrow keys wrap, Home and End jump, Enter or Space
 * runs an item, Escape and Tab close. A press outside, a window blur or resize, or scrolling what
 * holds the menu closes it as well. An item with `items` opens one submenu beside it by click,
 * hover, Enter, Space or ArrowRight; ArrowLeft or Escape closes it and focus returns to its item.
 */
export function TreeMenu({
  label,
  x,
  y,
  items,
  close,
}: {
  label: string;
  x: number;
  y: number;
  items: readonly TreeMenuItem[];
  /** Closes the menu; with `restore` focus goes back to the row. */
  close: (restore: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const closing = useRef(close);
  closing.current = close;
  const [open, setOpen] = useState<string>();
  // Set when a submenu opens from the keyboard, so its first item takes focus.
  const focusSubmenu = useRef(false);
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width))}px`;
    node.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height))}px`;
  }, [x, y]);
  useLayoutEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  useLayoutEffect(() => {
    if (open === undefined) return;
    const submenu = menu.current?.querySelector<HTMLElement>(`[data-submenu="${open}"]`);
    if (!submenu) return;
    // The Docs panel sits at the window's right edge, so a submenu often opens to the left.
    const rect = submenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) submenu.dataset.side = "left";
    if (rect.bottom > window.innerHeight) submenu.style.top = `${window.innerHeight - rect.bottom}px`;
    if (focusSubmenu.current) {
      focusSubmenu.current = false;
      submenu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [open]);
  useEffect(() => {
    const press = (event: MouseEvent) => {
      if (!(event.target instanceof Node && menu.current?.contains(event.target))) closing.current(false);
    };
    // Only scrolling that moves the rows under the fixed menu closes it, not a chat streaming elsewhere.
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.current && event.target.contains(menu.current))
        closing.current(false);
    };
    const dismiss = () => closing.current(false);
    document.addEventListener("mousedown", press, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("mousedown", press, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, []);
  const find = (action: string | undefined) =>
    [...items, ...items.flatMap((item) => item.items ?? [])].find((item) => item.action === action);
  // The row gets focus back before the item runs, so a dialog it opens returns focus to the row.
  const run = (item: TreeMenuItem) => {
    if (item.disabled) return;
    closing.current(true);
    item.run?.();
  };
  const openSubmenu = (item: TreeMenuItem, fromKeyboard: boolean) => {
    // An open submenu re-renders nothing, so its first item is focused here instead.
    focusSubmenu.current = fromKeyboard && open !== item.action;
    if (open === item.action && fromKeyboard)
      menu.current?.querySelector<HTMLElement>(`[data-submenu="${item.action}"] [role="menuitem"]`)?.focus();
    setOpen(item.action);
  };
  const closeSubmenu = () => {
    const parent = open;
    setOpen(undefined);
    menu.current?.querySelector<HTMLElement>(`[data-menu-depth="0"][data-menu-action="${parent}"]`)?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const owner = focused?.closest('[role="menu"]');
    // The items of the menu that holds focus, without those of a nested submenu.
    const buttons = [...(owner?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].filter(
      (button) => button.closest('[role="menu"]') === owner,
    );
    const index = focused ? buttons.indexOf(focused) : -1;
    const item = find(focused?.dataset.menuAction);
    const inSubmenu = owner !== menu.current;
    const focus = (target: number) => {
      event.preventDefault();
      buttons[(target + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index < 0 ? -1 : index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(buttons.length - 1);
    else if (event.key === "ArrowRight" && item?.items) {
      event.preventDefault();
      openSubmenu(item, true);
    } else if (event.key === "ArrowLeft" && inSubmenu) {
      event.preventDefault();
      closeSubmenu();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (inSubmenu) closeSubmenu();
      else closing.current(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closing.current(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (item?.items) openSubmenu(item, true);
      else if (item) run(item);
    }
  };
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="tree-menu"
      data-tree-menu
      style={{ left: x, top: y }}
      onKeyDown={onKey}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.action} role="none" className="tree-menu-group">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-menu-action={item.action}
            data-menu-depth="0"
            aria-label={item.name}
            aria-disabled={item.disabled ? "true" : undefined}
            aria-haspopup={item.items ? "menu" : undefined}
            aria-expanded={item.items ? open === item.action : undefined}
            // A pointer reaches an item before clicking it, so the click must not close what hover opened.
            onClick={() => (item.items ? openSubmenu(item, false) : run(item))}
            // Pointing at another item closes an open submenu, or opens this item's own.
            onMouseEnter={() => setOpen(item.items ? item.action : undefined)}
          >
            <span>{item.label}</span>
            {item.items && <ChevronRight aria-hidden="true" />}
          </button>
          {item.items && open === item.action && (
            <div role="menu" aria-label={item.label} className="tree-submenu" data-submenu={item.action}>
              {item.items.map((child) => (
                <button
                  key={child.action}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  data-menu-action={child.action}
                  data-menu-depth="1"
                  aria-label={child.name}
                  onClick={() => run(child)}
                >
                  {child.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
