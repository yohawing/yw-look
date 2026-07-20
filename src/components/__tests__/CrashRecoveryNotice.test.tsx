import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CrashRecoveryNotice } from "../CrashRecoveryNotice";
import { openAppLogDir } from "../../lib/diagnostics";

vi.mock("../../lib/diagnostics", () => ({
  openAppLogDir: vi.fn(),
}));

const status = {
  previousCrashDetected: true,
  markerPath:
    "C:\\Users\\yohaw\\AppData\\Roaming\\com.yohawing.ywlook\\run-marker.json",
  previousStartedAt: "1783086405",
  previousPid: 1234,
};

describe("CrashRecoveryNotice", () => {
  beforeEach(() => {
    vi.mocked(openAppLogDir).mockReset();
  });

  it("shows a previous crash notice with a log action", () => {
    render(<CrashRecoveryNotice status={status} />);

    expect(
      screen.getByRole("heading", {
        name: "Previous Session Ended Unexpectedly",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/PID 1234/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Logs" }));
    expect(openAppLogDir).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed", () => {
    render(<CrashRecoveryNotice status={status} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(
      screen.queryByRole("heading", {
        name: "Previous Session Ended Unexpectedly",
      }),
    ).toBeNull();
  });

  it("stays hidden when no previous crash was detected", () => {
    render(
      <CrashRecoveryNotice
        status={{ ...status, previousCrashDetected: false }}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
