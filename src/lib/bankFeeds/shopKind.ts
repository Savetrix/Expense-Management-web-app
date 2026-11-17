// SERVER-ONLY. Smart Suggestions, step 3: the kind of business on a bank line
// that came without one ("gas station", "fast food restaurant").
//
// Why: lines from a connected bank carry Plaid's category, and with it step 3
// found the right account for 20 of 20 new vendors. Imported files have no
// category, so the bank text alone decides, and the town name counts too much
// ("BURGER KING TORONTO" looked like "PETRO-CANADA TORONTO"): 10 of 20. With
// this label in the text: 19 of 20, and 9 of 10 on a same-town set (measured
// 17 Nov 2026, src/test/suggestionsSimilarLive.test.ts).
//
// The label only says what kind of shop it is. It never picks the account:
// that still comes from the company's own similar past items. Worked out once
// per line and saved on it (TxnDoc.shopKind). Only the cleaned bank text is
// sent, card numbers already cut to the last 4; nothing is sent with
// Auto-classification Off (similarSync.ts checks that first).
import OpenAI from "openai";

export interface Labeller {
  model: string;
  /** One label per text, same order: null when it can't tell, undefined when there was no usable answer (asked again next time). */
  label(texts: string[]): Promise<(string | null | undefined)[]>;
}

const BATCH = 50;
const PROMPT =
  "For each bank statement line, say what kind of business the payee is, in 2 to 4 plain lowercase words " +
  "(for example: gas station, fast food restaurant, coffee shop, software subscription, office supplies store, airline, " +
  'payroll service, bank transfer). If you can\'t tell, say unknown. Answer JSON {"kinds": [...]} with one entry per line, in the same order.';

/** Keeps a label short and plain; "unknown" or anything odd becomes null. */
export function cleanKind(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const k = raw.toLowerCase().replace(/[^a-z &-]/g, " ").replace(/\s+/g, " ").trim();
  return !k || k === "unknown" || k.split(" ").length > 6 ? null : k;
}

/** The OpenAI labeller on the app's chat model, or null when this server has no key. */
export function openAiLabeller(apiKey = process.env.OPENAI_API_KEY?.trim()): Labeller | null {
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
  return {
    model: `openai:${model}`,
    async label(texts) {
      const out: (string | null | undefined)[] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        const res = await client.chat.completions.create({
          model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: PROMPT },
            { role: "user", content: JSON.stringify(batch) },
          ],
        });
        let kinds: unknown[] = [];
        try {
          const parsed = JSON.parse(res.choices[0]?.message.content ?? "{}");
          if (Array.isArray(parsed.kinds)) kinds = parsed.kinds;
        } catch {
          // An answer we can't read labels nothing in this batch.
        }
        // A list of the wrong length can't be matched to its lines safely.
        out.push(...batch.map((_, n) => (kinds.length === batch.length ? cleanKind(kinds[n]) : undefined)));
      }
      return out;
    },
  };
}
