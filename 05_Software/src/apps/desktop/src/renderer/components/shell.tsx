import { type RightPanelTab, rightPanelTabIds } from "@vera/shared";
import {
  Activity,
  ArrowLeft,
  CircleQuestionMark,
  Folder,
  Home,
  PanelLeft,
  PanelRight,
  Plus,
  Puzzle,
  Settings as SettingsIcon,
  X,
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
import ddpLogoDark from "../assets/ddp-logo-dark.png";
import ddpLogoLight from "../assets/ddp-logo-light.png";
import { defaultLayout, type Layout, readLayout, saveLayout } from "../lib/layout.js";
import { ShortcutContext, shortcutCommand } from "../lib/shortcuts.js";
import { rightPanelTabs } from "./right-panel-tabs.js";

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
  showHelp,
  newSelected,
  pluginsSelected,
  context,
  changes,
  artifacts,
  plan,
  docs,
  runs,
  terminal,
  workbenchId,
  visibleTabs = rightPanelTabIds,
  configurePanelTabs,
}: {
  workbenchId?: string | undefined;
  visibleTabs?: readonly RightPanelTab[] | undefined;
  configurePanelTabs?: (() => void) | undefined;
  children?: ReactNode;
  navigation: ReactNode;
  settings: boolean;
  navigate: (settings: boolean) => void;
  newWorkbench?: () => void;
  openWorkbench?: () => void;
  showPlugins?: () => void;
  showHelp?: () => void;
  newSelected?: boolean;
  pluginsSelected?: boolean;
  context?: ReactNode;
  changes?: ReactNode;
  artifacts?: ReactNode;
  plan?: ReactNode;
  docs?: ReactNode;
  runs?: ReactNode;
  terminal?: ReactNode;
}) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState(initialLayout);
  const bindings = useContext(ShortcutContext);
  const tabs = rightPanelTabs(t).filter(({ id }) => visibleTabs.includes(id));
  const [selection, setSelection] = useState<{
    workbenchId: string | undefined;
    tab: RightPanelTab | undefined;
  }>({
    workbenchId,
    tab: "context",
  });
  const tab =
    selection.workbenchId === workbenchId && tabs.some(({ id }) => id === selection.tab)
      ? selection.tab
      : tabs[0]?.id;
  const [blockedRequest, setBlockedRequest] = useState<{
    workbenchId: string | undefined;
    target: "terminal" | "panel";
  }>();
  const hiddenRequest =
    blockedRequest !== undefined &&
    blockedRequest.workbenchId === workbenchId &&
    (blockedRequest.target === "terminal" ? !visibleTabs.includes("terminal") : tabs.length === 0);
  const panelHadFocus = useRef(false);
  const settingsLink = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setSelection({ workbenchId, tab });
  }, [tab, workbenchId]);
  useEffect(() => {
    // A removed selector or panel must not strand focus on the document body.
    if (panelHadFocus.current && document.activeElement === document.body) {
      const target = tab ? document.getElementById(`tab-${tab}`) : null;
      (
        target ??
        settingsLink.current ??
        panelToggle.current ??
        document.getElementById("main-content")
      )?.focus();
      panelHadFocus.current = false;
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const command = shortcutCommand(event, bindings);
      if (command === "openTerminal") {
        event.preventDefault();
        if (!visibleTabs.includes("terminal")) {
          setBlockedRequest({ workbenchId, target: "terminal" });
          return;
        }
        setBlockedRequest(undefined);
        setLayout((value) => ({ ...value, rightCollapsed: false }));
        setSelection({ workbenchId, tab: "terminal" });
        window.setTimeout(
          () => document.querySelector<HTMLTextAreaElement>(".terminal-surface textarea")?.focus(),
          0,
        );
        return;
      }
      if (command !== "toggleSidebar" && command !== "toggleRightPanel") return;
      event.preventDefault();
      if (command === "toggleRightPanel" && visibleTabs.length === 0) {
        setBlockedRequest({ workbenchId, target: "panel" });
        return;
      }
      setLayout((value) =>
        command === "toggleSidebar"
          ? { ...value, sidebarCollapsed: !value.sidebarCollapsed }
          : { ...value, rightCollapsed: !value.rightCollapsed },
      );
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [bindings, visibleTabs, workbenchId]);
  // Each panel can grow up to half the window (to the middle of the screen).
  const halfWindow = () =>
    window.innerWidth / 2 / Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const ranges = {
    sidebar: [12, Math.max(12, Math.floor(halfWindow()))],
    right: [14, Math.max(14, Math.floor(halfWindow()))],
  } as const;
  useEffect(() => {
    if (settings) setLayout((value) => ({ ...value, sidebarCollapsed: false }));
  }, [settings]);
  const [menuUnavailable, setMenuUnavailable] = useState(false);
  function openMenu(menu: "file" | "edit" | "view", button: HTMLButtonElement) {
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
    const [min, max] = ranges[side];
    setLayout((value) => ({ ...value, [side]: Math.max(min, Math.min(max, width)) }));
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
        aria-valuemin={ranges[side][0]}
        aria-valuemax={ranges[side][1]}
        aria-valuenow={layout[side]}
        data-resize={side}
        className={`resizer resizer-${side}`}
        onPointerDown={(event) => {
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { side, start: event.clientX, width: layout[side] };
        }}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const range = ranges[side];
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            resize(side, range[event.key === "Home" ? 0 : 1] ?? 12);
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            resize(
              side,
              layout[side] + (event.key === "ArrowRight" ? 1 : -1) * (side === "sidebar" ? 1 : -1),
            );
          }
        }}
      />
    );
  }
  const style = {
    "--sidebar-width": `${layout.sidebar}rem`,
    "--right-width": `${layout.right}rem`,
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
        {showHelp && (
          <button
            type="button"
            data-action="show-help"
            aria-label={t("help.open")}
            title={t("help.open")}
            onClick={showHelp}
          >
            <CircleQuestionMark aria-hidden="true" />
          </button>
        )}
        {tabs.length > 0 && (
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
        )}
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
          <div className="sidebar-bottom">
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
            {/* The maker's mark beside Settings: no extra row, so the workbench list keeps its height. */}
            <div className="sidebar-maker" data-sidebar-maker hidden={layout.sidebarCollapsed}>
              <img className="maker-logo maker-logo-light" src={ddpLogoLight} alt="DDP Engineering" />
              <img className="maker-logo maker-logo-dark" src={ddpLogoDark} alt="" aria-hidden="true" />
            </div>
          </div>
          {!layout.sidebarCollapsed && separator("sidebar")}
        </aside>
        <main id="main-content" tabIndex={-1}>
          {menuUnavailable && <p role="alert">{t("windowMenu.unavailable")}</p>}
          {hiddenRequest && <p role="status">{t("panel.hiddenTab")}</p>}
          {configurePanelTabs && (hiddenRequest || tabs.length === 0) && (
            <button ref={settingsLink} type="button" data-configure-panel-tabs onClick={configurePanelTabs}>
              {t("projects.rightPanelTabs")}
            </button>
          )}
          {children}
        </main>
        {!layout.rightCollapsed && tabs.length > 0 && (
          <aside
            id="right-panel"
            data-panel="right"
            data-tab={tab}
            className="right-panel"
            aria-label={t("panel.title")}
            onFocusCapture={() => {
              panelHadFocus.current = true;
            }}
            onBlurCapture={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
                panelHadFocus.current = false;
            }}
          >
            {separator("right")}
            <div className="panel-toolbar">
              <div className="panel-tabs" role="tablist" aria-label={t("panel.title")}>
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    type="button"
                    role="tab"
                    id={`tab-${id}`}
                    aria-label={label}
                    title={label}
                    aria-controls={`panel-${id}`}
                    aria-selected={tab === id}
                    tabIndex={tab === id ? 0 : -1}
                    key={id}
                    onClick={() => setSelection({ workbenchId, tab: id })}
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
                        setSelection({ workbenchId, tab: target.id });
                        document.getElementById(`tab-${target.id}`)?.focus();
                      }
                    }}
                  >
                    <Icon aria-hidden="true" />
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="panel-close"
                aria-label={t("panel.close")}
                title={t("panel.close")}
                onClick={() => {
                  setLayout((value) => ({ ...value, rightCollapsed: true }));
                  panelToggle.current?.focus();
                }}
              >
                <X aria-hidden="true" />
              </button>
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
                {tab === id &&
                  ((id === "context"
                    ? context
                    : id === "docs"
                      ? docs
                      : id === "changes"
                        ? changes
                        : id === "artifacts"
                          ? artifacts
                          : id === "plan"
                            ? plan
                            : id === "runs"
                              ? runs
                              : terminal) ?? <p className="muted">{t("panel.placeholder")}</p>)}
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
