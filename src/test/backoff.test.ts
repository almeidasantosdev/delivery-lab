import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backoffMs, deliveryOutcome } from "../backoff.js";

describe("backoff", () => {
  it("dobra a espera ate o teto de 60 segundos", () => {
    assert.equal(backoffMs(1), 1000);
    assert.equal(backoffMs(2), 2000);
    assert.equal(backoffMs(3), 4000);
    assert.equal(backoffMs(10), 60_000);
  });

  it("aceita base zero para testes deterministicos", () => {
    assert.equal(backoffMs(3, 0), 0);
  });

  it("trata timeout nas primeiras tentativas", () => {
    assert.deepEqual(deliveryOutcome(1, 2), { ok: false, error: "provider_timeout" });
    assert.deepEqual(deliveryOutcome(2, 2), { ok: false, error: "provider_timeout" });
    assert.deepEqual(deliveryOutcome(3, 2), { ok: true });
  });
});
