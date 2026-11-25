import { backoffMs, deliveryOutcome } from "./backoff";

describe("backoff", () => {
  it("dobra a espera ate o teto de 60 segundos", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(10)).toBe(60_000);
  });

  it("aceita base zero para testes deterministicos", () => {
    expect(backoffMs(3, 0)).toBe(0);
  });

  it("trata timeout nas primeiras tentativas", () => {
    expect(deliveryOutcome(1, 2)).toEqual({ ok: false, error: "provider_timeout" });
    expect(deliveryOutcome(2, 2)).toEqual({ ok: false, error: "provider_timeout" });
    expect(deliveryOutcome(3, 2)).toEqual({ ok: true });
  });
});
