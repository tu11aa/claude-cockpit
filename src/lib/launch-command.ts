import type { CrewSignalWiring } from "../drivers/types.js";

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildLaunchCommand(
  cliCommand: string,
  wiring: CrewSignalWiring | undefined,
): string {
  if (!wiring) return cliCommand;
  const envPrefix = Object.entries(wiring.env)
    .map(([k, v]) => `${k}=${shQuote(v)}`)
    .join(" ");
  const suffix = wiring.argsSuffix ? ` ${wiring.argsSuffix}` : "";
  return `${envPrefix} ${cliCommand}${suffix}`;
}
