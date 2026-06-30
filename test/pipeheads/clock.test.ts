import { describe, it, expect } from "@jest/globals";
import { createFrozenClock, FROZEN_CLOCK_ISO } from "../../src/pipeheads/clock.js";

describe("clock", () => {
  it("default frozen clock returns the fixed ISO constant", () => {
    const clock = createFrozenClock();
    expect(clock()).toBe(FROZEN_CLOCK_ISO);
  });

  it("default frozen clock is stable across repeated calls", () => {
    const clock = createFrozenClock();
    expect(clock()).toBe(clock());
    expect(clock()).toBe(FROZEN_CLOCK_ISO);
  });

  it("FROZEN_CLOCK_ISO is a valid ISO 8601 timestamp", () => {
    expect(typeof FROZEN_CLOCK_ISO).toBe("string");
    expect(new Date(FROZEN_CLOCK_ISO).toISOString()).toBe(FROZEN_CLOCK_ISO);
  });

  it("an injected ISO overrides the default", () => {
    const injected = "2030-06-15T12:34:56.000Z";
    const clock = createFrozenClock(injected);
    expect(clock()).toBe(injected);
    expect(clock()).not.toBe(FROZEN_CLOCK_ISO);
  });
});
