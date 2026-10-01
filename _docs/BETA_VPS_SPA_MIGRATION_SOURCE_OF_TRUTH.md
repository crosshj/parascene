# 🚨🔥 DO NOT FORGET: VPS/BETA IS AN ACTIVE-WWW-SPA PORT 🔥🚨

For client ownership, composition, controllers, and overlay routing, follow
[VPS client architecture and cleanup contract](BETA_VPS_CLIENT_ARCHITECTURE.md).
That document defines the target structure; it does not declare the port complete.

## Non-negotiable rule

**The active WWW SPA is the only default reference for the VPS/Beta frontend migration.**

We are bringing the SPA over. The deprecated standalone/page-oriented WWW code is not the design reference and must go away as much as practical. Do not use standalone route markup, standalone route CSS, old page shells, or old page-specific breakpoints just because they are easier to locate.

Before writing or moving VPS frontend code:

1. Find the active WWW SPA route and its actual DOM hierarchy.
2. Find the shared SPA builders and behavior modules that produce that hierarchy.
3. Trace the active SPA parent-to-child CSS chain, including containing widths, gaps, padding, breakpoints, and container queries.
4. Port that structure and behavior into VPS, replacing only API, resource, navigation, and build seams.
5. If there is no active SPA equivalent, document the exception and the new decision.

## 🚨 Deployment boundary: VPS must be self-contained

**VPS code must never import runtime code from outside the `vps/` directory.**

That means no imports from `api_routes/`, `public/`, `src/`, or other legacy/application trees in VPS server or client modules. Those trees may be inspected as references, but required behavior must be deliberately ported into a VPS-owned module. The Docker deployment contains `vps/`; an import that works only because the monorepo happens to have a parent directory is a deployment bug.

When shared behavior is needed:

- use the active WWW SPA code as the reference;
- port the required implementation into `vps/`;
- keep the port’s boundary and ownership clear;
- verify the module graph from the Docker image’s `/app` root before deploying.

## Creations example

The active SPA creations browse surface is the chat/pseudo-channel implementation:

- route construction: `src/chat/chatPage.js`
- card construction: `public/shared/feedCardBuild.js`
- browse layout: `public/global.css` around `.chat-page--pseudo-browse-view`
- shared media/group/badge helpers under `public/shared/`

The deprecated standalone `app-route-creations` implementation and its older fixed `content-cards-image-grid` rules are not the VPS Creations source of truth.
