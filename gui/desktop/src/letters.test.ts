import { describe, expect, it } from "vitest";
import { letterOf } from "./letters.js";

describe("the letter of a key", () => {
  it("is the Latin letter typed, in lower case, wherever the key is", () => {
    expect(letterOf({ key: "r", code: "KeyR" })).toBe("r");
    expect(letterOf({ key: "R", code: "KeyR" })).toBe("r"); // Caps Lock or Shift
    expect(letterOf({ key: "z", code: "KeyW" })).toBe("z"); // AZERTY
  });

  it("is that of the place of the key where the letter typed is not Latin", () => {
    expect(letterOf({ key: "к", code: "KeyR" })).toBe("r"); // Cyrillic
    expect(letterOf({ key: "Ц", code: "KeyW" })).toBe("w");
  });

  it("is none for a key that types no letter", () => {
    expect(letterOf({ key: "+", code: "Equal" })).toBeUndefined();
    expect(letterOf({ key: "0", code: "Digit0" })).toBeUndefined();
    expect(letterOf({ key: "ä", code: "Quote" })).toBeUndefined(); // a letter, at no letter
  });
});
