const CAP_MS = 60_000;

export function backoffMs(attempt: number, baseMs = 1000): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("attempt deve ser um inteiro maior ou igual a 1");
  }
  if (!Number.isFinite(baseMs) || baseMs < 0) {
    throw new Error("baseMs deve ser um numero maior ou igual a zero");
  }
  return Math.min(baseMs * 2 ** (attempt - 1), CAP_MS);
}

export function deliveryOutcome(
  attempt: number,
  failUntilAttempt: number,
): { ok: true } | { ok: false; error: string } {
  if (attempt <= failUntilAttempt) {
    return { ok: false, error: "provider_timeout" };
  }
  return { ok: true };
}
