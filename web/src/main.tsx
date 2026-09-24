import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { watchTheme } from "@/lib/theme";
import { AppProvider } from "./state/app";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

watchTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
