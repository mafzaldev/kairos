import { readFileSync } from "node:fs";
import { Command } from "commander";
import { NoTerminalError } from "../errors.js";
import * as agent from "./agent.js";
import { add, addUri, importQr, scan } from "./commands/add.js";
import { exportBackup, importBackup } from "./commands/backup.js";
import { code } from "./commands/code.js";
import { list, remove, rename } from "./commands/manage.js";
import { init, lock, passwd } from "./commands/setup.js";
import { watch } from "./commands/watch.js";
import type { Context } from "./context.js";

function version(): string {
  for (const up of ["..", "../.."]) {
    try {
      const url = new URL(`${up}/package.json`, import.meta.url);
      const manifest = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
      if (manifest.version) return manifest.version;
    } catch {
      // not at this level
    }
  }
  return "unknown";
}

const ENVIRONMENT = `
Environment:
  KAIROS_VAULT    path of the vault file (default: per-user config directory)
  NO_COLOR        disable coloured output`;

export function program(ctx: Context): Command {
  const cli = new Command("kairos")
    .description("A secure, minimal TOTP authenticator for the command line.")
    .version(version(), "-V, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .showHelpAfterError("(run with --help for usage)")
    .addHelpText("after", ENVIRONMENT)
    // Print through the context and throw instead of exiting, so run() decides
    // the exit code. Subcommands inherit both settings.
    .configureOutput({
      writeOut: (text) => ctx.out(text.trimEnd()),
      writeErr: (text) => ctx.err(text.trimEnd()),
    })
    .exitOverride()
    // Every command needs a password or a confirmation, so refuse up front
    // rather than part-way through.
    .hook("preAction", (_cli, command) => {
      if (!ctx.interactive && command.name() !== agent.COMMAND) throw new NoTerminalError();
    });

  cli
    .command("init")
    .description("create a new encrypted vault")
    .action(() => init(ctx));

  cli
    .command("add")
    .description("add an account with an interactive form")
    .argument("[name]", "account name to pre-fill, e.g. alice@example.com")
    .action((name?: string) => add(ctx, name));

  cli
    .command("add-uri")
    .description("add an account from an otpauth://totp URI (or a Google Authenticator export)")
    .argument("<uri>", "otpauth://totp/... URI (quote it)")
    .action((uri: string) => addUri(ctx, uri));

  cli
    .command("import-qr")
    .description("add accounts from a QR code image, including Google Authenticator exports")
    .argument("<image>", "path of the image file")
    .action((image: string) => importQr(ctx, image));

  cli
    .command("scan")
    .description("add accounts by showing a QR code to the camera (needs ffmpeg)")
    .option("--device <name>", "camera to use instead of the system's first one")
    .action((options: { device?: string }) => scan(ctx, options));

  cli
    .command("list")
    .alias("ls")
    .description("list accounts (names and issuers only)")
    .action(() => list(ctx));

  cli
    .command("code")
    .description("print the current code for an account")
    .argument("<name>", "account name, issuer, or part of either")
    .option("-c, --copy", "also copy the code to the clipboard")
    .action((name: string, options: { copy?: boolean }) => code(ctx, name, options));

  cli
    .command("watch")
    .description("show all codes, updating live until Ctrl+C")
    .action(() => watch(ctx));

  cli
    .command("remove")
    .alias("rm")
    .description("delete an account, after confirmation")
    .argument("<name>", "account name (exact, or an unambiguous part)")
    .action((name: string) => remove(ctx, name));

  cli
    .command("rename")
    .description("rename an account")
    .argument("<old>", "current account name")
    .argument("<new>", "new account name")
    .action((oldName: string, newName: string) => rename(ctx, oldName, newName));

  cli
    .command("export")
    .description("write an encrypted backup, or print otpauth URIs with --plain")
    .argument("[file]", "destination of the encrypted backup")
    .option("--plain", "print secrets as plaintext otpauth URIs (asks for confirmation)")
    .option("-f, --force", "overwrite an existing backup file")
    .action((file: string | undefined, options: { plain?: boolean; force?: boolean }) => exportBackup(ctx, file, options));

  cli
    .command("import")
    .description("restore accounts from an encrypted backup")
    .argument("<file>", "backup file written by `kairos export`")
    .option("--overwrite", "replace accounts that differ from the backup")
    .action((file: string, options: { overwrite?: boolean }) => importBackup(ctx, file, options));

  cli
    .command("passwd")
    .description("change the master password")
    .action(() => passwd(ctx));

  cli
    .command("lock")
    .description("lock the vault now, so the next command asks for the master password")
    .action(() => lock(ctx));

  // Internal: the background process that holds the key during a session.
  cli
    .command(agent.COMMAND, { hidden: true })
    .argument("<socket>")
    .action((socket: string) => agent.serve(socket));

  return cli;
}
