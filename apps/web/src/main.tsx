import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BetaEntryGate } from "./BetaEntryGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BetaEntryGate><App /></BetaEntryGate>
  </StrictMode>,
);
