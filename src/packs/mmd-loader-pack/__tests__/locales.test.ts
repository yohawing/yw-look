import { afterEach, expect, it } from "vitest";
import { loadMmdMotion } from "../loaderUnavailable";
import { LocalizedError } from "../../../lib/localizedMessage";
import { formatLocalizedMessage, setLanguage } from "../../../lib/i18n";

afterEach(() => setLanguage("en"));

it("retains the loader's original error and re-translates the same failure after switching languages", async () => {
  const error: unknown = await loadMmdMotion().catch((error) => error);
  expect(error).toBeInstanceOf(LocalizedError);
  const failure = error as LocalizedError;
  expect(failure.message).toContain("@yohawing/three-mmd-loader");
  expect(failure.translation.key).toBe("mmd-loader-pack:unavailable");
  setLanguage("ja");
  expect(formatLocalizedMessage(failure.translation)).toContain("インストール");
  setLanguage("ko");
  expect(formatLocalizedMessage(failure.translation)).toContain("설치");
  expect(failure.message).toContain("@yohawing/three-mmd-loader");
});
