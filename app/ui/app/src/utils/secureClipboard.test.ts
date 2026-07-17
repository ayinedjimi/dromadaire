// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { secureClipboardWrite } from "./secureClipboard";

describe("secureClipboard", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes content to clipboard", async () => {
    await secureClipboardWrite("secret", 10);
    expect(writeTextMock).toHaveBeenCalledWith("secret");
  });

  it("auto-clears clipboard after N seconds", async () => {
    await secureClipboardWrite("secret", 5);

    // Not cleared yet
    expect(writeTextMock).toHaveBeenCalledTimes(1);

    // Advance past the delay
    await vi.advanceTimersByTimeAsync(5000);

    // Should have been called again with empty string
    expect(writeTextMock).toHaveBeenCalledTimes(2);
    expect(writeTextMock).toHaveBeenLastCalledWith("");
  });

  it("does not schedule a clear timer when clearAfterSeconds = 0", async () => {
    await secureClipboardWrite("secret", 0);

    await vi.advanceTimersByTimeAsync(60000);

    // Only the initial write, no clear
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith("secret");
  });

  it("cancels previous timer on rapid calls (last write wins)", async () => {
    await secureClipboardWrite("first", 5);
    await secureClipboardWrite("second", 5);

    await vi.advanceTimersByTimeAsync(5000);

    // initial write "first", initial write "second", then one clear ""
    expect(writeTextMock).toHaveBeenCalledTimes(3);
    expect(writeTextMock).toHaveBeenLastCalledWith("");
  });

  it("silently ignores errors during clear", async () => {
    await secureClipboardWrite("secret", 2);

    // Make the clear call reject
    writeTextMock.mockRejectedValueOnce(new Error("clipboard denied"));

    // Should not throw
    await vi.advanceTimersByTimeAsync(2000);
  });
});
