# VPS agent instructions

Never read, print, or otherwise expose `.env` files or their contents. Inspect environment variable names or deployment wiring without opening secret-bearing files.

Before changing the root-deployed app, read the [VPS migration guide](_docs/VPS_MIGRATION_GUIDE.md). It owns the old-WWW parity reference, deployment/build boundary, import adaptation and cutover requirements.

For client organization and lifecycle ownership, follow [VPS client architecture](_docs/VPS_CLIENT_ARCHITECTURE.md).

Before changing Vynly posting or integration behavior, consult the
[Vynly posting skill](https://vynly.co/skill.md) for its current API contract.
Use this reference only for Vynly-related work.

Before mobile shell, navigation, composer or responsive layout work, read the
[mobile parity contract](_docs/VPS_MOBILE_PARITY.md). It is currently a
discussion draft: use its source-mapping and verification requirements, and
resolve proposed product decisions with the user before the UI port.
