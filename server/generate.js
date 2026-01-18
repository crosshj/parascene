import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { generateRandomColorImage } from "./utils/imageGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function createGenerateRoutes({ queries }) {
  const router = express.Router();

  // Ensure images directory exists
  const imagesDir = path.join(__dirname, "..", "db", "data", "images", "generated");
  
  // Serve generated images statically
  router.use("/images/generated", express.static(imagesDir));

  async function requireUser(req, res) {
    if (!req.auth?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }

    const user = await queries.selectUserById.get(req.auth.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return null;
    }

    return user;
  }

  // POST /api/generate - Generate a new image
  router.post("/api/generate", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      // Generate unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      const filename = `${user.id}_${timestamp}_${random}.png`;
      const filePath = path.join(imagesDir, filename);

      // Create placeholder entry in database with "generating" status
      const result = await queries.insertGeneratedImage.run(
        user.id,
        filename,
        filePath,
        1024, // width
        1024, // height
        null, // color - will be set after generation
        'generating' // status
      );

      // Return immediately with generating status
      res.json({
        id: result.insertId,
        filename,
        url: `/images/generated/${filename}`,
        color: null,
        width: 1024,
        height: 1024,
        status: 'generating',
        created_at: new Date().toISOString()
      });

      // Generate the image asynchronously with delay
      (async () => {
        try {
          // Add delay (3-5 seconds)
          const delay = 3000 + Math.random() * 2000; // 3-5 seconds
          await new Promise(resolve => setTimeout(resolve, delay));

          // Generate the image
          const { color, width, height } = await generateRandomColorImage(filePath);

          // Update database with completed status and color
          await queries.updateGeneratedImageStatus.run(result.insertId, user.id, 'completed', color);
          
          // Note: We could also update the color in the database, but for now status is enough
          // The color will be fetched when the image is loaded
        } catch (error) {
          console.error("Error generating image in background:", error);
          // Update status to failed
          await queries.updateGeneratedImageStatus.run(result.insertId, user.id, 'failed');
        }
      })();
    } catch (error) {
      console.error("Error initiating image generation:", error);
      return res.status(500).json({ error: "Failed to initiate image generation" });
    }
  });

  // GET /api/generate/images - List all images for user
  router.get("/api/generate/images", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      const images = await queries.selectGeneratedImagesForUser.all(user.id);
      
      // Transform to include URLs
      const imagesWithUrls = images.map((img) => ({
        id: img.id,
        filename: img.filename,
        url: `/images/generated/${img.filename}`,
        width: img.width,
        height: img.height,
        color: img.color,
        status: img.status || 'completed', // Default to completed for backward compatibility
        created_at: img.created_at
      }));

      return res.json({ images: imagesWithUrls });
    } catch (error) {
      console.error("Error fetching images:", error);
      return res.status(500).json({ error: "Failed to fetch images" });
    }
  });

  // GET /api/generate/images/:id - Get specific image metadata
  router.get("/api/generate/images/:id", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      const image = await queries.selectGeneratedImageById.get(
        req.params.id,
        user.id
      );

      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      return res.json({
        id: image.id,
        filename: image.filename,
        url: `/images/generated/${image.filename}`,
        width: image.width,
        height: image.height,
        color: image.color,
        status: image.status || 'completed',
        created_at: image.created_at
      });
    } catch (error) {
      console.error("Error fetching image:", error);
      return res.status(500).json({ error: "Failed to fetch image" });
    }
  });

  return router;
}
