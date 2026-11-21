import { homedir } from "node:os";
import path from "node:path";

/**
 *   Linux    $XDG_CONFIG_HOME/kairos/vault.enc (default ~/.config)
 *   macOS    ~/Library/Application Support/kairos/vault.enc
 *   Windows  %APPDATA%\kairos\vault.enc
 */
export function defaultPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (platform === "win32") {
    const base = env.APPDATA || path.win32.join(home, "AppData", "Roaming");
    return path.win32.join(base, "kairos", "vault.enc");
  }
  if (platform === "darwin") {
    return path.posix.join(home, "Library", "Application Support", "kairos", "vault.enc");
  }
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, ".config");
  return path.posix.join(base, "kairos", "vault.enc");
}

/** KAIROS_VAULT if set, otherwise the platform default. */
export function vaultPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.KAIROS_VAULT ? path.resolve(env.KAIROS_VAULT) : defaultPath(env);
}
