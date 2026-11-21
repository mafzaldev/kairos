/** A failure the user can act on. Its message is printed as-is, with no stack trace. */
export class KairosError extends Error {
  exitCode = 1;
}

export class Base32Error extends KairosError {}

export class UriError extends KairosError {}

export class CorruptedError extends KairosError {
  constructor(detail: string) {
    super(`The vault file is corrupted or not a kairos vault (${detail}).`);
  }
}

export class WrongPasswordError extends KairosError {
  constructor() {
    super("Incorrect password.");
  }
}

export class NoTerminalError extends KairosError {
  constructor() {
    super(
      "kairos needs an interactive terminal: passwords and confirmations are typed at a prompt, " +
        "and this session is not one (stdin or stderr is not a TTY).",
    );
  }
}

/** Ctrl+C or Esc at a prompt. */
export class CancelledError extends KairosError {
  override exitCode = 130;

  constructor() {
    super("Cancelled.");
  }
}
