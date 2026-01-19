import { openDb } from "./index.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function clearImagesDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        fs.unlinkSync(filePath);
      } else if (stat.isDirectory()) {
        clearImagesDirectory(filePath);
        fs.rmdirSync(filePath);
      }
    }
  }
}

try {
  // Clear images from data folder
  const imagesDir = path.join(__dirname, "data", "images");
  const createdDir = path.join(imagesDir, "created");
  const generatedDir = path.join(imagesDir, "generated");
  
  console.log("Clearing images from data folder...");
  clearImagesDirectory(createdDir);
  clearImagesDirectory(generatedDir);
  console.log("Images cleared.");

  // Use adapter's reset method if available
  const { reset } = await openDb();
  if (reset) {
    await reset();
  }

  await import("./seed.js");
  console.log("Database reset complete.");
} catch (error) {
  console.error("Database reset error:", error);
  process.exit(1);
}
