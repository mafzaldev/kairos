#!/usr/bin/env node
import { createContext } from "./cli/context.js";
import { run } from "./cli/main.js";

// A closed pipe (`kairos list | head -1`) is a normal way for output to end, not a crash.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

process.exitCode = await run(process.argv.slice(2), createContext());
