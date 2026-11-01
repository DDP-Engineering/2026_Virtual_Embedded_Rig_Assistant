import {
  Activity,
  ArrowLeft,
  Folder,
  Home,
  PanelLeft,
  PanelRight,
  Plus,
  Puzzle,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { defaultLayout, type Layout, readLayout, saveLayout } from "../lib/layout.js";
import { ShortcutContext, shortcutCommand } from "../lib/shortcuts.js";
import { useDocumentSource } from "./documents/viewer-context.js";

type Side = "sidebar" | "right";
function initialLayout() {
  try {
    return readLayout(localStorage);
  } catch {
    return { ...defaultLayout };
  }
}
export function Shell({
  children,
  navigation,
  settings,
  navigate,
  newWorkbench,
  openWorkbench,
  showPlugins,
  newSelected,
  pluginsSelected,
  context,
  changes,
  artifacts,
  plan,
  docs,
  source,
}: {
  children?: ReactNode;
  navigation: ReactNode;
  settings: boolean;
  navigate: (settings: boolean) => void;
  newWorkbench?: () => void;
  openWorkbench?: () => void;
  showPlugins?: () => void;
  newSelected?: boolean;
  pluginsSelected?: boolean;
  context?: ReactNode;
  changes?: ReactNode;
  artifacts?: ReactNode;
  plan?: ReactNode;
  docs?: ReactNode;
  source?: ReactNode;
}) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState(initialLayout);
  const bindings = useContext(ShortcutContext);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const command = shortcutCommand(event, bindings);
      if (command !== "toggleSidebar" && command !== "toggleRightPanel") return;
      event.preventDefault();
      setLayout((value) =>
        command === "toggleSidebar"
          ? { ...value, sidebarCollapsed: !value.sidebarCollapsed }
          : { ...value, rightCollapsed: !value.rightCollapsed },
      );
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [bindings]);
  const [tab, setTab] = useState("context");
  // Every opened source reveals the Source tab beside the conversation; closing it returns to the
  // tab (and collapsed state) it was opened from, which stays mounted so its opener keeps focus.
  const sourceState = useDocumentSource();
  const sourceRevision = sourceState?.revision ?? 0,
    sourceClosed = sourceState?.closed ?? 0;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const back = useRef<{ tab: string; collapsed: boolean } | null>(null);
  // The tab whose return makes the opener visible again; focus is restored once it is shown.
  const restoreTab = useRef<string | null>(null);
  useEffect(() => {
    if (!sourceRevision) return;
    setLayout((value) => {
      if (!back.current && tabRef.current !== "source")
        back.current = { tab: tabRef.current, collapsed: value.rightCollapsed };
      return value.rightCollapsed ? { ...value, rightCollapsed: false } : value;
    });
    setTab("source");
  }, [sourceRevision]);
  useEffect(() => {
    if (!sourceClosed) return;
    const previous = back.current;
    back.current = null;
    if (previous) {
      setTab(previous.tab);
      if (previous.collapsed) setLayout((value) => ({ ...value, rightCollapsed: true }));
    }
    restoreTab.current = previous?.tab ?? tabRef.current;
  }, [sourceClosed]);
  useEffect(() => {
    if (restoreTab.current === null || restoreTab.current !== tab) return;
    restoreTab.current = null;
    // When the opener is gone, focus the visible tab (or the main content) instead of the page.
    if (sourceState?.restoreFocus() === "lost")
      (
        (!layout.rightCollapsed && document.getElementById(`tab-${tab}`)) ||
        document.getElementById("main-content")
      )?.focus();
  });
  // Choosing another tab, by mouse or keyboard, ends the return path of an open source.
  const select = (id: string) => {
    if (id !== "source") back.current = null;
    setTab(id);
  };
  // The Source tab resizes its own width over a wider range (up to 60vw in CSS).
  const field = (side: Side) => (side === "right" && tab === "source" ? "source" : side);
  const ranges = { sidebar: [12, 24], right: [14, 28], source: [20, 90] } as const;
  useEffect(() => {
    if (settings) setLayout((value) => ({ ...value, sidebarCollapsed: false }));
  }, [settings]);
  const [menuUnavailable, setMenuUnavailable] = useState(false);
  function openMenu(menu: "file" | "edit" | "view" | "help", button: HTMLButtonElement) {
    const bounds = button.getBoundingClientRect();
    setMenuUnavailable(false);
    void api
      .invoke("window.menu", {
        menu,
        x: Math.max(0, Math.min(32767, Math.round(bounds.left))),
        y: Math.max(0, Math.min(32767, Math.round(bounds.bottom))),
      })
      .catch(() => setMenuUnavailable(true));
  }
  const drag = useRef<{ side: Side; start: number; width: number } | null>(null);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const projectFocusPending = useRef(false);
  useEffect(() => {
    if (!layout.sidebarCollapsed && projectFocusPending.current && !settings) {
      projectFocusPending.current = false;
      document
        .querySelector<HTMLElement>(
          "#sidebar-details select:not(:disabled), #sidebar-details button:not(:disabled)",
        )
        ?.focus();
    }
  }, [layout.sidebarCollapsed, settings]);
  useEffect(() => {
    const focusMenus = (event: KeyboardEvent) => {
      if (
        event.key !== "F10" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      document.querySelector<HTMLButtonElement>('[data-window-menu="file"]')?.focus();
    };
    window.addEventListener("keydown", focusMenus);
    return () => window.removeEventListener("keydown", focusMenus);
  }, []);
  useEffect(() => {
    try {
      saveLayout(localStorage, layout);
    } catch {
      /* Storage disabled. */
    }
  }, [layout]);
  function resize(side: Side, width: number) {
    const key = field(side);
    const [min, max] = ranges[key];
    setLayout((value) => ({ ...value, [key]: Math.max(min, Math.min(max, width)) }));
  }
  function move(event: PointerEvent<HTMLHRElement>) {
    const active = drag.current;
    if (!active) return;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    resize(
      active.side,
      active.width + ((event.clientX - active.start) / rem) * (active.side === "sidebar" ? 1 : -1),
    );
  }
  function separator(side: Side) {
    const label = side === "sidebar" ? t("layout.resizeSidebar") : t("layout.resizeRight");
    return (
      <hr
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={ranges[field(side)][0]}
        aria-valuemax={ranges[field(side)][1]}
        aria-valuenow={layout[field(side)]}
        data-resize={side}
        className={`resizer resizer-${side}`}
        onPointerDown={(event) => {
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { side, start: event.clientX, width: layout[field(side)] };
        }}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const range = ranges[field(side)];
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            resize(side, range[event.key === "Home" ? 0 : 1] ?? 12);
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            resize(
              side,
              layout[field(side)] + (event.key === "ArrowRight" ? 1 : -1) * (side === "sidebar" ? 1 : -1),
            );
          }
        }}
      />
    );
  }
  const tabs = [
    { id: "context", label: t("panel.context") },
    { id: "docs", label: t("panel.docs") },
    { id: "source", label: t("panel.source") },
    { id: "changes", label: t("panel.changes") },
    { id: "artifacts", label: t("panel.artifacts") },
    { id: "plan", label: t("panel.plan") },
  ];
  const style = {
    "--sidebar-width": `${layout.sidebar}rem`,
    "--right-width": `${layout[field("right")]}rem`,
  } as CSSProperties;
  return (
    <div className="app-shell" style={style}>
      <button
        type="button"
        className="skip-content"
        onClick={() => document.getElementById("main-content")?.focus()}
      >
        {t("nav.skipToContent")}
      </button>
      <header className="topbar">
        <button
          type="button"
          data-toggle="sidebar"
          aria-label={t("layout.toggleSidebar")}
          title={t("layout.toggleSidebar")}
          aria-expanded={!layout.sidebarCollapsed}
          aria-controls="sidebar-details"
          onClick={() =>
            setLayout((value: Layout) => ({ ...value, sidebarCollapsed: !value.sidebarCollapsed }))
          }
        >
          <PanelLeft aria-hidden="true" />
        </button>
        <div
          className="window-menus"
          role="menubar"
          aria-label={t("windowMenu.main")}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % buttons.length
                : event.key === "ArrowLeft"
                  ? (index + buttons.length - 1) % buttons.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : undefined;
            if (next !== undefined) {
              event.preventDefault();
              buttons[next]?.focus();
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              buttons[index]?.click();
            }
          }}
        >
          {(
            [
              ["file", t("windowMenu.file")],
              ["edit", t("windowMenu.edit")],
              ["view", t("windowMenu.view")],
              ["help", t("windowMenu.help")],
            ] as const
          ).map(([menu, label]) => (
            <button
              key={menu}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              data-window-menu={menu}
              onClick={(event) => openMenu(menu, event.currentTarget)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="topbar-spacer" />
        <button
          ref={panelToggle}
          type="button"
          data-toggle="right"
          aria-label={t("layout.toggleRight")}
          title={t("layout.toggleRight")}
          aria-expanded={!layout.rightCollapsed}
          aria-controls="right-panel"
          onClick={() => setLayout((value) => ({ ...value, rightCollapsed: !value.rightCollapsed }))}
        >
          <PanelRight aria-hidden="true" />
        </button>
      </header>
      <div className="shell-body">
        <aside id="sidebar" data-panel="sidebar" className="sidebar" data-collapsed={layout.sidebarCollapsed}>
          <div className="sidebar-brand" hidden={layout.sidebarCollapsed}>
            <Activity aria-hidden="true" />
            <h1 data-i18n="home.title">{t("home.title")}</h1>
          </div>
          {settings && (
            <button
              type="button"
              className="sidebar-action sidebar-back"
              data-action="leave-settings"
              onClick={() => navigate(false)}
            >
              <ArrowLeft aria-hidden="true" />
              <span>{t("projects.back")}</span>
            </button>
          )}
          <nav className="sidebar-primary" hidden={settings} aria-label={t("nav.main")}>
            <button
              type="button"
              className="sidebar-action"
              data-i18n="nav.welcome"
              aria-label={newWorkbench ? t("projects.new") : t("nav.welcome")}
              title={newWorkbench ? t("projects.new") : t("nav.welcome")}
              aria-current={!settings && (newSelected ?? true) ? "page" : undefined}
              onClick={() => (newWorkbench ? newWorkbench() : navigate(false))}
            >
              {newWorkbench ? <Plus aria-hidden="true" /> : <Home aria-hidden="true" />}
              <span className="nav-label">{newWorkbench ? t("projects.new") : t("nav.welcome")}</span>
            </button>
            {openWorkbench && (
              <button
                type="button"
                className="sidebar-action"
                data-action="open-workbench-nav"
                aria-label={t("projects.open")}
                title={t("projects.open")}
                onClick={openWorkbench}
              >
                <Folder aria-hidden="true" />
                <span className="nav-label">{t("projects.open")}</span>
              </button>
            )}
            {showPlugins && (
              <button
                type="button"
                className="sidebar-action"
                data-action="plugins-nav"
                aria-current={pluginsSelected ? "page" : undefined}
                aria-label={t("projects.plugins")}
                title={t("projects.plugins")}
                onClick={showPlugins}
              >
                <Puzzle aria-hidden="true" />
                <span className="nav-label">{t("projects.plugins")}</span>
              </button>
            )}
            <button
              type="button"
              className="sidebar-action"
              data-action="show-projects"
              hidden={!layout.sidebarCollapsed}
              aria-label={t("welcome.workbenches")}
              title={t("welcome.workbenches")}
              onClick={() => {
                projectFocusPending.current = true;
                setLayout((value) => ({ ...value, sidebarCollapsed: false }));
                navigate(false);
              }}
            >
              <Folder aria-hidden="true" />
              <span className="nav-label">{t("welcome.workbenches")}</span>
            </button>
          </nav>
          <div id="sidebar-details" className="sidebar-details" hidden={layout.sidebarCollapsed}>
            {navigation}
          </div>
          <button
            type="button"
            className="sidebar-settings sidebar-action"
            data-i18n="nav.settings"
            aria-label={t("nav.settings")}
            title={t("nav.settings")}
            aria-current={settings ? "page" : undefined}
            onClick={() => navigate(true)}
          >
            <SettingsIcon aria-hidden="true" />
            <span className="nav-label">{t("nav.settings")}</span>
          </button>
          {!layout.sidebarCollapsed && separator("sidebar")}
        </aside>
        <main id="main-content" tabIndex={-1}>
          {menuUnavailable && <p role="alert">{t("windowMenu.unavailable")}</p>}
          {children}
        </main>
        {!layout.rightCollapsed && (
          <aside id="right-panel" data-panel="right" data-tab={tab} className="right-panel">
            {separator("right")}
            <div className="panel-header">
              <strong>{t("panel.title")}</strong>
              <button
                type="button"
                onClick={() => {
                  setLayout((value) => ({ ...value, rightCollapsed: true }));
                  panelToggle.current?.focus();
                }}
              >
                {t("panel.close")}
              </button>
            </div>
            <div className="panel-tabs" role="tablist" aria-label={t("panel.title")}>
              {tabs.map(({ id, label }) => (
                <button
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-controls={`panel-${id}`}
                  aria-selected={tab === id}
                  tabIndex={tab === id ? 0 : -1}
                  key={id}
                  onClick={() => select(id)}
                  onKeyDown={(event) => {
                    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing)
                      return;
                    const index = tabs.findIndex((entry) => entry.id === id);
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : event.key === "ArrowRight"
                            ? (index + 1) % tabs.length
                            : event.key === "ArrowLeft"
                              ? (index + tabs.length - 1) % tabs.length
                              : undefined;
                    const target = next === undefined ? undefined : tabs[next];
                    if (target) {
                      event.preventDefault();
                      select(target.id);
                      document.getElementById(`tab-${target.id}`)?.focus();
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {tabs.map(({ id }) => (
              <div
                key={id}
                role="tabpanel"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Panel focus makes static tab content reachable.
                tabIndex={0}
                hidden={tab !== id}
                id={`panel-${id}`}
                aria-labelledby={`tab-${id}`}
              >
                {(tab === id || (tab === "source" && back.current?.tab === id)) &&
                  ((id === "context"
                    ? context
                    : id === "docs"
                      ? docs
                      : id === "source"
                        ? source
                        : id === "changes"
                          ? changes
                          : id === "artifacts"
                            ? artifacts
                            : plan) ?? <p className="muted">{t("panel.placeholder")}</p>)}
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
