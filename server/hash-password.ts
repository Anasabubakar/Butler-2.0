// Prints a BUTLER_PASSWORD_HASH for the password you type.
//   deno run server/hash-password.ts
import { hashPassword } from "./lib/auth.ts";

// Typed at a prompt, or piped in: echo "my password" | deno run server/hash-password.ts
const password = (Deno.stdin.isTerminal()
  ? prompt("Library password:")
  : new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer()))?.trim();
if (!password || password.length < 10) {
  console.error("Use at least 10 characters.");
  Deno.exit(1);
}
console.log(await hashPassword(password));
