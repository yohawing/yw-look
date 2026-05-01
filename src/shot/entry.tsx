import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShotRunner } from "./ShotRunner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShotRunner />
  </StrictMode>,
);
