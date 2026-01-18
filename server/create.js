import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { generateRandomColorImage } from "./utils/imageGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function createCreateRoutes({ queries }) {
  const router = express.Router();

  // Ensure images directory exists
  const imagesDir = path.join(__dirname, "..", "db", "data", "images", "created");
  
  // Serve created images statically
  router.use("/images/created", express.static(imagesDir));

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

  // POST /api/create - Create a new image
  router.post("/api/create", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      // Create unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      const filename = `${user.id}_${timestamp}_${random}.png`;
      const filePath = path.join(imagesDir, filename);

      // Create placeholder entry in database with "creating" status
      const result = await queries.insertCreatedImage.run(
        user.id,
        filename,
        filePath,
        1024, // width
        1024, // height
        null, // color - will be set after creation
        'creating' // status
      );

      // Return immediately with creating status
      res.json({
        id: result.insertId,
        filename,
        url: `/images/created/${filename}`,
        color: null,
        width: 1024,
        height: 1024,
        status: 'creating',
        created_at: new Date().toISOString()
      });

      // Create the image asynchronously with delay
      (async () => {
        try {
          // Add delay (3-5 seconds)
          const delay = 3000 + Math.random() * 2000; // 3-5 seconds
          // const delay = 100000;
          await new Promise(resolve => setTimeout(resolve, delay));

          // Create the image
          const { color, width, height } = await generateRandomColorImage(filePath);

          // Update database with completed status and color
          await queries.updateCreatedImageStatus.run(result.insertId, user.id, 'completed', color);
          
          // Note: We could also update the color in the database, but for now status is enough
          // The color will be fetched when the image is loaded
        } catch (error) {
          console.error("Error creating image in background:", error);
          // Update status to failed
          await queries.updateCreatedImageStatus.run(result.insertId, user.id, 'failed');
        }
      })();
    } catch (error) {
      console.error("Error initiating image creation:", error);
      return res.status(500).json({ error: "Failed to initiate image creation" });
    }
  });

  // GET /api/create/images - List all images for user
  router.get("/api/create/images", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      const images = await queries.selectCreatedImagesForUser.all(user.id);
      
      // Transform to include URLs
      const imagesWithUrls = images.map((img) => ({
        id: img.id,
        filename: img.filename,
        url: `/images/created/${img.filename}`,
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

  // GET /api/create/images/:id - Get specific image metadata
  router.get("/api/create/images/:id", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      const image = await queries.selectCreatedImageById.get(
        req.params.id,
        user.id
      );

      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      return res.json({
        id: image.id,
        filename: image.filename,
        url: `/images/created/${image.filename}`,
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
