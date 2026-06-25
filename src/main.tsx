import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/Tooltip";
import "./styles/design-system.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);
