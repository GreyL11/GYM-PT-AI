// Talks to the Gemini API straight from the browser. No SDK: there is no bundler here, and
// vendoring one into the APK to make a single POST is not worth the megabytes.
//
// This is the only file in the app that knows which model provider is behind the Mind check-in.
// Everything else deals in {role: 'user'|'assistant', content} and does not care — swapping
// provider is this file and nothing else.
//
// The key is stored on the device (store.settings.geminiKey) in plain text, because the call goes
// straight from the phone with no server in between. Use a key with a spend limit on it.

const MODEL = 'gemini-2.5-flash';
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
        generationConfig: { maxOutputTokens: 120, thinkingConfig: { thinkingBudget: 0 } },
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
        generationConfig: { maxOutputTokens: 1, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (res.ok) return { ok: true, message: 'Key works.' };
    return { ok: false, message: await failure(res) };
  } catch (err) {
    // A network-level failure here is almost always no signal, or the phone blocking the request.
    return { ok: false, message: `Could not reach Gemini: ${err.message}` };
  }
}

/** Yields text as it arrives. `messages` is [{role, content}], oldest first. */
export async function* talk(apiKey, messages, signal) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: headers(apiKey),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: toContents(messages),
      generationConfig: {
        maxOutputTokens: 1024,
        // Thinking buys a silent pause before the first word streams — wrong trade for a chat.
        // 2.5 Flash is the tier that lets you turn it off outright.
        thinkingConfig: { thinkingBudget: 0 },
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
