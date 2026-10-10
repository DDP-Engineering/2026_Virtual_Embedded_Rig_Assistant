import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./i18n.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing renderer root");
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
