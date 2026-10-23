import { useLog } from "../state/log";

/** Convenience wrappers around the log-backed command runner. */
export function useTools() {
  const { run, running } = useLog();
  return {
    running,
    adb: (args: string[]) => run("adb", args),
    fastboot: (args: string[]) => run("fastboot", args),
    heimdall: (args: string[]) => run("heimdall", args),
    payloadDumper: (args: string[]) => run("payload-dumper", args),
    raw: run,
  };
}
