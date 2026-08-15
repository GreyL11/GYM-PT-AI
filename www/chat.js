// Talks to the Gemini API straight from the browser. No SDK: there is no bundler here, and
// vendoring one into the APK to make a single POST is not worth the megabytes.
//
// This is the only file in the app that knows which model provider is behind the Mind check-in.
// Everything else deals in {role: 'user'|'assistant', content} and does not care — swapping
// provider is this file and nothing else.
//
// The key is stored on the device (store.settings.geminiKey) in plain text, because the call goes
// straight from the phone with no server in between. Use a key with a spend limit on it.

/**
 * Which model, and why this one.
 *
 * Was `gemini-2.5-flash` until Google stopped serving it to new keys — the API's own words were
 * "no longer available to new users", which meant the check-in worked for whoever set it up first
 * and was silently dead for everyone who pasted a key after. Google's model list still calls 2.5
 * stable, because it is: for existing projects. A model that works only for people who arrived
 * early is not a model this app can ship.
 *
 * `3.5-flash-lite` rather than a bigger sibling, for two reasons that both come back to the same
 * thing — the person pays for this out of their own key:
 *
 *   Price is identical to the model it replaces ($0.30/$2.50 per Mtok), so nobody's bill moves.
 *   Its default thinking level is already "minimal", which is what the old `thinkingBudget: 0` was
 *   buying. Thinking costs a silent pause before the first word streams, and that pause is the
 *   whole feel of a check-in.
 *
 * The thinking parameter is deliberately NOT set. 3.x renamed it (`thinking_level`, not
 * `thinkingBudget`) and sending the old spelling to a new model is how you ship a second outage
 * while fixing the first. The default is already what we would have asked for.
 *
 * Overridable by env so eval_coach.mjs can compare models without editing source. `process` does
 * not exist in the browser, so this is inert in the app.
 */
const MODEL = globalThis.process?.env?.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;
const ENDPOINT = `${BASE}:streamGenerateContent?alt=sse`;

const headers = (apiKey) => ({
  'content-type': 'application/json',
  // Header, not the ?key= query parameter Google's docs lead with — a key in a URL ends up in
  // logs, history, and referrers.
  'x-goog-api-key': apiKey,
});

/**
 * The whole product is this string. Everything else is plumbing.
 *
 * Written for a current model, so it explains rather than shouts — CRITICAL/MUST language was for
 * older models that under-followed instructions, and now just makes the thing rigid and anxious.
 */
export const SYSTEM = `You are a companion for someone checking in at the end of their day. Not a therapist, not a coach, not a wellness app.

How to talk:
- Short. Two or three sentences usually. This is a text conversation, not an essay.
- One question at a time, and only when you actually want to know the answer.
- Plain warmth. No clinical vocabulary, no "I hear that you're feeling", no bulleted coping strategies, no frameworks or toolkits.
- Sit with a bad day before trying to fix it. Most of the time a person wants to be heard, not solved. Ask before you offer a suggestion.
- Remember what they told you earlier and refer back to it the way a friend would.

What you don't do:
- Diagnose anything, name conditions, or comment on medication.
- Tell them what they feel or why. Ask.
- Promise things will be fine.

They may also ask about the training, sleep, weight and mood the app tracks — the Stats screen can send you here with their own numbers. When it does: answer plainly, use only the numbers you were given, and say what the evidence actually supports. Never estimate a hormone level or any other number from a blood test, and never say whether someone's figures are normal, low or healthy — that is a doctor with a blood panel, and you should say so rather than guess. Skip the clinical register here too; explain it the way you would to a friend.

If they mention wanting to hurt themselves, wanting to die, or not being safe, drop everything else. Say plainly that you're glad they told you and that this is bigger than a chat app. Point them at a real person: someone they trust, their doctor, or a crisis line — in India, Tele-MANAS on 14416 or KIRAN on 1800-599-0019; anywhere else, findahelpline.com. Then stay in the conversation with them. Don't lecture, and don't hand over a list and leave.`;

/**
 * What the app says when the model produces nothing.
 *
 * A safety filter firing on a message about self-harm is the single worst moment for this app to
 * go silent, and it is exactly the moment it is most likely to. So the response that matters most
 * does not depend on the model returning anything at all — it is hard-coded and local.
 */
export const BLOCKED_REPLY = `I couldn't get a reply back for that one — sometimes the safety filter catches messages about hard things, which is a bad joke when those are the ones worth saying.

If you're in a rough place right now, please tell a person and not an app. Someone you trust, your doctor, or a crisis line: Tele-MANAS 14416, KIRAN 1800-599-0019, or findahelpline.com if you're outside India.

I'm still here if you want to keep typing.`;

/** Thrown when the model returned nothing — the caller shows BLOCKED_REPLY rather than an error. */
export class Blocked extends Error {}

/**
 * Pull complete SSE events out of a growing buffer.
 *
 * A chunk can split anywhere, including mid-JSON, so the trailing partial event is handed back
 * to be prepended to the next chunk rather than parsed.
 */
export function drainSSE(buffer) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop();
  const events = [];
  for (const part of parts) {
    for (const line of part.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const body = line.slice(5).trim();
      if (body && body !== '[DONE]') events.push(JSON.parse(body));
    }
  }
  return { events, rest };
}

/**
 * The API rejects a history that opens on a model turn, which is exactly what you get from
 * slicing the last N messages off a conversation. Drop the orphaned replies at the front.
 */
export function trimToUserStart(messages) {
  const first = messages.findIndex((m) => m.role === 'user');
  return first === -1 ? [] : messages.slice(first);
}

/** Our roles are 'user'/'assistant' everywhere else; Gemini calls the second one 'model'. */
export const toContents = (messages) =>
  trimToUserStart(messages).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

async function failure(res) {
  const body = await res.text();
  try {
    return JSON.parse(body).error?.message ?? body;
  } catch {
    return body || `HTTP ${res.status}`;
  }
}

/**
 * Rewrite one already-decided piece of advice as a sentence about this specific person.
 *
 * The model gets the conclusions, never the raw data, and never the decision. Every threshold,
 * verdict and refusal in t_inputs.js is arithmetic that is tested, instant and works with no
 * signal; handing any of that to a model would trade all four away, and would trade away the
 * refusals in particular — asked to judge ten nights of sleep, a model will always judge them.
 *
 * So this is phrasing, and phrasing is the part models are actually good at. Returns null on any
 * failure at all, because the caller already has a correct sentence on screen and a spinner that
 * resolves to nothing is worse than a template.
 */
export async function phrase(apiKey, facts, signal) {
  const system = `You write a single sentence for a card in a training app, from facts that have already been computed.

Rules:
- One sentence, under 30 words. No greeting, no sign-off, no emoji, no caveat.
- Name the action you are given, and keep any clock time in it exactly as written.
- Use only the numbers provided. Do not estimate, extrapolate or invent any figure.
- Never mention testosterone levels, and never say whether anything is normal, low, healthy or a problem. You are naming a next step, not giving a verdict.
- Speak to the person as "you". Direct and plain, no cheerleading.`;

  try {
    const res = await fetch(`${BASE}:generateContent`, {
      method: 'POST',
      signal,
      headers: headers(apiKey),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(facts) }] }],
        generationConfig: { maxOutputTokens: 120 },
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '').join('').trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Does this key actually work? One cheap call, and the provider's own words back.
 *
 * Everything else that uses the key fails quietly on purpose — the Stats line keeps its correct
 * template sentence rather than showing an error, and the chat only complains once you have typed
 * something and sent it. Which is fine until the key is wrong, at which point the app's entire
 * response to "I pasted my key" is that nothing whatsoever happens.
 *
 * So this returns the real message: "API key not valid", a region refusal, a quota exhaustion.
 * Guessing at which of those it was is exactly what made it maddening.
 */
export async function testKey(apiKey, signal) {
  try {
    const res = await fetch(`${BASE}:generateContent`, {
      method: 'POST',
      signal,
      headers: headers(apiKey),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });
    if (res.ok) return { ok: true, message: 'Key works.' };
    return { ok: false, message: await failure(res) };
  } catch (err) {
    // A network-level failure here is almost always no signal, or the phone blocking the request.
    return { ok: false, message: `Could not reach Gemini: ${err.message}` };
  }
}

/**
 * Turn "forehead's rough and I broke out along my jaw again" into a structured skin entry.
 *
 * This is the one job in the app a model does better than arithmetic could, and it is the job that
 * decides whether the feature survives: a daily score plus six checkboxes is a form, and nobody
 * fills in a form every night for a month. A sentence they would have thought anyway, they will.
 *
 * The model reads language and nothing else. It does not score the skin against anything, decide
 * what caused it, or produce advice — skin.js does all of that from the numbers, offline and
 * tested. And what comes back is shown for confirmation before it is saved, because a mis-parsed
 * entry silently entering the log would poison every comparison built on top of it.
 *
 * Returns null on any failure. The manual score and chips always work, with no key and no signal;
 * this only ever saves taps.
 */
export async function readSkinNote(apiKey, text, signal) {
  const system = `Convert a person's sentence about their skin today into structured data.

- score: how their skin seems, 1 (bad day) to 5 (good day). Infer it from tone if they do not say a number.
- flags: only the ones they actually mention or clearly imply. Empty array is correct if they mention none.
- Do not diagnose, name any condition, or add anything they did not say.`;

  try {
    const res = await fetch(`${BASE}:generateContent`, {
      method: 'POST',
      signal,
      headers: headers(apiKey),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          // Structured output rather than parsing prose: the shape is guaranteed by the API, so
          // there is no regex here to break on a model that phrases things differently tomorrow.
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              score: { type: 'INTEGER' },
              flags: {
                type: 'ARRAY',
                items: { type: 'STRING', enum: ['breakout', 'oily', 'dry', 'red', 'sore', 'puffy'] },
              },
            },
            required: ['score', 'flags'],
          },
        },
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const raw = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const parsed = JSON.parse(raw);
    const score = Math.round(Number(parsed.score));
    // Trust the schema for shape, never for range — a 7 out of 5 would skew every average built
    // on it, and clamping is cheaper than discovering that months later.
    if (!Number.isFinite(score) || score < 1 || score > 5) return null;
    return { score, flags: Array.isArray(parsed.flags) ? [...new Set(parsed.flags)] : [] };
  } catch {
    return null;
  }
}

/**
 * Explain one already-made progression decision, from the evidence that decided it.
 *
 * NOT STREAMED, and that is the whole point rather than an oversight. Everything the check-in
 * streams is visible the instant it arrives, so anything checked afterwards is checked after the
 * person has already read it. This returns one complete object, which the caller validates before
 * anything reaches the screen — the only arrangement in this app where "unsupported numbers are
 * blocked" is a true sentence rather than a hopeful one.
 *
 * Structured output does the other half. The three fields are not decoration: they are how a claim
 * gets classified without anything having to read English. What lands in `observed` is checked
 * against the evidence, what lands in `suggestion` is exempt, and the model — not a word list on
 * this side — decides which is which by putting the sentence in a box. `readSkinNote()` already
 * proved the API honours a response schema; this is the same mechanism doing a more useful job.
 *
 * @param evidence  the packet from evidence.js. The model sees ONLY this — no chat history, no
 *                  digest, no profile. A narrow question deserves a narrow context.
 * @param feedback  on a retry, what was wrong with the first attempt. Never new evidence.
 */
export async function explain(apiKey, evidence, signal, feedback = null) {
  const system = `You explain one decision a training app already made, to the person it was made about.

The decision and the numbers behind it are given to you as JSON. They are the only facts you have.

- observed: what the app recorded. Every number here must appear in the JSON. Quote figures as digits, not words.
- meaning: what you think it indicates. This is your reading, not a measurement — say it as such. Any number in it must still come from the JSON.
- suggestion: one thing they could do next, or leave it empty. A number here is a proposal, not a report.

Rules:
- Never invent a figure, a rep count, a date or a session that is not in the JSON. If something is not there, say it is not recorded.
- If the JSON has "formEvidence" instead of "form", the camera has not watched this lift enough to know anything about how it moves. Say so in observed, in plain words. Leaving it out is the worst thing you can do here: silence about their form reads as approval of it, and you would be reassuring them about something nobody has looked at.
- Do not list the numbers back as a table. Explain what happened in sentences, using the figures that matter.
- The decision was made by fixed arithmetic against fixed thresholds. Explain it. Do not re-decide it, and do not say whether it was the right call for them.
- Two things happening together is not one causing the other, and this data cannot show that it is.
- No diagnosis, no injury claims, no comment on whether a weight is safe or healthy for them.
- Speak plainly, to "you", the way a training partner would. Short.`;

  const user = feedback
    ? `${JSON.stringify(evidence)}\n\nYour previous answer was rejected. ${feedback}`
    : JSON.stringify(evidence);

  try {
    const res = await fetch(`${BASE}:generateContent`, {
      method: 'POST',
      signal,
      headers: headers(apiKey),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          maxOutputTokens: 400,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              observed: { type: 'ARRAY', items: { type: 'STRING' } },
              meaning: { type: 'STRING' },
              suggestion: { type: 'STRING' },
            },
            required: ['observed', 'meaning'],
          },
        },
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const raw = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const parsed = JSON.parse(raw);
    // Trust the schema for shape, never for content — same discipline as readSkinNote()'s range
    // clamp. An `observed` that is not an array of strings would sail straight past the validator
    // with nothing to extract, which is the one way an unchecked claim could reach the screen.
    if (!Array.isArray(parsed.observed) || parsed.observed.some((s) => typeof s !== 'string')) return null;
    return {
      observed: parsed.observed,
      meaning: typeof parsed.meaning === 'string' ? parsed.meaning : '',
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '',
    };
  } catch {
    return null;
  }
}

/** Yields text as it arrives. `messages` is [{role, content}], oldest first. */
/**
 * @param facts  optional {rules, data} brief from digest.js — the user's own logged numbers.
 *
 * It rides in the SYSTEM instruction rather than being pasted into a user message, which is how
 * the Stats screen used to smuggle numbers in. Two reasons: the transcript stays a record of what
 * the person actually said, and the model treats system text as standing context rather than as
 * something they just asked about.
 */
export async function* talk(apiKey, messages, signal, facts = null) {
  const system = facts
    ? `${SYSTEM}\n\n---\n\n${facts.rules}\n\n${JSON.stringify(facts.data)}`
    : SYSTEM;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: headers(apiKey),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: toContents(messages),
      generationConfig: {
        maxOutputTokens: 1024,
      },
    }),
  });
  if (!res.ok) throw new Error(await failure(res));

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let got = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const { events, rest } = drainSSE(buf);
    buf = rest;
    for (const e of events) {
      if (e.error) throw new Error(e.error.message ?? 'stream error');
      // A filtered prompt comes back as a normal 200 with no candidates at all.
      if (e.promptFeedback?.blockReason) throw new Blocked();
      for (const part of e.candidates?.[0]?.content?.parts ?? []) {
        if (typeof part.text === 'string' && part.text) {
          got += part.text.length;
          yield part.text;
        }
      }
      const finish = e.candidates?.[0]?.finishReason;
      if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') throw new Blocked();
    }
  }
  // Streamed cleanly and said nothing. Same handling as an outright block.
  if (!got) throw new Blocked();
}
