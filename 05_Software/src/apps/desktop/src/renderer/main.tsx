import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/error-boundary.js";
import "./i18n.js";
import "./styles.css";

declare const __VERA_TEST__: boolean;

if (__VERA_TEST__ && window.vera) {
  void import("./dictation/capture.js").then(({ createDictationCapture }) => {
    if (window.vera)
      Object.assign(window, { veraTestDictation: createDictationCapture.bind(null, window.vera) });
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing renderer root");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
