// SERVER-ONLY. Turns text into meaning vectors for Smart Suggestions, step 3
// (similar past items). The provider sits behind this one interface, so it can
// change later: every stored vector carries `model`, and a vector made by a
// different model is simply made again.
//
// Today: OpenAI text-embedding-3-small on the key ScanTrix already uses
// (OPENAI_API_KEY), shortened to 512 numbers per vector, which keeps a
// company's vectors small enough to compare in the app.
import OpenAI from "openai";

export interface Embedder {
  /** Stored on every vector: "openai:text-embedding-3-small@512". */
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMENSIONS = 512;
const BATCH = 100;

/** The OpenAI embedder, or null when this server has no key (step 3 then stays off). */
export function openAiEmbedder(apiKey = process.env.OPENAI_API_KEY?.trim()): Embedder | null {
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey });
  return {
    model: `openai:${EMBED_MODEL}@${EMBED_DIMENSIONS}`,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        const res = await client.embeddings.create({ model: EMBED_MODEL, input: texts.slice(i, i + BATCH), dimensions: EMBED_DIMENSIONS });
        for (const d of [...res.data].sort((a, b) => a.index - b.index)) out.push(d.embedding);
      }
      return out;
    },
  };
}
