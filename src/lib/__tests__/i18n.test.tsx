import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { SettingsCard } from "../../components/SettingsCard";
import {
  resolveLocale,
  setLanguage,
  t,
  formatLocalizedMessage,
  type LanguagePreference,
} from "../i18n";
import { LocalizedError } from "../localizedMessage";
import type { SettingsPayload } from "../settings";
import { useViewerStore } from "../../stores/viewerStore";
import { useViewerDiagnosticsModel } from "../../app/useViewerDiagnosticsModel";

afterEach(() => {
  cleanup();
  setLanguage("en");
});

describe("language resolution", () => {
  it("refreshes an existing update notification without replacing its update payload", () => {
    const props: Parameters<typeof useViewerDiagnosticsModel>[0] = {
      assetMetadata: null,
      currentFile: null,
      directoryListing: null,
      gridUnitLabel: "cm",
      logDiagnosticEventAndRefresh: async () => {},
      openError: null,
      refreshUpdateConfiguration: async () => {},
      settingsError: null,
      showGrid: false,
      usdInspection: null,
      usdIssues: [],
      usdSummary: null,
      viewerFeedback: {
        mode: "empty",
        message: "",
        warning: null,
        canResetCamera: false,
      },
      updateCheck: {
        configuration: {
          currentVersion: "0.3.4",
          defaultEndpoint: null,
          defaultPubkeyAvailable: false,
          effectiveEndpoint: null,
          effectivePubkeyAvailable: false,
          usingOverrideEndpoint: false,
          usingOverridePubkey: false,
          allowInsecureUpdateEndpoint: false,
        },
        update: {
          version: "0.3.5",
          currentVersion: "0.3.4",
          notes: null,
          pubDate: null,
          target: "windows",
          downloadUrl: "https://example.invalid/update",
        },
      },
    };
    const { result } = renderHook(() => useViewerDiagnosticsModel(props));
    expect(result.current.statusRightItems[0].content).toBe("Update: 0.3.5");
    act(() => setLanguage("ja"));
    expect(result.current.statusRightItems[0].content).toBe("更新：0.3.5");
  });
  it("clears obsolete translated warnings only when a new warning replaces them", () => {
    const original = useViewerStore.getState().viewerFeedback;
    try {
      useViewerStore.getState().updateViewerFeedback({
        warning: "old",
        warningTranslation: { key: "old", defaultValue: "old" },
      });
      useViewerStore.getState().updateViewerFeedback({ canResetCamera: true });
      expect(
        useViewerStore.getState().viewerFeedback.warningTranslation?.key,
      ).toBe("old");
      useViewerStore.getState().updateViewerFeedback({ warning: "new" });
      expect(
        useViewerStore.getState().viewerFeedback.warningTranslation,
      ).toBeUndefined();
    } finally {
      useViewerStore.getState().setViewerFeedback(original);
    }
  });
  it.each([
    ["ja", ["ko-KR"], "ja"],
    ["system", ["ja-JP"], "ja"],
    ["system", ["ko-KR"], "ko"],
    ["system", ["zh-CN"], "zh-Hans"],
    ["system", ["zh-SG"], "zh-Hans"],
    ["system", ["zh-Hans-TW"], "zh-Hans"],
    ["system", ["zh-TW"], "en"],
    ["system", ["zh-Hant-CN"], "en"],
    ["system", ["zh-HK", "ja-JP"], "ja"],
    ["invalid", ["bad_tag", "en-GB"], "en"],
  ])("resolves %s and %j to %s", (preference, languages, expected) => {
    expect(resolveLocale(preference as string, languages as string[])).toBe(
      expected,
    );
  });

  it("updates document language and falls back to the supplied original message", () => {
    setLanguage("ko");
    expect(document.documentElement.lang).toBe("ko");
    expect(
      formatLocalizedMessage(
        new LocalizedError("absent:failure", "Original detail").translation,
      ),
    ).toBe("Original detail");
    expect(t("samples.summary", { shown: 2, total: 150 })).toContain("150");
  });
});

describe("bundled dictionaries", () => {
  const dictionaries = import.meta.glob<{ default: Record<string, string> }>(
    ["../locales/*.json", "../../packs/*/locales/*.json"],
    { eager: true },
  );
  const argumentsIn = (text: string) =>
    [...text.matchAll(/\{\{\s*([^},]+)(?:,[^}]+)?\s*\}\}/g)]
      .map((match) => match[1].trim())
      .sort();

  it("has identical keys and interpolation arguments in every language, including each loader", () => {
    const english = Object.keys(dictionaries).filter((path) =>
      path.endsWith("/en.json"),
    );
    expect(english).toHaveLength(6);
    for (const path of english) {
      const reference = dictionaries[path].default;
      for (const language of ["ja", "zh-Hans", "ko"]) {
        const translated =
          dictionaries[path.replace(/en.json$/, `${language}.json`)].default;
        expect(Object.keys(translated).sort(), path).toEqual(
          Object.keys(reference).sort(),
        );
        for (const key of Object.keys(reference)) {
          expect(translated[key].trim(), `${path}:${language}:${key}`).not.toBe(
            "",
          );
          expect(
            argumentsIn(translated[key]),
            `${path}:${language}:${key}`,
          ).toEqual(argumentsIn(reference[key]));
        }
      }
    }
  });

  it("covers literal translation keys used by UI and loader errors", () => {
    const sources = import.meta.glob<string>(
      [
        "../../**/*.ts",
        "../../**/*.tsx",
        "!../../**/__tests__/**",
        "!../../types/**",
      ],
      { query: "?raw", import: "default", eager: true },
    );
    const lookup = new Map<string, Record<string, string>>();
    for (const [path, module] of Object.entries(dictionaries))
      if (path.endsWith("/en.json")) {
        lookup.set(
          path.includes("/packs/")
            ? path.split("/packs/")[1].split("/")[0]
            : "translation",
          module.default,
        );
      }
    for (const [path, source] of Object.entries(sources)) {
      for (const match of source.matchAll(
        /\b(?:t|LocalizedError)\(\s*"([^"]+)"/g,
      )) {
        const [namespace, key] = match[1].includes(":")
          ? match[1].split(":")
          : ["translation", match[1]];
        const dictionary = lookup.get(namespace);
        expect(
          dictionary?.[key] ?? dictionary?.[`${key}_other`],
          `${path}: ${match[1]}`,
        ).toBeDefined();
      }
    }
  });
});

it("switches the mounted settings UI while preserving its state and leaves recovery controls available on save failure", () => {
  const payload: SettingsPayload = {
    settingsPath: "settings.json",
    settings: {
      version: 5,
      language: "en",
      recentFilesLimit: 20,
      diagnosticsLogLevel: "info",
      fileAssociationsEnabled: false,
      optionalLoaderPacks: {},
      updateEndpointOverride: null,
      updatePublicKeyOverride: null,
      allowInsecureUpdateEndpoint: false,
      autoCheckForUpdates: true,
    },
  };
  function Harness() {
    const [language, change] = useState<LanguagePreference>("en");
    return (
      <SettingsCard
        settingsPayload={{
          ...payload,
          settings: { ...payload.settings, language },
        }}
        settingsError="disk full"
        onChangeLanguage={(next) => {
          change(next);
          setLanguage(next);
        }}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleOptionalLoaderPack={() => undefined}
      />
    );
  }
  render(<Harness />);
  fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
    target: { value: "ja" },
  });
  expect(screen.getByRole("combobox", { name: "言語" })).toHaveValue("ja");
  expect(
    screen.getByRole("switch", { name: "更新を自動確認" }),
  ).toHaveAttribute("aria-checked", "true");
  act(() => setLanguage("ko"));
  expect(screen.getByRole("combobox", { name: "언어" })).toHaveValue("ja");
  expect(screen.getByText(/disk full/)).toBeTruthy();
});
