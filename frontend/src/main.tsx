import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./styles.css";
import "./lib/theme";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { AuthProvider } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import { PreviewBanner } from "./components/PreviewBanner";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            {window.__SIYULAH_PREVIEW__ ? (
              <MemoryRouter initialEntries={["/"]}>
                <PreviewBanner />
                <App />
              </MemoryRouter>
            ) : (
              <BrowserRouter>
                <App />
              </BrowserRouter>
            )}
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
