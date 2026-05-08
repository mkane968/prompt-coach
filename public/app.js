/**
 * Prompt Quality Coach — chat requests use `/api/chat/completions` on this origin.
 */

/** Same-origin proxy path (see server.js). */
const DEFAULT_ENDPOINT = "/api/chat/completions";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
/** Strong band starts at 75 — answers unlock at or above this score. */
const ANSWER_UNLOCK_MIN_PERCENT = 75;

/** Aligns with FounderSignal-style bands: Strong ≥75, Moderate 45–74, Weak &lt;45 */
function strengthBand(percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  if (p >= 75) {
    return { label: "Strong", labelColor: "#15803d", markerColor: "#15803d", pct: p };
  }
  if (p >= 45) {
    return { label: "Moderate", labelColor: "#b45309", markerColor: "#b45309", pct: p };
  }
  return { label: "Weak", labelColor: "#b91c1c", markerColor: "#b91c1c", pct: p };
}

const SYSTEM_PROMPT = `You are a "prompt quality coach." The user will paste a question or prompt they might send to an AI or an expert.

Your job is NOT to answer their underlying question or solve their problem. Never give the factual answer, tutorial steps, diagnosis, or completed task they are asking for.

First, output EXACTLY one block of metadata in this exact format (five lines between the delimiters, values on one line each):

<<<META
overall_percent: <integer 0-100 only — holistic question quality for getting a useful reply>
specificity: <low | medium | high> — <6 words max why>
expertise: <layperson | student | practitioner | researcher | unclear>
ai_fit: <low | medium | high> — <6 words max why>
better_ask: <who or what channel in ~12 words>
>>>

Then a blank line, then your detailed feedback in markdown.

Cover in the markdown:

1. **Specificity** — Goal clarity, missing context (constraints, audience, deadline).
2. **Expertise level** — Whether wording matches the implied depth; gaps.
3. **Fit for AI** — Training limits, private data, tools, human judgment, regulation.
4. **Better audience** — Role or resource (expand on META line if needed).
5. **Wording** — One or two revised phrasings that preserve intent.

Use ### headings in title case for those five sections. Tone: direct, constructive, concise.

End with: **Remember:** I did not answer your topic — only how you asked.

If the input is not a question or request, still output the META block with best-effort guesses, then explain briefly.`;

function $(id) {
  return document.getElementById(id);
}

/**
 * @returns {{ meta: Record<string, string> | null, body: string }}
 */
function splitMetaAndBody(text) {
  const re = /<<<META\s*([\s\S]*?)\s*>>>/;
  const m = text.match(re);
  if (!m) return { meta: null, body: text.trim() };

  const lines = m[1]
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const meta = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val;
  }

  if (meta.overall_percent != null) {
    const n = parseInt(String(meta.overall_percent).replace(/\D/g, ""), 10);
    meta.overall_percent_num = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  }

  const body = text.replace(re, "").trim();
  return { meta, body };
}

async function requestFeedback(userMessage) {
  return chatCompletion(SYSTEM_PROMPT, userMessage, 0.5);
}

const ANSWER_SYSTEM = `You are a helpful assistant. The user's prompt has already been rated as clear and strong enough to answer directly.

Answer thoroughly and practically. If critical context is still missing, give your best answer and briefly note what would make it more precise.`;

async function chatCompletion(systemPrompt, userMessage, temperature = 0.6) {
  const body = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature,
  };

  const res = await fetch(DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `HTTP ${res.status}: ${res.statusText || "request failed"}`;
    throw new Error(msg);
  }

  const choice = data.choices?.[0]?.message?.content;
  if (!choice) {
    throw new Error("Something went wrong reading the response. Try again.");
  }

  return choice.trim();
}

function setLoading(loading) {
  const btn = $("submitBtn");
  const out = $("output");
  btn.disabled = loading;
  if (loading) {
    out.classList.add("loading");
    out.classList.remove("error");
    out.textContent = "Analyzing how you asked…";
  }
}

function updateMetaFromParsed(meta) {
  $("metaSpec").textContent = meta?.specificity ?? "—";
  $("metaExp").textContent = meta?.expertise ?? "—";
  $("metaAi").textContent = meta?.ai_fit ?? "—";
  $("metaAsk").textContent = meta?.better_ask ?? "—";
}

function renderStrengthMeter(percentNum, threshold) {
  const panel = $("strengthMeter");
  const meterEl = panel?.querySelector(".strength-meter");
  const gateHint = $("gateHint");
  const answerPanel = $("answerPanel");
  const lockedLine = $("lockedLine");

  if (percentNum == null || Number.isNaN(percentNum)) {
    panel.hidden = true;
    gateHint.textContent =
      "No score was returned — see the feedback below and try again.";
    lockedLine.hidden = false;
    answerPanel.hidden = true;
    $("answerOutput").innerHTML = "";
    return { unlocked: false, percent: null };
  }

  panel.hidden = false;
  const band = strengthBand(percentNum);
  if (meterEl) {
    meterEl.style.setProperty("--meter-pct", String(band.pct));
    meterEl.style.setProperty("--marker-color", band.markerColor);
    meterEl.setAttribute("aria-label", `${band.pct} percent, ${band.label}`);
  }
  $("strengthPct").textContent = `${band.pct}%`;
  $("strengthPct").style.color = band.labelColor;
  $("strengthLabel").textContent = band.label;
  $("strengthLabel").style.color = band.labelColor;

  const unlocked = band.pct >= threshold;
  if (unlocked) {
    gateHint.textContent = "Strong enough — here’s a direct answer below.";
    lockedLine.hidden = true;
  } else {
    gateHint.textContent = `Keep sharpening your prompt — you’re at ${band.pct}% (${band.label}). Reach Strong to see a direct answer below.`;
    lockedLine.hidden = false;
    answerPanel.hidden = true;
    $("answerOutput").innerHTML = "";
  }

  return { unlocked, percent: band.pct };
}

function init() {
  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("question").value.trim();
    if (!q) {
      $("output").textContent = "Paste or type a prompt first.";
      $("output").classList.add("error");
      return;
    }

    const threshold = ANSWER_UNLOCK_MIN_PERCENT;
    setLoading(true);
    updateMetaFromParsed(null);
    $("strengthMeter").hidden = true;
    $("lockedLine").hidden = true;
    $("answerPanel").hidden = true;
    $("answerOutput").innerHTML = "";
    $("gateHint").textContent = "";

    try {
      const raw = await requestFeedback(q);
      const { meta, body } = splitMetaAndBody(raw);
      $("output").classList.remove("loading", "error");
      $("output").innerHTML = renderMarkdownLite(body || raw);

      updateMetaFromParsed(meta);

      const pct = meta?.overall_percent_num ?? null;
      const { unlocked } = renderStrengthMeter(pct, threshold);

      if (unlocked && pct != null) {
        $("answerPanel").hidden = false;
        $("answerOutput").classList.remove("error");
        $("answerOutput").classList.add("loading");
        $("answerOutput").textContent = "Generating answer…";
        try {
          const answerText = await chatCompletion(ANSWER_SYSTEM, q, 0.55);
          $("answerOutput").classList.remove("loading");
          $("answerOutput").innerHTML = renderMarkdownLite(answerText);
        } catch (ansErr) {
          $("answerOutput").classList.remove("loading");
          $("answerOutput").classList.add("error");
          $("answerOutput").textContent = String(ansErr.message || ansErr);
        }
      }
    } catch (err) {
      $("output").classList.remove("loading");
      $("output").classList.add("error");
      $("output").textContent = String(err.message || err);
      $("strengthMeter").hidden = true;
      $("gateHint").textContent = "";
    } finally {
      setLoading(false);
    }
  });
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineBold(s) {
  return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** Title case for headings (minor words lowercased when not first/last). */
const TITLE_MINOR = new Set(
  "a an the and but or nor for on at to from by of in as is vs via per if en".split(" ")
);

function toTitleCase(str) {
  const words = str.trim().split(/\s+/);
  if (words.length === 0) return str;
  const last = words.length - 1;
  return words
    .map((word, i) => {
      const letters = word.replace(/[^a-zA-Z]/g, "");
      if (letters.length >= 2 && letters === letters.toUpperCase() && letters.length <= 6) {
        return word;
      }
      const core = word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
      if (i !== 0 && i !== last && TITLE_MINOR.has(core)) {
        return word.toLowerCase();
      }
      const m = word.match(/^([^a-zA-Z]*)([a-zA-Z])([\s\S]*)$/);
      if (!m) return word;
      return m[1] + m[2].toUpperCase() + m[3].toLowerCase();
    })
    .join(" ");
}

/** Small markdown subset: ### headings, **bold**, - lists, paragraphs */
function renderMarkdownLite(md) {
  const blocks = md.trim().split(/\n\n+/);
  const parts = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const first = lines[0];

    if (first.startsWith("### ")) {
      parts.push(`<h3>${inlineBold(escapeHtml(toTitleCase(first.slice(4))))}</h3>`);
      if (lines.length > 1) {
        const rest = escapeHtml(lines.slice(1).join("\n"));
        parts.push(`<p>${inlineBold(rest).replace(/\n/g, "<br>")}</p>`);
      }
      continue;
    }

    if (first.startsWith("## ")) {
      parts.push(`<h2>${inlineBold(escapeHtml(toTitleCase(first.slice(3))))}</h2>`);
      continue;
    }

    if (lines.length && lines.every((l) => l.startsWith("- "))) {
      const lis = lines.map((l) => `<li>${inlineBold(escapeHtml(l.slice(2)))}</li>`).join("");
      parts.push(`<ul>${lis}</ul>`);
      continue;
    }

    const para = escapeHtml(lines.join("\n"));
    parts.push(`<p>${inlineBold(para).replace(/\n/g, "<br>")}</p>`);
  }

  return parts.join("");
}

document.addEventListener("DOMContentLoaded", init);
