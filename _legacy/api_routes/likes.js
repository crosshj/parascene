import express from "express";
import { canViewUnpublishedCreationViaEditorialPin } from "./feed/editorialPin.js";
import { canViewUnpublishedChallengeResultsCreation } from "./utils/challengeResultsAccess.js";
import { getWhoMetaForCreation } from "./utils/whoMeta.js";

async function requireUser(req, res, queries) {
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

function isPublishedImage(image) {
  return image?.published === true || image?.published === 1;
}

/** Exported for tests — owner, published, admin, active editorial pin, or challenge results. */
export async function requireCreatedImageAccess({ queries, imageId, userId, userRole }) {
  // Owner access
  const owned = await queries.selectCreatedImageById?.get(imageId, userId);
  if (owned) {
    return owned;
  }

  // Published, admin, active editorial pin, or lasting challenge results access
  const anyImage = await queries.selectCreatedImageByIdAnyUser?.get(imageId);
  if (anyImage) {
    const isPublished = isPublishedImage(anyImage);
    const isAdmin = userRole === 'admin';
    if (isPublished || isAdmin) {
      return anyImage;
    }
    try {
      const pinOk = await canViewUnpublishedCreationViaEditorialPin(queries, {
        ancestorRow: anyImage
      });
      if (pinOk) {
        return anyImage;
      }
    } catch {
      // deny
    }
    try {
      const resultsOk = await canViewUnpublishedChallengeResultsCreation({
        image: anyImage,
        userId
      });
      if (resultsOk) {
        return anyImage;
      }
    } catch {
      // deny
    }
  }

  return null;
}

async function getLikeMeta({ queries, imageId, viewerId }) {
  const countRow = await queries.selectCreatedImageLikeCount?.get(imageId);
  const likeCount = Number(countRow?.like_count ?? 0);

  const likedRow = viewerId
    ? await queries.selectCreatedImageViewerLiked?.get(viewerId, imageId)
    : null;
  const viewerLiked = Boolean(likedRow?.viewer_liked);

  let liked_by = [];
  try {
    const who = await getWhoMetaForCreation(queries, imageId, { like_count: likeCount });
    liked_by = Array.isArray(who?.liked_by) ? who.liked_by : [];
  } catch {
    liked_by = [];
  }

  return { like_count: likeCount, viewer_liked: viewerLiked, liked_by };
}

export default function createLikesRoutes({ queries }) {
  const router = express.Router();

  router.get("/api/created-images/:id/like", async (req, res) => {
    const user = await requireUser(req, res, queries);
    if (!user) return;

    const imageId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(imageId) || imageId <= 0) {
      return res.status(400).json({ error: "Invalid image id" });
    }

    const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }

    const meta = await getLikeMeta({ queries, imageId, viewerId: user.id });
    return res.json(meta);
  });

  router.post("/api/created-images/:id/like", async (req, res) => {
    const user = await requireUser(req, res, queries);
    if (!user) return;

    const imageId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(imageId) || imageId <= 0) {
      return res.status(400).json({ error: "Invalid image id" });
    }

    const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }

    await queries.insertCreatedImageLike?.run(user.id, imageId);
    const meta = await getLikeMeta({ queries, imageId, viewerId: user.id });
    return res.json({ ...meta, viewer_liked: true });
  });

  router.delete("/api/created-images/:id/like", async (req, res) => {
    const user = await requireUser(req, res, queries);
    if (!user) return;

    const imageId = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(imageId) || imageId <= 0) {
      return res.status(400).json({ error: "Invalid image id" });
    }

    const image = await requireCreatedImageAccess({ queries, imageId, userId: user.id, userRole: user.role });
    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }

    await queries.deleteCreatedImageLike?.run(user.id, imageId);
    const meta = await getLikeMeta({ queries, imageId, viewerId: user.id });
    return res.json({ ...meta, viewer_liked: false });
  });

  return router;
}

