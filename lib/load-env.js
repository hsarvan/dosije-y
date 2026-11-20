// Učitava .env prije ostalih modula (ES importi se izvršavaju redom).
import path from "node:path";
import { fileURLToPath } from "node:url";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
try {
  process.loadEnvFile(envFile);
} catch {
  // nema .env — koriste se varijable okruženja
}
