import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Archive } from "./ArchiveView";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Archive />
  </StrictMode>,
);
