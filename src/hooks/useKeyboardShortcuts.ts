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

const navigationInteractiveSelector = [
  "a[href]",
  "button",
  "dialog",
  "input",
  "select",
  "summary",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="dialog"]',
  '[role="grid"]',
  '[role="gridcell"]',
  '[role="link"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="searchbox"]',
  '[role="scrollbar"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="textbox"]',
  '[role="tree"]',
  '[role="treegrid"]',
  '[role="treeitem"]',
].join(", ");

function isNavigationProtectedTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest(navigationInteractiveSelector) !== null;
}

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

      if (
        event.isComposing ||
        event.key === "Process" ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isNavigationProtectedTarget(event.target) ||
        !directoryListing ||
        directoryListing.currentIndex === null
      ) {
        return;
      }

      if (event.key === "PageUp" && canNavigatePrev) {
        event.preventDefault();
        const nextFile =
          directoryListing.files[directoryListing.currentIndex - 1];
        void navigateFromEffect(nextFile.path, "navigation").catch(
          onNavigateError,
        );
      }

      if (event.key === "PageDown" && canNavigateNext) {
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
