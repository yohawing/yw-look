import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TooltipProvider } from "./components/ui/Tooltip";
import { initializeRuntimeLogging } from "./lib/runtimeLogging";
import "./styles/design-system.css";
import "./styles/utilities.css";
import "./styles.css";

initializeRuntimeLogging();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
