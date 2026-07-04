/**
 * Baked default for create page cold start (public generation servers).
 * Regenerate: node db/maintenance/generate_create_servers_default.js
 */

export const CREATE_SERVERS_CACHE_KEY = 'create-servers-cache';

/** @type {Array<{ id: number, name: string, server_config?: object, is_member?: boolean, is_owner?: boolean, suspended?: boolean }>} */
export const DEFAULT_CREATE_SERVERS = [
	{
		"id": 1,
		"name": "Parascene",
		"description": "Official Parascene system server",
		"status": "active",
		"is_owner": false,
		"is_member": true,
		"can_manage": false,
		"can_join_leave": false,
		"suspended": false,
		"server_config": {
			"status": "operational",
			"methods": {
				"replicate": {
					"name": "Replicate",
					"fields": {
						"model": {
							"type": "select",
							"label": "Model",
							"options": [
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "X.ai Grok Imagine Image",
									"value": "xai/grok-imagine-image"
								},
								{
									"hint": "No input image support. Low censorship.",
									"label": "PrunaAI P-Image",
									"value": "prunaai/p-image"
								},
								{
									"hint": "Supports multiple image inputs. Low censorship.",
									"label": "PrunaAI P-Image Edit",
									"value": "prunaai/p-image-edit"
								},
								{
									"hint": "No input image support. Low censorship.",
									"label": "Qwen Image",
									"value": "qwen/qwen-image"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "Qwen Image Edit",
									"value": "qwen/qwen-image-edit"
								},
								{
									"hint": "Supports multiple image inputs.",
									"label": "Google Nano Banana (Gemini 2.5)",
									"value": "google/nano-banana"
								},
								{
									"hint": "Supports single image input.",
									"label": "BFL Flux 2 Pro",
									"value": "black-forest-labs/flux-2-pro"
								},
								{
									"hint": "Supports multiple image inputs.",
									"label": "ByteDance Seedream 4",
									"value": "bytedance/seedream-4"
								},
								{
									"hint": "No input image support.",
									"label": "PrunaAI Z-Image Turbo",
									"value": "prunaai/z-image-turbo",
									"uses_dimensions": true
								},
								{
									"hint": "Supports multiple image inputs [reference, style, character].",
									"label": "Luma Photon",
									"value": "luma/photon"
								},
								{
									"hint": "Supports single image input [subject].",
									"label": "MiniMax Image 01",
									"value": "minimax/image-01"
								},
								{
									"hint": "No input image support.",
									"label": "Leonardo AI Lucid Origin",
									"value": "leonardoai/lucid-origin"
								},
								{
									"hint": "No input image support. Low censorship.",
									"label": "Recraft V4",
									"value": "recraft-ai/recraft-v4",
									"uses_recraft_size": true
								},
								{
									"hint": "No input image support.  Low censorship.",
									"label": "ByteDance SDXL Lightning 4-step",
									"value": "bytedance/sdxl-lightning-4step:6f7a773af6fc3e8de9d5a3c00be77c17308914bf67772726aff83496ba1e3bbe",
									"uses_dimensions": true
								},
								{
									"hint": "Supports multiple image inputs [image, mask].  Low censorship.",
									"label": "Stability AI SDXL",
									"value": "stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc",
									"uses_dimensions": true
								}
							],
							"required": true
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						},
						"aspect_ratio": {
							"type": "select",
							"label": "Aspect Ratio",
							"hidden": true,
							"default": "1:1",
							"options": [
								{
									"label": "1:1",
									"value": "1:1"
								},
								{
									"label": "4:5",
									"value": "4:5"
								},
								{
									"label": "9:16",
									"value": "9:16"
								},
								{
									"label": "16:9",
									"value": "16:9"
								}
							],
							"required": false
						},
						"input_images": {
							"type": "image_url_array",
							"label": "Input Images",
							"required": false
						}
					},
					"intent": "image_generate",
					"credits": 3,
					"default": true,
					"description": "Run a Replicate image generation model."
				},
				"uploadImage": {
					"name": "Upload Image",
					"fields": {
						"image_url": {
							"type": "image_url",
							"label": "Image URL",
							"required": true
						},
						"aspect_ratio": {
							"type": "select",
							"label": "Aspect Ratio",
							"hidden": true,
							"default": "1:1",
							"options": [
								{
									"label": "1:1",
									"value": "1:1"
								},
								{
									"label": "4:5",
									"value": "4:5"
								},
								{
									"label": "9:16",
									"value": "9:16"
								},
								{
									"label": "16:9",
									"value": "16:9"
								}
							],
							"required": false
						}
					},
					"intent": "image_generate",
					"credits": 0,
					"description": "Letterboxes an image from a URL to the chosen aspect ratio (long edge 1024; no crop)."
				},
				"replicatePro": {
					"name": "Replicate Pro",
					"fields": {
						"model": {
							"type": "select",
							"label": "Model",
							"options": [
								{
									"hint": "Supports multiple image inputs. Premium.",
									"label": "Google Nano Banana 2",
									"value": "google/nano-banana-2"
								},
								{
									"hint": "Supports multiple image inputs. Premium.",
									"label": "Google Nano Banana Pro",
									"value": "google/nano-banana-pro"
								},
								{
									"hint": "Supports multiple image inputs. Premium.",
									"label": "OpenAI GPT-Image 1.5",
									"value": "openai/gpt-image-1.5"
								},
								{
									"hint": "Supports multiple image inputs. Premium.",
									"label": "OpenAI GPT-Image 2",
									"value": "openai/gpt-image-2"
								},
								{
									"hint": "Supports multiple image inputs. Premium.",
									"label": "BFL Flux 2 Max",
									"value": "black-forest-labs/flux-2-max"
								},
								{
									"hint": "Supports multiple image inputs.",
									"label": "BFL Flux 2 Pro Multi-Image Edit",
									"value": "black-forest-labs/flux-2-pro"
								}
							],
							"required": true
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						},
						"aspect_ratio": {
							"type": "select",
							"label": "Aspect Ratio",
							"hidden": true,
							"default": "1:1",
							"options": [
								{
									"label": "1:1",
									"value": "1:1"
								},
								{
									"label": "4:5",
									"value": "4:5"
								},
								{
									"label": "9:16",
									"value": "9:16"
								},
								{
									"label": "16:9",
									"value": "16:9"
								}
							],
							"required": false
						},
						"input_images": {
							"type": "image_url_array",
							"label": "Input Images",
							"required": false
						}
					},
					"intent": "image_generate",
					"credits": 15,
					"description": "Premium Replicate models. Higher quality, higher credits."
				},
				"pixelLabImage": {
					"name": "PixelLab",
					"fields": {
						"model": {
							"type": "select",
							"label": "Model",
							"default": "pixflux",
							"options": [
								{
									"label": "Pixflux",
									"value": "pixflux"
								},
								{
									"label": "Bitforge",
									"value": "bitforge"
								}
							],
							"required": false
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						},
						"no_background": {
							"type": "boolean",
							"label": "No Background",
							"default": false,
							"required": false
						}
					},
					"intent": "image_generate",
					"credits": 0.2,
					"description": "Generate pixel art with PixelLab's Pixflux and Bitforge"
				},
				"replicateVideo": {
					"name": "Replicate Video",
					"async": true,
					"fields": {
						"image": {
							"type": "image_url",
							"label": "Image",
							"required": true
						},
						"model": {
							"type": "select",
							"label": "Model",
							"default": "wan-video/wan-2.2-i2v-fast",
							"options": [
								{
									"hint": "Image-to-video (i2v), fast.",
									"label": "Wan Video 2.2 i2v Fast",
									"value": "wan-video/wan-2.2-i2v-fast"
								}
							],
							"required": true
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						}
					},
					"intent": "video_generate",
					"credits": 10,
					"description": "Run a Replicate image-to-video model."
				}
			},
			"last_check_at": "2026-06-21T13:18:33.002Z"
		}
	},
	{
		"id": 6,
		"name": "Parascene Blue",
		"description": "A collection of local models for you.",
		"status": "active",
		"is_owner": false,
		"is_member": true,
		"can_manage": false,
		"can_join_leave": false,
		"suspended": false,
		"server_config": {
			"status": "operational",
			"methods": {
				"text2image": {
					"id": "text2image",
					"name": "Text To Image",
					"async": true,
					"fields": {
						"seed": {
							"min": 0,
							"step": 1,
							"type": "number",
							"label": "Seed",
							"hidden": true,
							"required": false,
							"description": "Optional deterministic seed. If not provided, a random seed is used."
						},
						"model": {
							"type": "select",
							"label": "Model",
							"options": [
								{
									"label": "flux: flux1-dev",
									"value": "diffusion_models/flux/flux1-dev.safetensors"
								},
								{
									"label": "flux: flux1-dev-fp8",
									"value": "checkpoints/FLUX1/flux1-dev-fp8.safetensors"
								},
								{
									"label": "flux: flux1-dev-kontext_fp8_scaled",
									"value": "diffusion_models/flux/flux1-dev-kontext_fp8_scaled.safetensors"
								},
								{
									"label": "flux: flux1-krea-dev_fp8_scaled",
									"value": "diffusion_models/flux/flux1-krea-dev_fp8_scaled.safetensors"
								},
								{
									"label": "flux: flux1-schnell",
									"value": "diffusion_models/flux/flux1-schnell.safetensors"
								},
								{
									"label": "flux: flux1-schnell-fp8",
									"value": "checkpoints/FLUX1/flux1-schnell-fp8.safetensors"
								},
								{
									"label": "flux: getphatFLUXReality_v10FP8",
									"value": "diffusion_models/flux/getphatFLUXReality_v10FP8.safetensors"
								},
								{
									"label": "flux: getphatFLUXReality_v5HardcoreFP8",
									"value": "diffusion_models/flux/getphatFLUXReality_v5HardcoreFP8.safetensors"
								},
								{
									"label": "flux: real-dream-flux-1-fp8",
									"value": "diffusion_models/flux/real-dream-flux-1-fp8.safetensors"
								},
								{
									"label": "flux: STOIQOAfroditeFLUXXL_F1DAlpha",
									"value": "diffusion_models/flux/STOIQOAfroditeFLUXXL_F1DAlpha.safetensors"
								},
								{
									"label": "flux: STOIQONewrealityFLUXSD35_f1DAlphaTwo",
									"value": "diffusion_models/flux/STOIQONewrealityFLUXSD35_f1DAlphaTwo.safetensors"
								},
								{
									"label": "pony: cyberrealisticPony_v130",
									"value": "checkpoints/pony/cyberrealisticPony_v130.safetensors"
								},
								{
									"label": "qwen: qwen_image_edit_fp8_e4m3fn",
									"value": "diffusion_models/qwen/qwen_image_edit_fp8_e4m3fn.safetensors"
								},
								{
									"label": "qwen: Qwen-Rapid-AIO-NSFW-v9",
									"value": "checkpoints/qwen/Qwen-Rapid-AIO-NSFW-v9.safetensors"
								},
								{
									"label": "sd15: cyberrealistic_v20",
									"value": "checkpoints/1.5/cyberrealistic_v20.safetensors"
								},
								{
									"label": "sd15: deliberate_v11",
									"value": "checkpoints/1.5/deliberate_v11.safetensors"
								},
								{
									"label": "sd15: dreamShaper_8_pruned",
									"value": "checkpoints/1.5/dreamShaper_8_pruned.safetensors"
								},
								{
									"label": "sd15: liberty_main",
									"value": "checkpoints/1.5/liberty_main.safetensors"
								},
								{
									"label": "sd15: lofi_V2pre",
									"value": "checkpoints/1.5/lofi_V2pre.safetensors"
								},
								{
									"label": "sd15: qgo10b_qgo10b",
									"value": "checkpoints/1.5/qgo10b_qgo10b.safetensors"
								},
								{
									"label": "sd15: realisticVisionV60B1_v60B1VAE",
									"value": "checkpoints/1.5/realisticVisionV60B1_v60B1VAE.safetensors"
								},
								{
									"label": "sd15: revAnimated_v122",
									"value": "checkpoints/1.5/revAnimated_v122.safetensors"
								},
								{
									"label": "sd15: rpg_v5",
									"value": "checkpoints/1.5/rpg_v5.safetensors"
								},
								{
									"label": "sd15: toonAme_version20",
									"value": "checkpoints/1.5/toonAme_version20.safetensors"
								},
								{
									"label": "sdxl: dreamshaperXL_turboDpmppSDE",
									"value": "checkpoints/xl/dreamshaperXL_turboDpmppSDE.safetensors"
								},
								{
									"label": "sdxl: illustriousXL20_v20",
									"value": "checkpoints/xl/illustriousXL20_v20.safetensors"
								},
								{
									"label": "sdxl: juggernautXL_v7Rundiffusion",
									"value": "checkpoints/xl/juggernautXL_v7Rundiffusion.safetensors"
								},
								{
									"label": "sdxl: juggernautXL_v9Rdphoto2Lightning",
									"value": "checkpoints/xl/juggernautXL_v9Rdphoto2Lightning.safetensors"
								},
								{
									"label": "sdxl: protovisionXLHighFidelity3D_releaseV660Bakedvae",
									"value": "checkpoints/xl/protovisionXLHighFidelity3D_releaseV660Bakedvae.safetensors"
								},
								{
									"label": "sdxl: realcartoonXL_v6",
									"value": "checkpoints/xl/realcartoonXL_v6.safetensors"
								},
								{
									"label": "sdxl: realDream_sdxlLightning1",
									"value": "checkpoints/xl/realDream_sdxlLightning1.safetensors"
								},
								{
									"label": "sdxl: sd_xl_base_1.0",
									"value": "checkpoints/xl/sd_xl_base_1.0.safetensors"
								},
								{
									"label": "sdxl: sd_xl_turbo_1.0_fp16",
									"value": "checkpoints/xl/sd_xl_turbo_1.0_fp16.safetensors"
								},
								{
									"label": "sdxl: zavychromaxl_v40",
									"value": "checkpoints/xl/zavychromaxl_v40.safetensors"
								},
								{
									"label": "z-image: z_image_turbo_bf16",
									"value": "diffusion_models/z-image/z_image_turbo_bf16.safetensors"
								}
							],
							"required": true
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						},
						"aspect_ratio": {
							"type": "select",
							"label": "Aspect Ratio",
							"hidden": true,
							"default": "1:1",
							"options": [
								{
									"label": "1:1",
									"value": "1:1"
								},
								{
									"label": "4:5",
									"value": "4:5"
								},
								{
									"label": "9:16",
									"value": "9:16"
								},
								{
									"label": "16:9",
									"value": "16:9"
								}
							],
							"required": false
						}
					},
					"intent": "image_generate",
					"credits": 0.1,
					"default": true,
					"description": "Generate an image from text."
				},
				"text2video": {
					"id": "text2video",
					"name": "Text To Video",
					"async": true,
					"fields": {
						"seed": {
							"min": 0,
							"step": 1,
							"type": "number",
							"label": "Seed",
							"hidden": true,
							"required": false,
							"description": "Optional deterministic seed. If not provided, a random seed is used."
						},
						"model": {
							"type": "select",
							"label": "Model",
							"options": [
								{
									"hint": "Wan 2.2 t2v rapid-AIO checkpoint (WAN\\wan2.2-t2v-rapid-aio-v10.safetensors).",
									"label": "Wan — text-to-video (rapid AIO)",
									"value": "wan_t2v"
								},
								{
									"hint": "LTX 2.3 t2v checkpoint (ltx-2.3-22b-dev-fp8.safetensors).",
									"label": "LTX — text-to-video",
									"value": "ltx_t2v"
								}
							],
							"required": true
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						},
						"aspect_ratio": {
							"type": "select",
							"label": "Aspect Ratio",
							"hidden": true,
							"default": "1:1",
							"options": [
								{
									"label": "1:1",
									"value": "1:1"
								},
								{
									"label": "4:5",
									"value": "4:5"
								},
								{
									"label": "9:16",
									"value": "9:16"
								},
								{
									"label": "16:9",
									"value": "16:9"
								}
							],
							"required": false
						}
					},
					"intent": "video_generate",
					"credits": 1,
					"default": false,
					"description": "Generate a video from a text prompt."
				},
				"audio2video": {
					"id": "audio2video",
					"name": "Audio To Video",
					"async": true,
					"fields": {
						"seed": {
							"min": 0,
							"step": 1,
							"type": "number",
							"label": "Seed",
							"hidden": true,
							"required": false,
							"description": "Optional deterministic seed. If not provided, a random seed is used."
						},
						"model": {
							"type": "select",
							"label": "Model",
							"options": [
								{
									"hint": "LTX 2.3 ia2v checkpoint with user-supplied audio (ltx-2.3-22b-dev-fp8.safetensors).",
									"label": "LTX — audio-to-video (ia2v)",
									"value": "ltx_a2v"
								}
							],
							"required": true
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						},
						"aspect_ratio": {
							"type": "select",
							"label": "Aspect Ratio",
							"hidden": true,
							"default": "1:1",
							"options": [
								{
									"label": "1:1",
									"value": "1:1"
								},
								{
									"label": "4:5",
									"value": "4:5"
								},
								{
									"label": "9:16",
									"value": "9:16"
								},
								{
									"label": "16:9",
									"value": "16:9"
								}
							],
							"required": false
						},
						"input_images": {
							"type": "image_url_array",
							"label": "Input Images",
							"required": false,
							"description": "Optional start image. When omitted, generates from audio and prompt only."
						},
						"input_audio_urls": {
							"type": "audio_url_array",
							"label": "Input Audio",
							"required": true
						}
					},
					"intent": "video_generate",
					"credits": 1,
					"default": false,
					"description": "Generate a video from audio and prompt; optional start image."
				},
				"image2image": {
					"id": "image2image",
					"name": "Image To Image",
					"async": true,
					"fields": {
						"seed": {
							"min": 0,
							"step": 1,
							"type": "number",
							"label": "Seed",
							"hidden": true,
							"required": false,
							"description": "Optional deterministic seed. If not provided, a random seed is used."
						},
						"model": {
							"type": "select",
							"label": "Model",
							"options": [
								{
									"hint": "Flux Kontext reference-latent edit (fixed weights in workflow).",
									"label": "Flux — Kontext edit",
									"value": "flux_kontext_i2i"
								},
								{
									"hint": "Qwen Image Edit + Lightning LoRA (fixed workflow).",
									"label": "Qwen — Image Edit 4-step",
									"value": "qwen_edit_i2i"
								},
								{
									"hint": "Qwen Rapid AIO edit-plus stack (fixed checkpoint).",
									"label": "Qwen — Rapid AIO edit",
									"value": "qwen_rapid_i2i"
								},
								{
									"hint": "OmniGen2 reference-latent edit (fixed workflow).",
									"label": "OmniGen2 — image edit",
									"value": "omnigen2_edit_i2i"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: dreamshaperXL_turboDpmppSDE",
									"value": "checkpoints/xl/dreamshaperXL_turboDpmppSDE.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: illustriousXL20_v20",
									"value": "checkpoints/xl/illustriousXL20_v20.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: juggernautXL_v7Rundiffusion",
									"value": "checkpoints/xl/juggernautXL_v7Rundiffusion.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: juggernautXL_v9Rdphoto2Lightning",
									"value": "checkpoints/xl/juggernautXL_v9Rdphoto2Lightning.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: protovisionXLHighFidelity3D_releaseV660Bakedvae",
									"value": "checkpoints/xl/protovisionXLHighFidelity3D_releaseV660Bakedvae.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: realcartoonXL_v6",
									"value": "checkpoints/xl/realcartoonXL_v6.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: realDream_sdxlLightning1",
									"value": "checkpoints/xl/realDream_sdxlLightning1.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: sd_xl_base_1.0",
									"value": "checkpoints/xl/sd_xl_base_1.0.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: sd_xl_turbo_1.0_fp16",
									"value": "checkpoints/xl/sd_xl_turbo_1.0_fp16.safetensors"
								},
								{
									"hint": "Supports single image input. Low censorship.",
									"label": "sdxl: zavychromaxl_v40",
									"value": "checkpoints/xl/zavychromaxl_v40.safetensors"
								}
							],
							"required": true
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						},
						"denoise": {
							"max": 1,
							"min": 0,
							"step": 0.01,
							"type": "number",
							"label": "Denoise",
							"required": false,
							"description": "Strength of denoising. If not provided, SDXL models default to 0.65."
						},
						"aspect_ratio": {
							"type": "select",
							"label": "Aspect Ratio",
							"hidden": true,
							"default": "1:1",
							"options": [
								{
									"label": "1:1",
									"value": "1:1"
								},
								{
									"label": "4:5",
									"value": "4:5"
								},
								{
									"label": "9:16",
									"value": "9:16"
								},
								{
									"label": "16:9",
									"value": "16:9"
								}
							],
							"required": false
						},
						"input_images": {
							"type": "image_url_array",
							"label": "Input Images",
							"required": false
						}
					},
					"intent": "image_mutate",
					"credits": 0.1,
					"default": false,
					"description": "Generate an image from an input image and text."
				},
				"image2video": {
					"id": "image2video",
					"name": "Image To Video",
					"async": true,
					"fields": {
						"seed": {
							"min": 0,
							"step": 1,
							"type": "number",
							"label": "Seed",
							"hidden": true,
							"required": false,
							"description": "Optional deterministic seed. If not provided, a random seed is used."
						},
						"model": {
							"type": "select",
							"label": "Model",
							"options": [
								{
									"hint": "Wan 2.2 i2v stack on Comfy (weights under diffusion_models/wan/i2v).",
									"label": "Wan — image-to-video",
									"value": "wan_i2v"
								},
								{
									"hint": "LTX 2.3 i2v checkpoint (weights under checkpoints/ltx/i2v).",
									"label": "LTX — image-to-video",
									"value": "ltx_i2v"
								}
							],
							"required": true
						},
						"prompt": {
							"type": "text",
							"label": "Prompt",
							"required": true
						},
						"aspect_ratio": {
							"type": "select",
							"label": "Aspect Ratio",
							"hidden": true,
							"default": "1:1",
							"options": [
								{
									"label": "1:1",
									"value": "1:1"
								},
								{
									"label": "4:5",
									"value": "4:5"
								},
								{
									"label": "9:16",
									"value": "9:16"
								},
								{
									"label": "16:9",
									"value": "16:9"
								}
							],
							"required": false
						},
						"input_images": {
							"type": "image_url_array",
							"label": "Input Images",
							"required": true
						}
					},
					"intent": "video_generate",
					"credits": 1,
					"default": false,
					"description": "Generate a video from a start image and prompt (local Comfy workflows)."
				}
			},
			"last_check_at": "2026-06-08T19:10:19.084Z"
		}
	}
];
