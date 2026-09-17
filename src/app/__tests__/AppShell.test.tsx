import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { AppShell } from "../AppShell";
import { setLanguage } from "../../lib/i18n";
import type { DialogState } from "../../stores/uiStore";

function renderDialog(dialogState: DialogState) {
  return render(
    <AppShell
      activeTab="properties"
      dialogState={dialogState}
      handleSidebarResizeStart={() => {}}
      onCloseDialog={() => {}}
      onTabChange={() => {}}
      sidebarContent={null}
      sidebarOpen={false}
      sidebarTabs={[]}
      sidebarWidth={350}
      statusLeftItems={[]}
      statusRightItems={[]}
      viewport={null}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLanguage("en");
});

describe("AppShell dialogs", () => {
  it("retranslates an open shortcut dialog after the system language changes", () => {
    const languages = vi.spyOn(navigator, "languages", "get");
    languages.mockReturnValue(["en-US"]);
    setLanguage("system");
    renderDialog({ kind: "shortcuts" });
    const dialog = screen.getByRole("dialog", { name: "Keyboard Shortcuts" });
    expect(dialog).toHaveTextContent("PageUp File > Previous file");
    expect(dialog).toHaveTextContent("File > Open");

    // App's languagechange handler resolves the saved system preference.
    const onLanguageChange = () => setLanguage("system");
    window.addEventListener("languagechange", onLanguageChange);
    try {
      act(() => {
        languages.mockReturnValue(["ja-JP"]);
        window.dispatchEvent(new Event("languagechange"));
      });
      expect(
        screen.getByRole("dialog", { name: "キーボードショートカット" }),
      ).toBe(dialog);
      expect(dialog).toHaveTextContent("PageUp ファイル > 前のファイル");
      expect(dialog).toHaveTextContent("ファイル > 開く");
      expect(dialog).not.toHaveTextContent("File > Previous file");
    } finally {
      window.removeEventListener("languagechange", onLanguageChange);
    }
  });

  it("preserves plain dialog titles and lines across language changes", () => {
    setLanguage("en");
    renderDialog({ title: "Diagnostic detail", lines: ["Original detail"] });
    act(() => setLanguage("ko"));
    expect(
      screen.getByRole("dialog", { name: "Diagnostic detail" }),
    ).toHaveTextContent("Original detail");
  });
});
