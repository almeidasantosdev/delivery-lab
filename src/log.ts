export type LogFields = Record<string, unknown>;

export function log(level: "info" | "error", msg: string, fields: LogFields = {}): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...fields,
    }),
  );
}
