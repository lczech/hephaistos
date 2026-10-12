import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";
import { takeTokenFromUrl } from "./token";

takeTokenFromUrl();

// No retries: the next poll asks again a few seconds later anyway.
const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
