import { useEffect, useState } from "react";

export type DebugPanelFixtures =
  typeof import("../components/debugPanelFixtures");
type DebugPanelFixturesState =
  | { debugFixtures: DebugPanelFixtures; useDebugFixtures: true }
  | { debugFixtures: DebugPanelFixtures | null; useDebugFixtures: false };

export function useDebugPanelFixtures(
  debugPanelsEnabled: boolean,
): DebugPanelFixturesState {
  const [debugFixtures, setDebugFixtures] = useState<DebugPanelFixtures | null>(
    null,
  );
  useEffect(() => {
    if (!import.meta.env.DEV || !debugPanelsEnabled) {
      return;
    }

    let isActive = true;
    void import("../components/debugPanelFixtures").then((module) => {
      if (isActive) {
        setDebugFixtures(module);
      }
    });
    return () => {
      isActive = false;
    };
  }, [debugPanelsEnabled]);

  if (import.meta.env.DEV && debugPanelsEnabled && debugFixtures !== null) {
    return { debugFixtures, useDebugFixtures: true };
  }

  return { debugFixtures, useDebugFixtures: false };
}
