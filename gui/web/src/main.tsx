import "./theme.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { QUERY_DEFAULTS } from "./api/queries";
import { showScheme } from "./theme";
import { followTokenLinks } from "./token";

followTokenLinks();
showScheme(); // the system's, so that nothing shows light first in the dark

const queries = new QueryClient(QUERY_DEFAULTS);

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queries}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
