# kairos

A secure, minimal TOTP authenticator for the command line.

_Kairos_ (καιρός) is Greek for "the right moment", which is all a one-time code is good for.

- Stores 2FA secrets in a single encrypted file (AES-256-GCM, key derived with scrypt).
- Compatible with Google Authenticator and anything else that uses `otpauth://totp` URIs or QR codes.
- TOTP (RFC 6238) implemented in about 60 readable lines on top of `node:crypto`, verified against the RFC test vectors.
- Fully interactive: forms with inline validation, and passwords that are only ever typed at a prompt.

## Installation

Requires Node.js 20.12 or newer.

```sh
npm install -g @mafzaldev/kairos
kairos --version
```

To uninstall, run `npm uninstall -g @mafzaldev/kairos`.

To run it from source instead:

```sh
git clone https://github.com/mafzaldev/kairos.git
cd kairos
pnpm install        # or: npm install
pnpm build          # or: npm run build  (bundles the CLI into dist/)
npm link            # or: npm install -g .
```

## Quick start

```sh
kairos init                 # choose a master password
kairos add                  # fill in the form, check the code preview, save
kairos code github          # GitHub:alice@example.com  482 913  ██████░░░░  17s
kairos watch                # live view of every code
```

## Usage

### Adding accounts

```sh
kairos add                      # interactive form
kairos add alice@example.com    # same, with the name pre-filled
```

The form takes one line per field: name, issuer (optional), secret (hidden as you type, validated
as base32), algorithm (SHA1, SHA256, SHA512), digits (6 or 8) and period (30 seconds by default).
It then shows the **current code**. Compare it with the one the website expects before choosing
_Save_; you can also go back and edit, or cancel.

```
◆ Name       alice@example.com
◆ Issuer     GitHub
◆ Secret     ••••••••
◆ Algorithm  SHA1
◆ Digits     6
◆ Period     30
  Code       406 243  (changes in 12s)
? Save this account?  ● Save  ○ Edit  ○ Cancel
```

From a setup URI or a QR code image (PNG or JPEG, for example a screenshot):

```sh
kairos add-uri 'otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub'
kairos import-qr ~/Pictures/github-2fa.png
```

Both open the same form, pre-filled, so you can rename the account before saving. The secret comes
from the URI and is not asked again.

Only time-based codes are supported. `otpauth://hotp` (counter-based) URIs are rejected.

### Moving from Google Authenticator

In Google Authenticator, choose _Transfer accounts_ → _Export accounts_. It shows one or more QR
codes that hold all the selected accounts. Android blocks screenshots of that screen, so the
simplest way is to show the phone to your computer's camera:

```sh
kairos scan
```

Hold the code up to the camera, close enough to fill most of the picture, until kairos says it has
it. This needs [ffmpeg](https://ffmpeg.org) installed; nothing from the camera is saved to disk. Use
`--device` to pick another camera, for example `kairos scan --device /dev/video2`. `scan` reads
ordinary single-account setup codes too.

If you do have an image of the code (a screenshot on iOS, or a photo), import that instead:

```sh
kairos import-qr ~/Pictures/google-export-1.png
```

kairos lists the accounts in the code and asks once before adding them:

```
Google Authenticator export, part 1 of 2:
  GitHub:alice@example.com
  AWS:root
? Import these 2 accounts?  ○ Yes  ● No
```

Accounts you already have are skipped, so importing the same code twice is harmless. Counter-based
(HOTP) entries are left out. If the export was split across several QR codes, import each one.

An export screenshot contains every secret in it, unencrypted. Delete the image (and empty the
trash) as soon as the import has worked.

### Getting codes

```sh
kairos code github           # exact, partial, or fuzzy ("ghb") match on name or issuer
kairos code github:alice     # issuer:name narrows it down
kairos code github --copy    # also copy the code to the clipboard
kairos watch                 # all codes with countdowns; q or Ctrl+C to leave
kairos list                  # names and issuers only
```

If a query matches several accounts equally well, kairos lists them instead of guessing.

`watch` redraws its lines in place, in the same terminal, until you press `q`.

### Managing accounts

```sh
kairos edit github            # opens the form with the current values
kairos remove github          # asks for confirmation
kairos passwd                 # change the master password
```

Accounts are identified by issuer plus name, so `GitHub:alice` and `GitLab:alice` can coexist.
`edit` lets you change any field. Leave the secret blank to keep the current one.

`remove` and `edit` accept an exact name or an unambiguous part of it, but never a fuzzy match.

### Staying unlocked

You type the master password once, and kairos stays unlocked for 15 minutes:

```sh
kairos code github     # asks for the master password
kairos code aws        # no prompt
kairos lock            # forget it now instead of waiting
```

`kairos passwd` and `kairos export --plain` always ask for the password, whether or not you are
unlocked. Sessions are not available on Windows, where every command asks.

### Backup and restore

```sh
kairos export ~/backups/kairos-2026-11.kairos   # encrypted backup
kairos import ~/backups/kairos-2026-11.kairos   # merge a backup into the vault
kairos export --plain                            # print otpauth:// URIs (asks first)
```

`import` adds accounts that are missing and skips ones that are already there. An account that
exists with a _different_ secret is reported and left alone unless you pass `--overwrite`.

### Terminal only

kairos is interactive by design. The master password, the secrets you add and every confirmation
are typed at a prompt; there are no flags or environment variables that supply them, so they cannot
end up in shell history, the process list or a script. A command run without a terminal (from cron,
or with input piped in) stops with an error instead of prompting.

Prompts are drawn on stderr and results go to stdout, so piping the output still works:
`kairos list | grep -i git`.

| Variable       | Purpose                                                 |
| -------------- | ------------------------------------------------------- |
| `KAIROS_VAULT` | Path of the vault file, instead of the default location |
| `NO_COLOR`     | Disable colour                                          |

## Security model

**What kairos protects.** Your TOTP secrets at rest. Someone who copies the vault file (a stolen
laptop, a leaked backup, a synced folder) learns nothing but its size without the master password,
and each password guess costs them a deliberately expensive scrypt computation.

**What it does not protect.** Anything running as your user while the vault is unlocked can read the
secrets from memory, log your keystrokes, or read the terminal. kairos is not a defence against
malware on your own machine. And a weak master password can still be guessed, just slowly: use a
long passphrase.

How it works:

- **Encryption.** AES-256-GCM with a fresh random 96-bit IV for every write. The file header is
  authenticated too, so it cannot be tampered with to weaken the parameters.
- **Key derivation.** scrypt with N = 2^17, r = 8, p = 1 (about 128 MiB of memory and a few hundred
  milliseconds per attempt) and a random 256-bit salt. The salt is renewed when you change the
  password.
- **File handling.** The vault is created with mode `0600` in a directory created with mode `0700`
  (on Windows, the user profile's own access control applies instead). Every save writes a temporary
  file in the same directory, fsyncs it and renames it over the vault, so a crash or power cut leaves
  either the old vault or the new one, never half of each. kairos warns if the vault has become
  readable by other users.
- **No plaintext output.** Secrets are never printed, logged or written unencrypted. The single
  exception is `kairos export --plain`, which warns and asks for confirmation first. Error messages
  never quote a secret, even a mistyped one.
- **Memory hygiene.** Keys, passwords and decrypted secrets are held in Buffers and overwritten with
  zeros as soon as they are no longer needed. The vault's plaintext is a binary format rather than
  JSON so that reading it never turns a secret into a JavaScript string. This is best effort:
  JavaScript strings cannot be wiped, so what you type at a prompt may linger until the process
  exits, and the operating system may swap memory to disk.
- **Sessions.** While unlocked, the vault's key is held in the memory of a small background process
  and never written to disk. Commands fetch it over a Unix socket in a directory only you can enter
  (`$XDG_RUNTIME_DIR/kairos`). The process exits after 15 minutes, on `kairos lock`, or when the
  password changes. During that window any program running as you could ask it for the key, which is
  the same exposure as an unlocked `ssh-agent`; run `kairos lock` when you step away.
- **No network access.** kairos never connects to anything. Codes depend on your system clock being
  right to within a few seconds.

### Vault location

| Platform | Default path                                                          |
| -------- | --------------------------------------------------------------------- |
| Linux    | `~/.config/kairos/vault.enc` (or `$XDG_CONFIG_HOME/kairos/vault.enc`) |
| macOS    | `~/Library/Application Support/kairos/vault.enc`                      |
| Windows  | `%APPDATA%\kairos\vault.enc`                                          |

Set `KAIROS_VAULT` to use another file.

### Vault file format (version 1)

Encrypted backups use the same format.

| Offset | Size | Field                                   |
| ------ | ---- | --------------------------------------- |
| 0      | 6    | Magic `KAIROS`                          |
| 6      | 1    | Format version (`1`)                    |
| 7      | 1    | KDF id (`1` = scrypt)                   |
| 8      | 1    | scrypt log2(N)                          |
| 9      | 1    | scrypt r                                |
| 10     | 1    | scrypt p                                |
| 11     | 1    | Reserved (`0`)                          |
| 12     | 32   | KDF salt                                |
| 44     | 12   | AES-256-GCM IV                          |
| 56     | 16   | AES-256-GCM authentication tag          |
| 72     | n    | Ciphertext                              |
| 72 + n | 32   | SHA-256 of everything before this field |

Bytes 0 to 55 are the GCM additional authenticated data. The trailing SHA-256 is not a security
feature: it is what lets kairos say "the vault file is corrupted" for a damaged file and "incorrect
password" for an intact one, instead of one vague message for both.

The ciphertext decrypts to a list of length-prefixed records (name, issuer, algorithm, digits,
period, raw secret); the layout is documented at the top of `src/vault/format.ts`.

### Clipboard (`--copy`)

`kairos code <name> --copy` also puts the code on the clipboard. kairos does not clear it afterwards:
a code stops working after its period (usually 30 seconds), and clipboard history tools would keep a
copy regardless.

On Linux this needs a graphical session: Wayland requires the `wl-clipboard` package (`wl-copy`),
X11 uses `xsel`. Over SSH or on a headless machine there is no clipboard, so the code is still
printed and the command reports that the copy failed.

## Backup advice

If you lose the vault, you lose your second factor for every account in it. There is no password
recovery either: without the master password the vault and its backups are unreadable.

- **Back up after every change.** Run `kairos export <file>` whenever you add an account, and keep
  the file somewhere other than this machine: a USB stick, another computer, cloud storage. The
  backup is encrypted, so its confidentiality rests on your master password.
- **Remember which password a backup uses.** A backup is encrypted with the master password in use
  when it was made. After `kairos passwd`, older backups still need the old password, so export a
  fresh backup right away.
- **Test your restore.** A backup you have never restored is a hope, not a backup:

  ```sh
  KAIROS_VAULT=/tmp/restore-test.enc kairos init
  KAIROS_VAULT=/tmp/restore-test.enc kairos import ~/backups/kairos-2026-11.kairos
  KAIROS_VAULT=/tmp/restore-test.enc kairos list
  rm /tmp/restore-test.enc
  ```

- **Keep the recovery codes** each website gives you when you enable 2FA, separately from the vault.
  They are your way back in if everything else fails.
- **Avoid `--plain`.** Use it only to move accounts to another app, and do not redirect it into a
  file that outlives the migration. If you want a paper copy, print it and delete the file.
- **Do not edit or sync the vault file by hand.** Syncing is fine for the exported backup, but two
  machines writing the same vault will overwrite each other's changes.

## Development

Running kairos needs Node.js 20.12+; the development tools (vitest 5, tsup 9) need Node.js 22.12+.

```sh
pnpm install
pnpm test          # vitest
pnpm typecheck     # tsc --noEmit, strict + noUncheckedIndexedAccess
pnpm lint          # eslint (type-aware)
pnpm format        # prettier
pnpm build         # tsup -> dist/index.js
```

```
src/
  index.ts      entry point (shebang, exit code)
  errors.ts     typed error classes with user-facing messages
  account.ts    the Account type
  style.ts      terminal colours
  otp/          base32, HOTP (internal), TOTP with the time as a parameter
  uri/          otpauth:// parsing and formatting
  vault/        file format, encryption, atomic storage, account lookup
  prompts/      one-line prompts, field validation, the shared account form
  cli/          commander program, commands, session (unlock and wipe), QR decoding
test/           vitest suites and QR code fixtures
```

The tests include the official vectors from RFC 4226 Appendix D and RFC 6238 Appendix B (SHA1,
SHA256, SHA512). The secrets in `test/` are those published RFC values, not real credentials.
