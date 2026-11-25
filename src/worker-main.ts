import { log } from "./log";
import { startWorkerRuntime } from "./worker-runtime";

startWorkerRuntime()
  .then((runtime) => {
    let stopping = false;
    const shutdown = (signal: string): void => {
      if (stopping) {
        return;
      }
      stopping = true;
      log("info", "encerrando worker", { signal });
      runtime.stop().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  })
  .catch((error: unknown) => {
    log("error", "worker nao iniciou", { error: error instanceof Error ? error.message : "erro desconhecido" });
    process.exit(1);
  });
