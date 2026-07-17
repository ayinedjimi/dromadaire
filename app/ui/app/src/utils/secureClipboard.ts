// Dromadaire LOT 9D: secure clipboard with auto-clear after configurable delay

let clearTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleClear(clearAfterSeconds: number) {
  if (clearTimer) clearTimeout(clearTimer);
  if (clearAfterSeconds > 0) {
    clearTimer = setTimeout(() => {
      navigator.clipboard.writeText("").catch(() => {});
      clearTimer = null;
    }, clearAfterSeconds * 1000);
  }
}

export function secureClipboardWrite(
  content: string,
  clearAfterSeconds: number,
): Promise<void> {
  const p = navigator.clipboard.writeText(content);
  scheduleClear(clearAfterSeconds);
  return p;
}

export function secureClipboardWriteItems(
  items: ClipboardItem[],
  clearAfterSeconds: number,
): Promise<void> {
  const p = navigator.clipboard.write(items);
  scheduleClear(clearAfterSeconds);
  return p;
}
