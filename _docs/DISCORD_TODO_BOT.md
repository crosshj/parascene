# Discord bot: show current tasks

## What’s required

1. **Discord application and bot**
   - [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot.
   - Create a bot, copy the **token** (keep it secret).
   - Enable “Message Content Intent” under Bot if you use prefix commands.

2. **Invite the bot**
   - Developer Portal → OAuth2 → URL Generator: scopes `bot`, permissions e.g. “Send Messages”, “Read Message History”.
   - Open the generated URL and add the bot to your server.

3. **Where the bot runs**
   - The bot must run 24/7 (or whenever you want it to respond). Options:
     - Your machine (e.g. `node discord-bot/index.js` in a terminal or as a service).
     - A small VPS or cloud instance.
     - A free tier (e.g. Railway, Render, Fly.io) that runs a Node process.

4. **How it gets the task list**
   - **Option A (recommended):** Call your deployed app: `GET https://<your-parascene-domain>/api/todo`. No auth needed for read. The bot only needs the base URL in env.
   - **Option B:** Run the bot on the same host as the app and call `http://localhost:2367/api/todo`, or read `_docs/TODO.json` directly (no priority formula; raw cost/impact only).

5. **Dependencies**
   - Only `discord.js` (and Node 18+). The bot lives in `discord-bot/` with its own `package.json` so the main app stays unchanged.

## Env vars

- `DISCORD_BOT_TOKEN` — from Developer Portal.
- `TODO_API_URL` — e.g. `https://your-app.vercel.app` (no trailing slash). The bot will request `{TODO_API_URL}/api/todo`.

## Commands

- **Slash command** `/todo` — replies with the current task list (name, cost, impact, priority, starred), sorted by priority.
- Optional: **prefix** `!todo` if you prefer (and enable Message Content Intent).

## Limits

- Discord embeds: 4096 chars per embed, 10 embeds per message. If you have many tasks, the bot splits into multiple embeds or a single code block.
- Slash commands need to be registered once (the script does this on startup when you set `REGISTER_COMMANDS=1`).

## One-time setup

```bash
cd discord-bot
cp .env.example .env
# Edit .env: DISCORD_BOT_TOKEN, TODO_API_URL, and REGISTER_COMMANDS=1 for first run
npm install
npm start
```

After the first run (with `REGISTER_COMMANDS=1`), set `REGISTER_COMMANDS=0` so it doesn’t re-register on every start.
