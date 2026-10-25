import { describe, expect, it } from "vitest";
import { apiFit, builtFor } from "./version";

const v = (text: string) => builtFor(text);

describe("apiFit", () => {
  it("is plain for the same version", () => {
    expect(apiFit(v("0.3"), v("0.3"))).toEqual({ usable: true, hint: null });
    expect(apiFit(v("1.2"), v("1.2"))).toEqual({ usable: true, hint: null });
  });

  it("takes a newer minor from 1.0 on, which only adds", () => {
    expect(apiFit(v("1.2"), v("1.4"))).toEqual({ usable: true, hint: null });
  });

  it("names what to do about another version, before 1.0 in either direction", () => {
    expect(apiFit(v("0.3"), v("0.2"))).toEqual({
      usable: true,
      hint: "This GUI is built for API 0.3; the daemon runs 0.2: restart it: `hephaistos daemon restart`",
    });
    expect(apiFit(v("0.3"), v("0.4")).hint).toMatch(/runs 0\.4: rebuild the GUI/);
    expect(apiFit(v("1.3"), v("1.2")).hint).toMatch(/restart it/);
  });

  it("is unusable with another major", () => {
    expect(apiFit(v("1.0"), v("2.0"))).toMatchObject({ usable: false, hint: /rebuild the GUI/ });
    expect(apiFit(v("2.0"), v("1.5"))).toMatchObject({ usable: false, hint: /restart it/ });
  });
});
