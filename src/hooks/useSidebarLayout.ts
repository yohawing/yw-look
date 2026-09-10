import { useCallback, useState } from "react";
import type { GroupProps } from "react-resizable-panels";
import { useUiStore, type SidebarLayoutId } from "../stores/uiStore";

/** Restore once; changing Panel defaults during a drag cancels the gesture. */
export function useSidebarLayout(id: SidebarLayoutId) {
  const [defaultLayout] = useState(
    () => useUiStore.getState().sidebarLayouts[id],
  );
  const onLayoutChanged = useCallback<
    NonNullable<GroupProps["onLayoutChanged"]>
  >(
    (layout, { isUserInteraction }) => {
      if (isUserInteraction) useUiStore.getState().setSidebarLayout(id, layout);
    },
    [id],
  );
  return { defaultLayout, onLayoutChanged };
}
