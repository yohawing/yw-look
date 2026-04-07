import { useEffect, useMemo, useState } from "react";
import type { RecentFileEntry } from "../lib/recentFiles";
import {
  formatRecentFileLabel,
  getShortcutLabel,
  menuSections,
  type MenuActionId,
  type MenuSectionDefinition,
} from "../lib/menu";

type MenuBarProps = {
  onAction: (actionId: MenuActionId) => void;
  onOpenRecentFile: (path: string) => void;
  recentFiles: RecentFileEntry[];
};

export function MenuBar({
  onAction,
  onOpenRecentFile,
  recentFiles,
}: MenuBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showRecentSubmenu, setShowRecentSubmenu] = useState(false);

  const hasRecentFiles = recentFiles.length > 0;
  const maxRecentFiles = useMemo(() => recentFiles.slice(0, 10), [recentFiles]);

  useEffect(() => {
    if (!openMenuId) {
      return;
    }

    const closeMenus = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".menubar")) {
        return;
      }

      setOpenMenuId(null);
      setShowRecentSubmenu(false);
    };

    const closeByEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setOpenMenuId(null);
      setShowRecentSubmenu(false);
    };

    window.addEventListener("mousedown", closeMenus);
    window.addEventListener("keydown", closeByEscape);
    return () => {
      window.removeEventListener("mousedown", closeMenus);
      window.removeEventListener("keydown", closeByEscape);
    };
  }, [openMenuId]);

  const handleAction = (actionId: MenuActionId) => {
    onAction(actionId);
    setOpenMenuId(null);
    setShowRecentSubmenu(false);
  };

  const renderMenuEntry = (
    section: MenuSectionDefinition,
    entryIndex: number,
  ) => {
    const entry = section.entries[entryIndex];

    if (entry.type === "separator") {
      return (
        <li
          aria-hidden
          className="menu-separator"
          key={`${section.id}-${entryIndex}`}
        />
      );
    }

    if (entry.type === "recentFiles") {
      return (
        <li
          className="menu-item menu-item-has-submenu"
          key={`${section.id}-recentFiles-${entryIndex}`}
          onMouseEnter={() => setShowRecentSubmenu(true)}
          onMouseLeave={() => setShowRecentSubmenu(false)}
        >
          <button
            aria-expanded={showRecentSubmenu}
            aria-haspopup="menu"
            className="menu-item-button"
            onClick={() => setShowRecentSubmenu((current) => !current)}
            type="button"
          >
            <span>{entry.label}</span>
            <span className="menu-item-arrow">▸</span>
          </button>
          {showRecentSubmenu ? (
            <ul className="menu-list menu-submenu" role="menu">
              {hasRecentFiles ? (
                maxRecentFiles.map((recentEntry) => (
                  <li className="menu-item" key={recentEntry.path} role="none">
                    <button
                      className="menu-item-button"
                      onClick={() => {
                        onOpenRecentFile(recentEntry.path);
                        setOpenMenuId(null);
                        setShowRecentSubmenu(false);
                      }}
                      role="menuitem"
                      title={recentEntry.path}
                      type="button"
                    >
                      <span className="menu-item-recent">
                        {formatRecentFileLabel(recentEntry)}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="menu-item" role="none">
                  <span className="menu-item-button is-disabled">
                    No recent files
                  </span>
                </li>
              )}
            </ul>
          ) : null}
        </li>
      );
    }

    const shortcutLabel = getShortcutLabel(entry.id);
    return (
      <li className="menu-item" key={entry.id} role="none">
        <button
          className="menu-item-button"
          onClick={() => handleAction(entry.id)}
          role="menuitem"
          type="button"
        >
          <span>{entry.label}</span>
          {shortcutLabel ? (
            <span className="menu-shortcut">{shortcutLabel}</span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <nav className="menubar" role="menubar">
      {menuSections.map((section) => {
        const isOpen = openMenuId === section.id;
        return (
          <div className="menu-group" key={section.id}>
            <button
              aria-expanded={isOpen}
              aria-haspopup="menu"
              className="menubar-button"
              onClick={() => {
                setShowRecentSubmenu(false);
                setOpenMenuId((current) =>
                  current === section.id ? null : section.id,
                );
              }}
              type="button"
            >
              {section.label}
            </button>
            {isOpen ? (
              <ul className="menu-list" role="menu">
                {section.entries.map((_, entryIndex) =>
                  renderMenuEntry(section, entryIndex),
                )}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
