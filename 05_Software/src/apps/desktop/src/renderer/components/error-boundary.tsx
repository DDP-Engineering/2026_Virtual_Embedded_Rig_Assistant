import { Component, type ReactNode } from "react";
import i18next from "../i18n.js";

/** Shows a message and Reload when rendering fails, instead of an empty window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="render-error" role="alert">
        <p>{i18next.t("renderError.message")}</p>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          {i18next.t("renderError.reload")}
        </button>
      </div>
    );
  }
}
