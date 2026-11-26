# Plan: Advanced create

Desktop Create pane. The person picks an output and a model. The config decides the fields and which method runs. The old server-then-method Advanced form stays where it is. This pane does not submit yet.

## Aim

Replace server-first Advanced create with a method and model form.

- Desktop first. Advanced on the create composer opens the right sidebar. Sidebar title is Create. The composer button stays Advanced.
- Outputs are Image, Audio, Video, and Upload. Upload is not a model.
- No input selector and no server selector. The person picks a model. The route comes from that model and which fields are filled.
- Roles differ: start image, reference, audio, video. When several are filled, audio outranks video outranks image outranks reference outranks text. If the model only has a media route, that route still shows when the field is empty.
- A route with modelField takes its model id from that field. A select option may carry its own routes, credits, server, and fields. While that option is chosen, those replace the parent, and its extra fields show only then.
- Route line reads server, role, method, model, credits.
- Config is hard-coded JSON from GET /api/create/advanced-config. The browser keeps it in memory and refetches if missing or older than 60 seconds. A reload starts empty.
- Everyone sees every model. Joined servers are not a filter in this pane.
- The pane is its own module. It does not use the composer or the old create form for markup, CSS, or field widgets.
- The form should feel like a creative instrument: tonal surfaces, embedded labels, outlines only for focus and selection, less-used parameters behind More.

## Done

Pane

- [x] Right sidebar key advanced-create, title Create, remember false, sticky true. Sticky keeps it mounted across SPA page changes. Chat canvas restore does not steal the pane while it is sticky.
- [x] Composer hides while the pane is open.
- [x] Refresh keeps it open. localStorage key prsn-advanced-create-open stores the output. pagehide sets layoutClosing so teardown does not clear that key. Closing with X or Escape does clear it.
- [x] Escape does not close the sidebar while a page overlay, nested modal, create-select list, or media picker is open. Those layers set aria-hidden false and the open class. The picker stops Escape before it reaches the sidebar.
- [x] Home: Advanced does not also open the old /create overlay. The click handler returns when the event is already handled.
- [x] On home desktop, body.advanced-create-open hides the whole home hero.

Config

- [x] GET /api/create/advanced-config, mounted in server/server.js before the create routes. JSON is server/data/advancedCreateConfig.json, imported with a JSON import attribute.
- [x] Client cache is client/components/AdvancedCreate/config.js. In-flight requests are deduped.
- [x] Shape: image, audio, and video each have models. upload has serverId, server, credits, fields, and routes. A model has id, label, serverId, server, optional credits, optional section, fields, and optional routes. Routes are keyed by role.

Catalog

- [x] Full live model list was pulled in, then grouped into families. A family is one model row. The version or checkpoint is a config-driven select labeled Variant or Fine tune.
- [x] Friendly names replaced checkpoint ids. FP8 stays only where two options would otherwise share a name. File noise was dropped (pruned, baked VAE, sampler names, NSFW on Rapid AIO).
- [x] Section headings are omitted on the short menus. Longer menus keep the sections listed below. Croskie and Wan have no headings even though their lists are longer. That was requested, not the short-list rule.
- [x] Dropdowns size to their content, clamp to the viewport, and scroll only when taller than the page. Popovers and pickers are position fixed on document.body so the sidebar does not clip them.

Image models, in menu order

- [x] Quick: Flux, Krea, MOSS Image SFT, Qwen Image, Z-Image, X.ai Grok Imagine Image.
- [x] A–Z: Bernini-R, ByteDance Seedream 4, GPT-Image, Leonardo AI Lucid Origin, Luma Photon, MiniMax Image 01, Nano Banana, OmniGen2 image edit, PixelLab, Recraft V4, Stable Diffusion.
- [x] Community: Shark Gens (server 3, SHARKGOD GENS), then Croskie (server 4).
- [x] Flux is one model. Unlabeled Flux 3 Klein, then section FLUX 2 (Flux 2 Pro, Flux 2 Max, Flux 2 Pro Multi-Image Edit), then section FLUX 1 (Flux Kontext, Flux Dev, Flux Dev FP8, Flux Dev Kontext, Flux Schnell, Flux Schnell FP8, and the Flux 1 fine tunes). No Quick or A–Z inside Flux. flux1-krea is not a Flux variant.
- [x] Krea is one model, no inner headings: Krea 2 Turbo (int8), Krea 2 Turbo FP8 (text only), Style reference (image-only, start image and denoise), Krea Dev (flux1-krea).
- [x] Qwen Image is one family. Quick: 2.1, then 2.1 Turbo (text and image edit). A–Z: Image Edit 4-step, Image Edit, Rapid AIO v9, Rapid AIO edit, Replicate, Replicate Edit.
- [x] Z-Image variants, no headings: Turbo, P-Image, P-Image Edit, Pruna Turbo.
- [x] Stable Diffusion is one model, id stable-diffusion. Fine tune menu: section SDXL (Lightning, Stability AI, then Blue XL checkpoints including text-only cyberrealistic pony), then section SD 1.5 (text-only checkpoints). SD 1.5 options inherit the parent text and image routes but have no start-image field, so the image route does not fire. XL Blue checkpoints still carry input images and denoise.
- [x] Nano Banana, GPT-Image, and PixelLab are short variant lists with no headings. PixelLab is Bitforge and Pixflux.
- [x] Shark Gens variants: Para Dudes (0.25), Para Acid Robots (0.25), Para Windworlds (0.5). Croskie variants are that server’s generators, 0.1 each, each with its own fields: Abstract, Cute Robot, 2D Sprite, Tile Sheet, Wallpaper, Chibi Pixel, Emotion Portrait, Random Character, Mutation, Birthday Card, Fortune Cookie, Website Design.

Audio models

- [x] Speech: MiniMax Speech 2.8 Turbo, Gemini 3.1 Flash TTS, Voice train.
- [x] Music: Lyria 3, MiniMax Music (2.6 on Replicate at 10 credits, server 1, and 3 on Blue at 1 credit), YuE2 (Song is text2audio yue2 with an ABC field; Cover is audio2audio yue2_cover and requires audio), LTX 2.5 (text2audio ltx25_t2a). LTX 2.5 audio sits under Music because the only sections are Speech and Music. Its live hint is soundscape and SFX.

Video models

- [x] Order: MiniMax H3, LTX, Wan. No top-level video sections. Fast H3 is a MiniMax H3 variant, not its own model.
- [x] MiniMax H3, no headings: H3 (text and image, start image, 20), Fast H3 (same shape, 20), Reference, Reference Turbo, Reference PDD (reference2video, 60, reference image, video, and audio all use role ref).
- [x] LTX sections LTX 2.5 then LTX 2.3. 2.5: 2.5 (text, image, audio, 20), IC-LoRA (video2video, video required, 60), Ingredients (reference2video, 60). 2.3: 2.3 (20), ID-LoRA (audio2video, start image and audio required, 20), Style transition (image2video, start image required, 20), IC-LoRA (60), Ingredients (60).
- [x] Wan, no headings: 2.2 (Blue, text and image, 20), 2.2 Fast (Replicate, start image required, 10, server 1), Animate 2 (video2video, 60), Bernini-R (video required, 60), SCAIL2, SCAIL2 FP16. The old standalone Wan 2.2 i2v Fast row was folded into Wan.
- [x] Video costs follow the live methods: text, image, and audio to video are 20, video-to-video and reference-to-video are 60, Wan 2.2 Fast stays 10. New audio models are 1 credit. New image and community rows are 0.1 except Shark.

Upload

- [x] Fourth output, not a model. Server 1, Parascene, 0 credits. Fields are a required image and aspect ratio. Route is uploadImage. No model name.

Form

- [x] Module is client/components/AdvancedCreate/: AdvancedCreate.js, AdvancedCreate.html, AdvancedCreate.css, fields.js, media.js, config.js.
- [x] Selects are the custom list, not a native select. Hidden input holds the value. Consecutive options with the same section string group under a heading. A blank section means no heading. Group labels are uppercased in CSS, so FLUX 2 and SDXL display that way.
- [x] Aspect ratio is a shape picker inside this module only: ratio, outline, short name (square, portrait, phone, cinema). Ratios are 1:1, 4:5, 9:16, 16:9. It is not full width. Lyria, MiniMax speech and music, Voice train, and WAN Cloud do not get it. No shared aspectRatio.js and no composer CSS.
- [x] Image field: Click to choose, file upload through uploadImageFile, paste, URL, thumbnail, Remove. Audio field: Choose audio clip, library search of GET /api/audio-clips, pasted URL, chip, Remove. The stored value is an http(s) URL. There is no separate audio_clip_id. Video fields are still plain controls.
- [x] Prompt and lyrics are the writing workspace. Prompt placeholder is “Describe what you want to create...”. Other text fields are single line. No visual asterisks.
- [x] Placement: variant and finetune sit in the selection surface with Model. Prompt and lyrics are their own workspace surface. Aspect ratio and image, audio, and video sit on the pane with no box. Everything else goes under More when a workspace exists. If there is no workspace, those extras stay on the pane too, so Croskie generators without a prompt are not hidden.
- [x] Output choices have no tray background. The selected output still has its own highlight.
- [x] Model and Variant share one surface. Vertical padding is 6px, 8px on the first and last row, and the rows are not forced to 40px tall.
- [x] More is a disclosure row: chevron, the word More, and the names of the hidden fields. Opening it hides the names and shows the fields. Those fields share one surface. The route line is the last thing inside More, under that surface, and More hides when it would be empty.

## Not done

- [ ] No Create button. The module never calls the create workflow or POST /api/create. The route line is a description, not a request.
- [ ] Enter in a single-line field reloads the page. The form has no submit handler.
- [ ] A real request needs server id, method, and args.model from the resolved route. Variant and Fine tune values are menu ids and must not be sent as the model.
- [ ] Image, audio, and video controls store one URL. input_images, input_audio_urls, and input_video_urls need that URL in a list.
- [ ] Upload would be method uploadImage with image_url and aspect_ratio, not a model run. The picker already turns a file into a URL.
- [ ] Servers 1 and 6 are open to any signed-in user. Shark Gens (3) and Croskie (4) still require membership, or the create endpoint returns server access denied.
- [ ] Occupancy confirmation, mention checks, the pending card, navigation after create, and the credit charge are on the existing submit path and are not connected.
- [ ] No browser click-through. The Browser MCP extension was not connected, so the pane was checked by reading the code and the config, not by using it.
- [ ] Video fields do not use a picker yet. Image and audio do.

## Constraints

- Server code must not import client/ or _legacy/.
- Do not read .env. Do not rebuild the bundle. Rollup watch and the server on port 3000 already refresh.
- CSS stays in this module, tabs for indentation, existing tokens. New tokens, if any, go in public/global.css and stay generic.
- Do not invent live models or extra fields that were not in the catalog work above. The live gap was requested and then added.
