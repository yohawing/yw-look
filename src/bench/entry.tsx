import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BenchRunner } from "./BenchRunner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BenchRunner />
  </StrictMode>,
);
