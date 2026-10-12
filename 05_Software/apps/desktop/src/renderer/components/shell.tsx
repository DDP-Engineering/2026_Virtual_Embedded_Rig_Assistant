import { Activity, PanelLeft, PanelRight } from "lucide-react";
import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { defaultLayout, type Layout, readLayout, saveLayout } from "../lib/layout.js";

type Side = "sidebar" | "right";
function initialLayout() {
  try {
    return readLayout(localStorage);
  } catch {
    return { layout: { ...defaultLayout }, readOnly: false };
  }
}
export function Shell({
  children,
  navigation,
  settings,
  navigate,
  storageReadOnly,
  context,
  changes,
  artifacts,
}: {
  children: ReactNode;
  navigation: ReactNode;
  settings: boolean;
  navigate: (settings: boolean) => void;
  storageReadOnly: boolean;
  context?: ReactNode;
  changes?: ReactNode;
  artifacts?: ReactNode;
}) {
  const { t } = useTranslation();
  const [initial] = useState(initialLayout);
  const [layout, setLayout] = useState(initial.layout);
  const [tab, setTab] = useState("context");
  const drag = useRef<{ side: Side; start: number; width: number } | null>(null);
  const panelToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    try {
      saveLayout(localStorage, layout, initial.readOnly || storageReadOnly);
    } catch {
      /* Storage disabled. */
    }
  }, [layout, initial.readOnly, storageReadOnly]);
  function resize(side: Side, width: number) {
    setLayout((value) => ({
      ...value,
      [side]: Math.max(side === "sidebar" ? 12 : 14, Math.min(side === "sidebar" ? 24 : 28, width)),
    }));
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
        aria-valuemin={side === "sidebar" ? 12 : 14}
        aria-valuemax={side === "sidebar" ? 24 : 28}
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
          const range = side === "sidebar" ? [12, 24] : [14, 28];
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
  const tabs = [
    { id: "context", label: t("panel.context") },
    { id: "docs", label: t("panel.docs") },
    { id: "changes", label: t("panel.changes") },
    { id: "artifacts", label: t("panel.artifacts") },
    { id: "plan", label: t("panel.plan") },
  ];
  const style = {
    "--sidebar-width": `${layout.sidebar}rem`,
    "--right-width": `${layout.right}rem`,
  } as CSSProperties;
  return (
    <div className="app-shell" style={style}>
      <header className="topbar">
        <Activity aria-hidden="true" />
        <h1 data-i18n="home.title">{t("home.title")}</h1>
        <button
          type="button"
          data-toggle="sidebar"
          aria-label={t("layout.toggleSidebar")}
          aria-expanded={!layout.sidebarCollapsed}
          aria-controls="sidebar"
          onClick={() =>
            setLayout((value: Layout) => ({ ...value, sidebarCollapsed: !value.sidebarCollapsed }))
          }
        >
          <PanelLeft aria-hidden="true" />
        </button>
        <div className="topbar-spacer" />
        <button
          type="button"
          data-i18n="nav.welcome"
          aria-current={!settings ? "page" : undefined}
          onClick={() => navigate(false)}
        >
          {t("nav.welcome")}
        </button>
        <button
          type="button"
          data-i18n="nav.settings"
          aria-current={settings ? "page" : undefined}
          onClick={() => navigate(true)}
        >
          {t("nav.settings")}
        </button>
        <button
          ref={panelToggle}
          type="button"
          data-toggle="right"
          aria-label={t("layout.toggleRight")}
          aria-expanded={!layout.rightCollapsed}
          aria-controls="right-panel"
          onClick={() => setLayout((value) => ({ ...value, rightCollapsed: !value.rightCollapsed }))}
        >
          <PanelRight aria-hidden="true" />
        </button>
      </header>
      <div className="shell-body">
        {!layout.sidebarCollapsed && (
          <aside id="sidebar" data-panel="sidebar" className="sidebar">
            <nav aria-label={t("nav.main")}>{navigation}</nav>
            {separator("sidebar")}
          </aside>
        )}
        <main>{children}</main>
        {!layout.rightCollapsed && (
          <aside id="right-panel" data-panel="right" className="right-panel">
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
                  key={id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === "context" && context ? (
                context
              ) : tab === "changes" && changes ? (
                changes
              ) : tab === "artifacts" && artifacts ? (
                artifacts
              ) : (
                <p className="muted">{t("panel.placeholder")}</p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
