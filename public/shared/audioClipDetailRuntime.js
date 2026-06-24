/**
 * Audio clip detail page runtime — standalone and embed (`?embed=1`).
 */

import { createEmbedPageRuntime } from './embedPageRuntime.js';

const runtime = createEmbedPageRuntime('__ps_audio_clip_embed');

export const isAudioClipDetailEmbed = runtime.isEmbed;
export const isAudioClipDetailEmbedFrame = runtime.isEmbedFrame;
export const navigate = runtime.navigate;
export const shellOut = runtime.shellOut;
export const requestCloseOverlay = runtime.requestCloseOverlay;
export const navigateFromModal = runtime.navigateFromModal;
export const bindAudioClipDetailEmbedNavigation = runtime.bindEmbedNavigation;
export const bindAudioClipDetailEmbedEscape = runtime.bindEmbedEscape;
