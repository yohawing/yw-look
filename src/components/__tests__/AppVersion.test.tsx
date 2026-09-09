import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVersion } from "@tauri-apps/api/app";
import { version as packageVersion } from "../../../package.json";
import { isTauriEnvironment } from "../../lib/platform";
import { AppVersion } from "../AppVersion";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("../../lib/platform", () => ({ isTauriEnvironment: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("AppVersion", () => {
  it("uses the package version in a browser without calling native IPC", () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(false);
    render(<AppVersion />);
    expect(screen.getByText(`yw-look v${packageVersion}`)).toBeTruthy();
    expect(getVersion).not.toHaveBeenCalled();
  });

  it("prefers the running application version over the frontend fallback", async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    vi.mocked(getVersion).mockResolvedValue("9.8.7-test");
    render(<AppVersion />);
    expect(await screen.findByText("yw-look v9.8.7-test")).toBeTruthy();
  });

  it("keeps the package version when native version retrieval fails", async () => {
    vi.mocked(isTauriEnvironment).mockReturnValue(true);
    vi.mocked(getVersion).mockRejectedValue(new Error("IPC unavailable"));
    render(<AppVersion />);
    await waitFor(() => expect(getVersion).toHaveBeenCalledTimes(1));
    expect(screen.getByText(`yw-look v${packageVersion}`)).toBeTruthy();
  });
});
