import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { freezePerformanceNowForSnapshot } from "./freezePerformanceNow";
import { getViewportStateSnapshotCase } from "./states";
import { ViewportStateSnapshotHarness } from "./ViewportStateSnapshotHarness";
import "../styles/design-system.css";
import "../styles/utilities.css";
import "../styles/viewport.css";
import "../styles/viewer-state.css";
import "../styles/viewport-state-snapshot.css";

freezePerformanceNowForSnapshot();

const params = new URLSearchParams(window.location.search);
const state = params.get("state");
const testCase = getViewportStateSnapshotCase(state);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ViewportStateSnapshotHarness testCase={testCase} />
  </StrictMode>,
);
