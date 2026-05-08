# Prompt Quality Coach

Small web app that scores how clearly you ask questions and gives coaching feedback. Uses a local Node server so your Anthropic API key stays server-side.

## Run locally

1. Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`.
2. `npm install`
3. `npm start`
4. Open `http://localhost:3000`

Requires Node 18+.

## Deploy on Render

1. Push this repo to GitHub (e.g. `mkane968/prompt-coach`).
2. In [Render](https://dashboard.render.com): **New → Web Service** → connect that repo.
3. Use defaults:
   - **Runtime:** Node  
   - **Build command:** `npm install`  
   - **Start command:** `npm start`
4. **Environment → Add environment variable:**
   - `ANTHROPIC_API_KEY` = your Anthropic API secret (same as local `.env`).
5. **Create Web Service** and wait for deploy. Open the **`.onrender.com`** URL.

Render sets `PORT` automatically; the server already uses `process.env.PORT`.

Optional: **New → Blueprint** → paste this repo URL and use `render.yaml` if present; you still must set `ANTHROPIC_API_KEY` in the service **Environment** tab (`sync: false` means not stored in the file).

**Note:** Free web services spin down when idle; first request after idle can be slow. Anyone with the URL can use your API key unless you add auth later.
