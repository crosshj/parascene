/** Try / admin / mutate defaults. */

export const TRY_DEFAULT_SERVER_ID = 1;
export const TRY_DEFAULT_METHOD = "replicate";
export const TRY_DEFAULT_MODEL = "prunaai/p-image";
export const TRY_PROMPT_STYLE_SUFFIX = "";

export const MUTATE_DEFAULT_SERVER_ID = 1;
/** Parascene server: passthrough upload; parascene-provider resizes to aspect_ratio. */
export const UPLOAD_IMAGE_METHOD_KEY = "uploadImage";
export const MUTATE_DEFAULT_METHOD_KEY = "replicate";
export const MUTATE_DEFAULT_MODEL = "xai/grok-imagine-image";
export const MUTATE_VIDEO_DEFAULT_METHOD_KEY = "replicateVideo";
export const MUTATE_VIDEO_DEFAULT_MODEL = "wan-video/wan-2.2-i2v-fast";

/** Parascene Blue — image-to-video (LTX and related methods). Available to all users on create. */
export const PARASCENE_BLUE_SERVER_ID = 6;

/** Mutate: LTX image-to-video (separate server + method + arg shape). */
export const MUTATE_VIDEO_LTX_SERVER_ID = PARASCENE_BLUE_SERVER_ID;
export const MUTATE_VIDEO_LTX_METHOD_KEY = "image2video";
export const MUTATE_VIDEO_LTX_MODEL = "ltx_i2v";

/** System + Parascene Blue: generation config visible without server membership. */
export function isPublicGenerationServerId(serverId) {
	const id = Number(serverId);
	return id === MUTATE_DEFAULT_SERVER_ID || id === PARASCENE_BLUE_SERVER_ID;
}
