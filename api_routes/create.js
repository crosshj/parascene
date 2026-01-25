import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getThumbnailUrl } from "./utils/url.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function createCreateRoutes({ queries, storage }) {
  const router = express.Router();
  // Serve created images statically (for filesystem-based adapters)
  // This will be used as fallback for filesystem adapters
  const imagesDir = path.join(__dirname, "..", "db", "data", "images", "created");
  router.use("/images/created", express.static(imagesDir));
  
  // GET /api/images/created/:filename - Serve image through backend
  // This route handles images from Supabase Storage and provides authorization
  router.get("/api/images/created/:filename", async (req, res) => {
    const filename = req.params.filename;
    const variant = req.query?.variant;
    
    try {
      // Find the image in the database by filename
      const image = await queries.selectCreatedImageByFilename?.get(filename);
      
      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }
      
      // Check access: user owns the image OR image is published
      const userId = req.auth?.userId;
      const isOwner = userId && image.user_id === userId;
      const isPublished = image.published === 1 || image.published === true;
      
      if (!isOwner && !isPublished) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      // Fetch image buffer from storage
      const imageBuffer = await storage.getImageBuffer(filename, { variant });
      
      // Set appropriate content type
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.send(imageBuffer);
    } catch (error) {
      console.error("Error serving image:", error);
      if (error.message && error.message.includes("not found")) {
        return res.status(404).json({ error: "Image not found" });
      }
      return res.status(500).json({ error: "Failed to serve image" });
    }
  });

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

    const { server_id, method, args } = req.body;

    // Validate required fields
    if (!server_id || !method) {
      return res.status(400).json({ 
        error: "Missing required fields", 
        message: "server_id and method are required" 
      });
    }

    try {
      // Fetch server
      const server = await queries.selectServerById.get(server_id);
      if (!server) {
        return res.status(404).json({ error: "Server not found" });
      }

      if (server.status !== 'active') {
        return res.status(400).json({ error: "Server is not active" });
      }

      // Parse server_config and validate method
      if (!server.server_config || !server.server_config.methods) {
        return res.status(400).json({ error: "Server configuration is invalid" });
      }

      const methodConfig = server.server_config.methods[method];
      if (!methodConfig) {
        return res.status(400).json({ 
          error: "Method not available", 
          message: `Method "${method}" is not available on this server`,
          available_methods: Object.keys(server.server_config.methods)
        });
      }

      // Get credit cost from method config
      const CREATION_CREDIT_COST = methodConfig.credits ?? 0.5;

      // Check user's credit balance
      let credits = await queries.selectUserCredits.get(user.id);
      
      // Initialize credits if record doesn't exist
      if (!credits) {
        await queries.insertUserCredits.run(user.id, 100, null);
        credits = await queries.selectUserCredits.get(user.id);
      }

      // Check if user has sufficient credits
      if (!credits || credits.balance < CREATION_CREDIT_COST) {
        return res.status(402).json({ 
          error: "Insufficient credits", 
          message: `Creation requires ${CREATION_CREDIT_COST} credits. You have ${credits?.balance ?? 0} credits.`,
          required: CREATION_CREDIT_COST,
          current: credits?.balance ?? 0
        });
      }

      // Deduct credits before creating the image
      await queries.updateUserCreditsBalance.run(user.id, -CREATION_CREDIT_COST);

      // Call provider server
      let imageBuffer;
      let color = null;
      let width = 1024;
      let height = 1024;

      try {
        const providerResponse = await fetch(server.server_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'image/png'
          },
          body: JSON.stringify({
            method: method,
            args: args || {}
          }),
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });

        if (!providerResponse.ok) {
          // Refund credits on provider error
          await queries.updateUserCreditsBalance.run(user.id, CREATION_CREDIT_COST);
          return res.status(502).json({ 
            error: "Provider server error", 
            message: `Provider server returned error: ${providerResponse.status} ${providerResponse.statusText}`
          });
        }

        // Get image buffer from response
        imageBuffer = Buffer.from(await providerResponse.arrayBuffer());
        
        // Try to get metadata from headers if available
        const headerColor = providerResponse.headers.get('X-Image-Color');
        const headerWidth = providerResponse.headers.get('X-Image-Width');
        const headerHeight = providerResponse.headers.get('X-Image-Height');
        
        if (headerColor) color = headerColor;
        if (headerWidth) width = parseInt(headerWidth, 10);
        if (headerHeight) height = parseInt(headerHeight, 10);
      } catch (fetchError) {
        // Refund credits on fetch error
        await queries.updateUserCreditsBalance.run(user.id, CREATION_CREDIT_COST);
        
        if (fetchError.name === 'AbortError') {
          return res.status(504).json({ 
            error: "Provider server timeout", 
            message: "Provider server did not respond within 30 seconds"
          });
        }
        return res.status(502).json({ 
          error: "Failed to connect to provider server", 
          message: fetchError.message
        });
      }

      // Create unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      const filename = `${user.id}_${timestamp}_${random}.png`;

      // Upload image using storage adapter
      const imageUrl = await storage.uploadImage(imageBuffer, filename);

      // Create entry in database with completed status
      const result = await queries.insertCreatedImage.run(
        user.id,
        filename,
        imageUrl,
        width,
        height,
        color,
        'completed'
      );

      // Credit server owner (30% of what user was charged)
      const ownerCredits = CREATION_CREDIT_COST * 0.3;
      if (server.user_id && ownerCredits > 0) {
        // Initialize owner credits if needed
        let ownerCreditsRecord = await queries.selectUserCredits.get(server.user_id);
        if (!ownerCreditsRecord) {
          await queries.insertUserCredits.run(server.user_id, 0, null);
        }
        await queries.updateUserCreditsBalance.run(server.user_id, ownerCredits);
      }

      // Get updated credit balance
      const updatedCredits = await queries.selectUserCredits.get(user.id);

      // Return with completed status
      res.json({
        id: result.insertId,
        filename,
        url: imageUrl,
        color,
        width,
        height,
        status: 'completed',
        created_at: new Date().toISOString(),
        credits_remaining: updatedCredits?.balance ?? 0
      });
    } catch (error) {
      console.error("Error initiating image creation:", error);
      return res.status(500).json({ error: "Failed to initiate image creation", message: error.message });
    }
  });

  // GET /api/create/images - List all images for user
  router.get("/api/create/images", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      const images = await queries.selectCreatedImagesForUser.all(user.id);
      
      // Transform to include URLs (use file_path from DB which now contains the URL)
      const imagesWithUrls = images.map((img) => {
        const url = img.file_path || storage.getImageUrl(img.filename);
        return {
        id: img.id,
        filename: img.filename,
        url,
        thumbnail_url: getThumbnailUrl(url),
        width: img.width,
        height: img.height,
        color: img.color,
        status: img.status || 'completed', // Default to completed for backward compatibility
        created_at: img.created_at,
        published: img.published === 1 || img.published === true,
        published_at: img.published_at || null,
        title: img.title || null,
        description: img.description || null
        };
      });

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
      // First try to get as owner
      let image = await queries.selectCreatedImageById.get(
        req.params.id,
        user.id
      );

      // If not found as owner, check if it exists and is published
      if (!image) {
        const anyImage = await queries.selectCreatedImageByIdAnyUser.get(req.params.id);
        if (anyImage && (anyImage.published === 1 || anyImage.published === true)) {
          image = anyImage;
        } else {
          return res.status(404).json({ error: "Image not found" });
        }
      }

      // Get user information for the creator
      let creator = null;
      if (image.user_id) {
        creator = await queries.selectUserById.get(image.user_id);
      }
      const creatorProfile = image.user_id
        ? await queries.selectUserProfileByUserId.get(image.user_id).catch(() => null)
        : null;

      const likeCountRow = await queries.selectCreatedImageLikeCount?.get(image.id);
      const likeCount = Number(likeCountRow?.like_count ?? 0);
      const viewerLikedRow = await queries.selectCreatedImageViewerLiked?.get(user.id, image.id);
      const viewerLiked = Boolean(viewerLikedRow?.viewer_liked);

      return res.json({
        id: image.id,
        filename: image.filename,
        url: image.file_path || storage.getImageUrl(image.filename), // Use stored URL or generate one
        width: image.width,
        height: image.height,
        color: image.color,
        status: image.status || 'completed',
        created_at: image.created_at,
        published: image.published === 1 || image.published === true,
        published_at: image.published_at || null,
        title: image.title || null,
        description: image.description || null,
        like_count: likeCount,
        viewer_liked: viewerLiked,
        user_id: image.user_id,
        creator: creator ? {
          id: creator.id,
          email: creator.email,
          role: creator.role,
          user_name: creatorProfile?.user_name ?? null,
          display_name: creatorProfile?.display_name ?? null,
          avatar_url: creatorProfile?.avatar_url ?? null
        } : null
      });
    } catch (error) {
      console.error("Error fetching image:", error);
      return res.status(500).json({ error: "Failed to fetch image" });
    }
  });

  // POST /api/create/images/:id/publish - Publish a creation
  router.post("/api/create/images/:id/publish", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      const { title, description } = req.body;

      if (!title || title.trim() === '') {
        return res.status(400).json({ error: "Title is required" });
      }

      // Get the image to verify ownership and status
      const image = await queries.selectCreatedImageById.get(
        req.params.id,
        user.id
      );

      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      if (image.status !== 'completed') {
        return res.status(400).json({ error: "Image must be completed before publishing" });
      }

      if (image.published === 1 || image.published === true) {
        return res.status(400).json({ error: "Image is already published" });
      }

      // Publish the image
      const publishResult = await queries.publishCreatedImage.run(
        req.params.id,
        user.id,
        title.trim(),
        description ? description.trim() : null
      );

      if (publishResult.changes === 0) {
        return res.status(500).json({ error: "Failed to publish image" });
      }

      // Create feed item
      await queries.insertFeedItem.run(
        title.trim(),
        description ? description.trim() : '',
        user.email || 'User',
        null, // tags
        parseInt(req.params.id)
      );

      // Get updated image
      const updatedImage = await queries.selectCreatedImageById.get(
        req.params.id,
        user.id
      );

      return res.json({
        id: updatedImage.id,
        filename: updatedImage.filename,
        url: updatedImage.file_path || storage.getImageUrl(updatedImage.filename), // Use stored URL or generate one
        width: updatedImage.width,
        height: updatedImage.height,
        color: updatedImage.color,
        status: updatedImage.status || 'completed',
        created_at: updatedImage.created_at,
        published: true,
        published_at: updatedImage.published_at,
        title: updatedImage.title,
        description: updatedImage.description
      });
    } catch (error) {
      console.error("Error publishing image:", error);
      return res.status(500).json({ error: "Failed to publish image" });
    }
  });

  // DELETE /api/create/images/:id - Delete a creation
  router.delete("/api/create/images/:id", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    try {
      // Get the image to verify ownership
      const image = await queries.selectCreatedImageById.get(
        req.params.id,
        user.id
      );

      if (!image) {
        return res.status(404).json({ error: "Image not found" });
      }

      // Check if image is published - cannot delete published images
      if (image.published === 1 || image.published === true) {
        return res.status(400).json({ error: "Cannot delete published images" });
      }

      // Delete the image file from storage
      try {
        await storage.deleteImage(image.filename);
      } catch (storageError) {
        // Log but don't fail if file doesn't exist
        console.warn(`Warning: Could not delete image file ${image.filename}:`, storageError.message);
      }

      // Delete the database record
      const deleteResult = await queries.deleteCreatedImageById.run(
        req.params.id,
        user.id
      );

      if (deleteResult.changes === 0) {
        return res.status(500).json({ error: "Failed to delete image" });
      }

      return res.json({ success: true, message: "Image deleted successfully" });
    } catch (error) {
      console.error("Error deleting image:", error);
      return res.status(500).json({ error: "Failed to delete image" });
    }
  });

  return router;
}
