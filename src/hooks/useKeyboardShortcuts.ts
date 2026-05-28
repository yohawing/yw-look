import { useEffect, useEffectEvent } from "react";
import type { DirectoryListing } from "../lib/files";
import {
  resolveShortcutAction as resolveMenuShortcutAction,
  type MenuActionId,
} from "../lib/menu";
import {
  isEditableShortcutTarget as isViewerEditable,
  resolveViewerShortcutAction,
  type ViewerShortcutAction,
} from "../lib/viewerShortcuts";

export function useKeyboardShortcuts(
  canNavigatePrev: boolean,
  canNavigateNext: boolean,
  directoryListing: DirectoryListing | null,
  onNavigateError: (error: unknown) => void,
  performSelectFilePath: (path: string, reason: "navigation") => Promise<void>,
  executeViewerShortcutAction: (action: ViewerShortcutAction) => void,
  executeMenuAction: (actionId: MenuActionId) => void,
) {
  const navigateFromEffect = useEffectEvent(
    async (path: string, reason: "navigation") => {
      await performSelectFilePath(path, reason);
    },
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (
        isTyping ||
        !directoryListing ||
        directoryListing.currentIndex === null
      ) {
        return;
      }

      if (event.key === "ArrowLeft" && canNavigatePrev) {
        event.preventDefault();
        const nextFile =
          directoryListing.files[directoryListing.currentIndex - 1];
        void navigateFromEffect(nextFile.path, "navigation").catch(
          onNavigateError,
        );
      }

      if (event.key === "ArrowRight" && canNavigateNext) {
        event.preventDefault();
        const nextFile =
          directoryListing.files[directoryListing.currentIndex + 1];
        void navigateFromEffect(nextFile.path, "navigation").catch(
          onNavigateError,
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canNavigateNext, canNavigatePrev, directoryListing]);

  const runViewerShortcutAction = useEffectEvent(
    (action: ViewerShortcutAction) => {
      executeViewerShortcutAction(action);
    },
  );

  useEffect(() => {
    const handleViewerShortcutDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isViewerEditable(event.target)) return;

      const action = resolveViewerShortcutAction(event);
      if (!action) return;

      event.preventDefault();
      runViewerShortcutAction(action);
    };

    window.addEventListener("keydown", handleViewerShortcutDown);
    return () => {
      window.removeEventListener("keydown", handleViewerShortcutDown);
    };
  }, []);

  const runMenuActionFromShortcut = useEffectEvent((actionId: MenuActionId) => {
    executeMenuAction(actionId);
  });

  useEffect(() => {
    const handleShortcutDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const actionId = resolveMenuShortcutAction(event);
      if (!actionId) return;

      if (isViewerEditable(event.target)) return;

      event.preventDefault();
      runMenuActionFromShortcut(actionId);
    };

    window.addEventListener("keydown", handleShortcutDown);
    return () => {
      window.removeEventListener("keydown", handleShortcutDown);
    };
  }, []);
}
