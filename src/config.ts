export type AppConfig = {
  databaseUrl: string;
  port: number;
  workerIntervalMs: number;
};

export function readConfig(env: NodeJS.ProcessEnv): AppConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL e obrigatoria");
  }

  const port = readPositiveInt(env.PORT, 3000, "PORT");
  if (port > 65535) {
    throw new Error("PORT invalida");
  }

  const workerIntervalMs = readPositiveInt(env.WORKER_INTERVAL_MS, 2000, "WORKER_INTERVAL_MS");
  return { databaseUrl, port, workerIntervalMs };
}

function readPositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} invalida`);
  }
  return parsed;
}
