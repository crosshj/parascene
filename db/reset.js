import fs from "fs";
import { dbPath } from "./index.js";

if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

await import("./seed.js");
console.log("Database reset complete.");
