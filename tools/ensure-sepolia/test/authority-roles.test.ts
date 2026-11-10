import { describe, expect, it, vi } from "vitest";

vi.mock("../../../web/src/lib/config", () => ({ deployment: {}, publicClient: {} }));
vi.mock("../../../web/src/lib/verify", () => ({ readCurrentProjectOwner: async () => "0x0" }));
const { groupWallets } = await import("../../../web/src/lib/authority");

const OWNER = "0x00000000000000000000000000000000000000a1", CI = "0x00000000000000000000000000000000000000b2", OTHER = "0x00000000000000000000000000000000000000c3";

describe("groupWallets", () => {
  it("gives each role holder its own column", () => {
    const actors = groupWallets([{ role: "owner", address: OWNER }, { role: "publisher", address: CI }]);
    expect(actors.map((a) => a.label)).toEqual(["Owner", "Publisher"]);
    expect(actors.every((a) => !a.isYou)).toBe(true);
  });
  it("merges roles held by one wallet into one column, whatever the address case", () => {
    const actors = groupWallets([{ role: "owner", address: OWNER }, { role: "publisher", address: OWNER.toUpperCase().replace("0X", "0x") as `0x${string}` }]);
    expect(actors).toHaveLength(1);
    expect(actors[0].label).toBe("Owner + Publisher");
  });
  it("marks the connected owner as you, without a second column", () => {
    const actors = groupWallets([{ role: "owner", address: OWNER }, { role: "publisher", address: CI }], OWNER);
    expect(actors).toHaveLength(2);
    expect(actors.find((a) => a.roles.includes("owner"))?.isYou).toBe(true);
  });
  it("adds a connected wallet with no role as its own column", () => {
    const actors = groupWallets([{ role: "owner", address: OWNER }, { role: "publisher", address: CI }], OTHER);
    expect(actors).toHaveLength(3);
    expect(actors[2]).toMatchObject({ label: "Connected wallet", roles: [], isYou: true });
  });
});
