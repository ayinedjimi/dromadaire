// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAlternatives, addAlternative } from "./alternatives";
import type { Alternative } from "./alternatives";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

function makeAlt(content: string, model = "gemma3:4b"): Alternative {
  return {
    content,
    thinking: "",
    model,
    created_at: new Date().toISOString(),
  };
}

describe("getAlternatives", () => {
  it("returns an empty array when no alternatives exist", () => {
    const result = getAlternatives("chat-1", 0);
    expect(result).toEqual([]);
  });

  it("returns an empty array for a non-existent chat id", () => {
    addAlternative("chat-1", 0, makeAlt("Hello"));
    const result = getAlternatives("chat-999", 0);
    expect(result).toEqual([]);
  });

  it("returns an empty array for a non-existent message index", () => {
    addAlternative("chat-1", 0, makeAlt("Hello"));
    const result = getAlternatives("chat-1", 99);
    expect(result).toEqual([]);
  });
});

describe("addAlternative + getAlternatives roundtrip", () => {
  it("stores and retrieves a single alternative", () => {
    const alt = makeAlt("Response A");
    addAlternative("chat-1", 0, alt);

    const result = getAlternatives("chat-1", 0);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Response A");
    expect(result[0].model).toBe("gemma3:4b");
  });

  it("stores multiple alternatives for the same message", () => {
    addAlternative("chat-1", 0, makeAlt("Response A"));
    addAlternative("chat-1", 0, makeAlt("Response B"));
    addAlternative("chat-1", 0, makeAlt("Response C"));

    const result = getAlternatives("chat-1", 0);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("Response A");
    expect(result[1].content).toBe("Response B");
    expect(result[2].content).toBe("Response C");
  });

  it("keeps alternatives separate across different messages", () => {
    addAlternative("chat-1", 0, makeAlt("Msg0 Alt"));
    addAlternative("chat-1", 1, makeAlt("Msg1 Alt"));

    expect(getAlternatives("chat-1", 0)).toHaveLength(1);
    expect(getAlternatives("chat-1", 1)).toHaveLength(1);
    expect(getAlternatives("chat-1", 0)[0].content).toBe("Msg0 Alt");
    expect(getAlternatives("chat-1", 1)[0].content).toBe("Msg1 Alt");
  });

  it("keeps alternatives separate across different chats", () => {
    addAlternative("chat-A", 0, makeAlt("Chat A alt"));
    addAlternative("chat-B", 0, makeAlt("Chat B alt"));

    expect(getAlternatives("chat-A", 0)[0].content).toBe("Chat A alt");
    expect(getAlternatives("chat-B", 0)[0].content).toBe("Chat B alt");
  });
});

describe("deduplication", () => {
  it("does not add a duplicate alternative with the same content", () => {
    addAlternative("chat-1", 0, makeAlt("Same response"));
    addAlternative("chat-1", 0, makeAlt("Same response"));
    addAlternative("chat-1", 0, makeAlt("Same response"));

    const result = getAlternatives("chat-1", 0);
    expect(result).toHaveLength(1);
  });

  it("allows alternatives with different content", () => {
    addAlternative("chat-1", 0, makeAlt("Version 1"));
    addAlternative("chat-1", 0, makeAlt("Version 2"));

    const result = getAlternatives("chat-1", 0);
    expect(result).toHaveLength(2);
  });

  it("deduplicates by content even if model differs", () => {
    addAlternative("chat-1", 0, makeAlt("Same text", "model-a"));
    addAlternative("chat-1", 0, makeAlt("Same text", "model-b"));

    const result = getAlternatives("chat-1", 0);
    expect(result).toHaveLength(1);
    expect(result[0].model).toBe("model-a");
  });
});

describe("cap at max alternatives", () => {
  it("caps at 10 alternatives per message, dropping the oldest", () => {
    for (let i = 0; i < 12; i++) {
      addAlternative("chat-1", 0, makeAlt(`Alt ${i}`));
    }

    const result = getAlternatives("chat-1", 0);
    expect(result).toHaveLength(10);
    // The first two should have been shifted out
    expect(result[0].content).toBe("Alt 2");
    expect(result[9].content).toBe("Alt 11");
  });

  it("cap is per message, not global", () => {
    for (let i = 0; i < 10; i++) {
      addAlternative("chat-1", 0, makeAlt(`Msg0 Alt ${i}`));
    }
    for (let i = 0; i < 10; i++) {
      addAlternative("chat-1", 1, makeAlt(`Msg1 Alt ${i}`));
    }

    expect(getAlternatives("chat-1", 0)).toHaveLength(10);
    expect(getAlternatives("chat-1", 1)).toHaveLength(10);
  });
});
