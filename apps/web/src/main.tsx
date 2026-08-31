import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BetaEntryGate } from "./BetaEntryGate";
import { ApiReadinessGate } from "./ApiReadinessGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ApiReadinessGate><BetaEntryGate><App /></BetaEntryGate></ApiReadinessGate>
  </StrictMode>,
);
