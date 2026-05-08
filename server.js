/**
 * Serves the static UI and proxies Claude (Anthropic Messages API) so the API key stays on the server.
 * The browser POSTs chat-style JSON to `/api/chat/completions`; responses are normalized for the UI.
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");

const DEFAULT_UPSTREAM = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";
const PORT = Number(process.env.PORT) || 3000;

/**
 * Chat-style request body (from the UI) → Anthropic Messages API body.
 * @param {Record<string, unknown>} body
 */
function requestBodyToAnthropic(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemChunks = [];
  const anthropicMessages = [];

  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = m.role;
    const content =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((p) => (p && p.text ? String(p.text) : ""))
              .join("")
          : "";
    if (role === "system") {
      systemChunks.push(content);
      continue;
    }
    if (role === "user" || role === "assistant") {
      anthropicMessages.push({ role, content });
    }
  }

  const maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS);
  const out = {
    model: typeof body.model === "string" ? body.model : "claude-sonnet-4-20250514",
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 8192,
    messages: anthropicMessages.length
      ? anthropicMessages
      : [{ role: "user", content: "" }],
  };

  if (systemChunks.length) {
    out.system = systemChunks.join("\n\n");
  }

  if (typeof body.temperature === "number") {
    out.temperature = body.temperature;
  }

  return out;
}

/**
 * Anthropic Messages response → JSON shape the browser expects (`choices[0].message.content`).
 * @param {Record<string, unknown>} data
 */
function anthropicToBrowserResponse(data) {
  const blocks = Array.isArray(data.content) ? data.content : [];
  let text = "";
  for (const block of blocks) {
    if (block && block.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }
  return {
    id: typeof data.id === "string" ? data.id : "anthropic-msg",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
  };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat/completions", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    res.status(500).json({
      error: {
        message:
          "Server misconfiguration: set ANTHROPIC_API_KEY in .env (see .env.example).",
      },
    });
    return;
  }

  const upstreamUrl = process.env.ANTHROPIC_API_URL || DEFAULT_UPSTREAM;

  try {
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBodyToAnthropic(req.body)),
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: text || "Non-JSON response from upstream" } };
    }

    if (upstream.ok) {
      data = anthropicToBrowserResponse(data);
    } else {
      const msg =
        (data.error && typeof data.error.message === "string" && data.error.message) ||
        (typeof data.message === "string" && data.message) ||
        text.slice(0, 2000);
      data = { error: { message: String(msg) } };
    }

    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({
      error: { message: err.message || "Upstream request failed" },
    });
  }
});

app.listen(PORT, () => {
  console.log(`Prompt Quality Coach at http://localhost:${PORT}`);
  console.log(`Claude (Anthropic) → ${process.env.ANTHROPIC_API_URL || DEFAULT_UPSTREAM}`);
});
