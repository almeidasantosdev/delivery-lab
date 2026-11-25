export type AppConfig = {
  databaseUrl: string;
  port: number;
  workerIntervalMs: number;
  workerHealthPort: number;
  backoffBaseMs: number;
  rabbitmqUrl: string | null;
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

  const workerHealthPort = readPositiveInt(env.WORKER_HEALTH_PORT, 3001, "WORKER_HEALTH_PORT");
  if (workerHealthPort > 65535) {
    throw new Error("WORKER_HEALTH_PORT invalida");
  }

  const rabbitmqUrl = env.RABBITMQ_URL?.trim() || null;
  return {
    databaseUrl,
    port,
    workerIntervalMs: readPositiveInt(env.WORKER_INTERVAL_MS, 2000, "WORKER_INTERVAL_MS"),
    workerHealthPort,
    backoffBaseMs: readNonNegativeInt(env.BACKOFF_BASE_MS, 1000, "BACKOFF_BASE_MS"),
    rabbitmqUrl,
  };
}

export function readWorkerConfig(env: NodeJS.ProcessEnv): AppConfig & { rabbitmqUrl: string } {
  const config = readConfig(env);
  if (!config.rabbitmqUrl) {
    throw new Error("RABBITMQ_URL e obrigatoria");
  }
  return { ...config, rabbitmqUrl: config.rabbitmqUrl };
}

function readPositiveInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = readNumber(value, fallback, name);
  if (parsed < 1) {
    throw new Error(`${name} invalida`);
  }
  return parsed;
}

function readNonNegativeInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = readNumber(value, fallback, name);
  if (parsed < 0) {
    throw new Error(`${name} invalida`);
  }
  return parsed;
}

function readNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} invalida`);
  }
  return parsed;
}
