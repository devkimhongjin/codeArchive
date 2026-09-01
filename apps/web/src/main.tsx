import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ApiReadinessGate } from "./ApiReadinessGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApiReadinessGate><App /></ApiReadinessGate>
  </StrictMode>,
);
