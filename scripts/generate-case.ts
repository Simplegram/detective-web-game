/**
 * AI case generator — designs a solvable, airtight murder-mystery case via an
 * LLM (backwards from the truth), validates it with a strict schema, and
 * writes it to data/cases/[slug].json. New files are picked up automatically
 * by the case registry (data/cases/index.ts).
 *
 * Usage:
 *   npm run case:generate -- --theme="1920s Nile Cruise" --difficulty="Medium"
 *   npm run case:generate        (interactive prompts via readline)
 *
 * LLM selection: a real OPENAI_API_KEY (not "sk-dummy…") → OpenAI cloud
 * (model: GENERATOR_LLM_MODEL, default gpt-4o-mini). Otherwise the local
 * OpenAI-compatible endpoint LOCAL_LLM_BASE_URL (default
 * https://chatapi.hglooweb.com/v1) — reasoning-model `think` blocks are
 * stripped before JSON parsing, so DeepSeek-R1 / QwQ-style models work.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";

const DEFAULT_LOCAL_BASE_URL = "https://chatapi.hglooweb.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const LLM_TIMEOUT_MS = 300_000;
const MAX_ATTEMPTS = 2; // initial + one auto-repair retry

// ---------------------------------------------------------------------------
// Strict schema for generated case JSON
// ---------------------------------------------------------------------------

const DOC_ID = /^doc-[1-6]$/;

const documentSchema = z.object({
  id: z.string().regex(DOC_ID, "document ids must be doc-1 … doc-6"),
  title: z.string().min(3),
  category: z.enum(["forensic", "interrogation", "evidence", "timeline"]),
  fileNumber: z.string().min(2),
  classification: z.enum(["CONFIDENTIAL", "UNRESTRICTED"]),
  content: z.string().min(80, "document body too short to play"),
  initialStage: z.number().int().min(1).max(3),
});

const rubricSchema = z.object({
  targetCulprit: z.string().optional(),
  criticalContradiction: z.string().min(10),
  requiredClueIds: z.array(z.string().regex(DOC_ID)).min(1),
  acceptedKeywords: z.array(z.string().min(2)).min(5).max(10),
});

const stageSchema = z.object({
  stageNumber: z.number().int().min(1).max(3),
  title: z.string().min(3),
  objective: z.string().min(10),
  description: z.string().min(10),
  unlocksEvidenceIds: z.array(z.string().regex(DOC_ID)),
  verificationRubric: rubricSchema,
});

const generatedCaseSchema = z
  .object({
    id: z.string().min(2),
    title: z.string().min(3),
    synopsis: z.string().min(20),
    difficulty: z.enum(["Easy", "Medium", "Hard"]),
    estimatedMinutes: z.number().int().min(20).max(90),
    tags: z.array(z.string().min(2)).min(2).max(6),
    victim: z.object({
      name: z.string().min(2),
      age: z.number().int().min(16).max(100),
      occupation: z.string().min(2),
      description: z.string().optional(),
      photoUrl: z.string().optional(),
    }),
    suspects: z
      .array(z.object({ name: z.string().min(2), role: z.string().min(2) }))
      .length(3, "exactly 3 suspects"),
    documents: z.array(documentSchema).length(6, "exactly 6 documents"),
    stages: z.array(stageSchema).min(2).max(3),
  })
  .superRefine((c, ctx) => {
    const docIds = new Set(c.documents.map((d) => d.id));
    for (const expected of ["doc-1", "doc-2", "doc-3", "doc-4", "doc-5", "doc-6"]) {
      if (!docIds.has(expected)) {
        ctx.addIssue({ code: "custom", message: `missing document ${expected}` });
      }
    }
    for (const d of c.documents) {
      if (d.initialStage > c.stages.length) {
        ctx.addIssue({
          code: "custom",
          message: `${d.id} initialStage ${d.initialStage} exceeds stage count`,
        });
      }
    }
    for (let i = 0; i < c.stages.length; i++) {
      const s = c.stages[i];
      if (s.stageNumber !== i + 1) {
        ctx.addIssue({ code: "custom", message: `stage numbers must be 1..${c.stages.length} in order` });
        break;
      }
      for (const id of [...s.unlocksEvidenceIds, ...s.verificationRubric.requiredClueIds]) {
        if (!docIds.has(id)) {
          ctx.addIssue({ code: "custom", message: `${s.stageNumber}: unknown document id ${id}` });
        }
      }
    }
    const suspectNames = new Set(c.suspects.map((s) => s.name));
    const finalStage = c.stages[c.stages.length - 1];
    if (!finalStage.verificationRubric.targetCulprit) {
      ctx.addIssue({ code: "custom", message: "final stage rubric must name targetCulprit" });
    } else if (!suspectNames.has(finalStage.verificationRubric.targetCulprit)) {
      ctx.addIssue({
        code: "custom",
        message: `targetCulprit "${finalStage.verificationRubric.targetCulprit}" is not one of the suspects`,
      });
    }
  });

// ---------------------------------------------------------------------------
// LLM plumbing
// ---------------------------------------------------------------------------

function makeClient(): { client: OpenAI; model: string; source: string } {
  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  const localBase = (process.env.LOCAL_LLM_BASE_URL ?? "").trim() || DEFAULT_LOCAL_BASE_URL;
  const model = (process.env.GENERATOR_LLM_MODEL ?? "").trim() || DEFAULT_MODEL;
  const useCloud = key.length > 0 && !key.startsWith("sk-dummy");
  const client = new OpenAI({
    apiKey: useCloud ? key : "local",
    baseURL: useCloud ? undefined : localBase,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: 0,
  });
  return { client, model, source: useCloud ? "OpenAI cloud" : `local (${localBase})` };
}

const SYSTEM_PROMPT = `You are a master mystery novelist and logic puzzle designer.
Design a solvable, airtight murder mystery case.

Follow this mandatory backwards construction procedure:
1. THE CRIME & TRUTH: Choose the killer, the true motive, the precise time of death (TOD), the weapon/poison, and the exact sequence of events.
2. THE FATAL CONTRADICTION: Create ONE concrete, mathematically or physically irrefutable clash between two pieces of evidence (e.g., train logs vs. witness statement, tide tables vs. footprints, photo reflection vs. clock chime).
3. THE SUSPECTS & RED HERRINGS: Create 3 suspects. Give the innocent suspects suspicious behavior that is fully explainable by secondary evidence.
4. STAGES:
   - Stage 1: Break an Alibi / Expose a False Timeline.
   - Stage 2: Name the True Culprit, Method, and Motive.
5. EVIDENCE (Exactly 6 Documents):
   - doc-1: Coroner / Forensic / Autopsy Report.
   - doc-2: Suspect A Interrogation transcript.
   - doc-3: Suspect B Interrogation transcript.
   - doc-4: Physical / Technical record (dispatch log, ticket, phone tolls, weather record, bank ledger).
   - doc-5: Crime Scene / Butler / Witness record.
   - doc-6: Sealed Evidence (Stage 2 unlock) revealing the smoking gun.

OUTPUT STRICT JSON ONLY MATCHING THE GIVEN SCHEMA. No prose, no markdown fences.
Ensure all requiredClueIds and unlocksEvidenceIds match actual document IDs (doc-1 to doc-6).
Ensure both stages include acceptedKeywords (5-10 terms) for deterministic offline evaluation.
Stage 2's verificationRubric.targetCulprit must be the exact name of one suspect.`;

function userPrompt(theme: string, difficulty: string, slug: string): string {
  return `CASE PARAMETERS (already decided — do not change them):
- "id": "${slug}"
- Theme / setting: ${theme}
- "difficulty": "${difficulty}"

Write the complete case JSON now.
- "title": a punchy case title evoking the theme.
- "synopsis": 2-3 sentences, present-tense hook.
- "estimatedMinutes": a plausible playtime (30-60).
- "tags": 3-5 short genre tags.
- "victim": name, age, occupation, and a one-sentence dossier description.
- Document fileNumbers: plausible bureau codes (e.g. CR-3301, INT-3302, LDR-3304).
- Document "content": each 150-400 words of typed period-appropriate report text (markdown allowed), rich enough to play; doc-6 is the sealed smoking gun.
- "initialStage": 1 for doc-1…doc-5, 2 for doc-6.
- Stage 1 "unlocksEvidenceIds": []; Stage 2 "unlocksEvidenceIds": ["doc-6"].
- Stage 2 rubric "targetCulprit": the exact killer name.`;
}

/** Strip reasoning-model think blocks, unwrap code fences, extract JSON leniently. */
function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(new RegExp("<" + "think" + "[\\s\\S]*?<" + "/think" + ">", "gi"), "")
    .trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in LLM response");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

async function generateCase(client: OpenAI, model: string, theme: string, difficulty: string, slug: string) {
  let feedback = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Stream so tokens flow immediately: a long non-streaming completion on the
    // 27B model goes idle for 100s+ and Cloudflare kills the tunnel (524); the
    // sudden socket drop then trips a libuv assertion on Windows.
    const stream = await client.chat.completions.create({
      model,
      temperature: 0.8,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: userPrompt(theme, difficulty, slug) + (feedback ? `\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${feedback}\nFix every error and output the corrected JSON only.` : ""),
        },
      ],
    });
    let fullContent = "";
    let chunkCount = 0;
    process.stdout.write(`⚡ Attempt ${attempt}/${MAX_ATTEMPTS} — streaming: `);
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (!delta) continue;
      fullContent += delta;
      chunkCount++;
      if (chunkCount % 25 === 0) process.stdout.write(".");
    }
    console.log(`\n✔ Generation complete (~${chunkCount} chunks).`);
    if (!fullContent.trim()) throw new Error("empty completion from LLM");

    const parsed = extractJson(fullContent);
    const result = generatedCaseSchema.safeParse(parsed);
    if (result.success) return result.data;

    const issues = result.error.issues
      .map((i) => `- ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`Validation failed (attempt ${attempt}/${MAX_ATTEMPTS}):\n${issues}`);
    feedback = issues;
    if (attempt === MAX_ATTEMPTS) {
      throw new Error("LLM output failed schema validation after auto-repair retry");
    }
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { theme?: string; difficulty?: string } {
  const out: { theme?: string; difficulty?: string } = {};
  for (const arg of argv) {
    const m = arg.match(/^--(theme|difficulty|model)=(.+)$/);
    if (!m) continue;
    if (m[1] === "theme") out.theme = m[2].trim();
    else if (m[1] === "difficulty") out.difficulty = m[2].trim();
    else if (m[1] === "model") process.env.GENERATOR_LLM_MODEL = m[2].trim();
  }
  return out;
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "untitled-case"
  );
}

async function askIfMissing(theme: string | undefined, difficulty: string | undefined) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let t = theme?.trim();
  let d = difficulty?.trim();
  if (!t) {
    const presets = [
      "1920s Nile river cruise",
      "1930s big-city jazz club",
      "1890s lighthouse keeper's cottage",
      "1960s film noir detective office",
      "feudal castle during a harvest festival",
    ];
    console.log("\nNo theme given. Presets (type a number, or your own theme):");
    presets.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    t = (await rl.question("Theme: ")).trim() || presets[0];
    if (/^\d+$/.test(t) && +t >= 1 && +t <= presets.length) t = presets[+t - 1];
  }
  if (!d) {
    d = (await rl.question('Difficulty (Easy/Medium/Hard, default Medium): ')).trim() || "Medium";
  }
  rl.close();
  return { theme: t, difficulty: d };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { theme, difficulty } = await askIfMissing(args.theme, args.difficulty);
  const { client, model, source } = makeClient();
  const slug = slugify(theme);
  const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "cases", `${slug}.json`);

  console.log(`\n🎲 Generating "${theme}" (${difficulty}) via ${source} · model ${model}`);
  const data = await generateCase(client, model, theme, difficulty, slug);

  // The LLM must not re-invent the mandated id/theme/difficulty.
  data.id = slug;
  data.difficulty = (difficulty as "Easy" | "Medium" | "Hard") ?? data.difficulty;
  const revalidated = generatedCaseSchema.safeParse(data);
  if (!revalidated.success) {
    throw new Error(`post-fix validation failed: ${revalidated.error.issues[0]?.message}`);
  }

  if (existsSync(outPath)) console.warn(`⚠ overwriting existing case file: ${outPath}`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(revalidated.data, null, 2) + "\n", "utf8");

  const culprit = data.stages[data.stages.length - 1].verificationRubric.targetCulprit ?? "???";
  const contradiction = data.stages[0].verificationRubric.criticalContradiction;
  console.log(`
📁 Generated: data/cases/${slug}.json
🕵️ Case Title: ${data.title}
💀 Victim: ${data.victim.name} (${data.victim.occupation})
🔪 Culprit: ${culprit}
🧩 Core Contradiction: ${contradiction}
✔ Verified schema: Ready to play immediately!
`);
}

main().catch((err) => {
  // Deliberately no process.exit(): letting the event loop drain cleanly avoids
  // libuv UV_HANDLE_CLOSING assertions on Windows after a dropped socket.
  console.error(`\n✖ Case generation failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});