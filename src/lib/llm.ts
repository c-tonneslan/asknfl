// Single choke-point for LLM calls, so the provider is one import to swap.
// Currently Groq's free tier via its OpenAI-compatible endpoint; point BASE_URL
// + MODEL at any OpenAI-shaped API (Groq, Together, OpenRouter, local vLLM,
// or api.openai.com itself) without touching the routes.

import OpenAI from "openai";

const BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

export interface ChatUsage {
  input: number;
  output: number;
  cache: number;
}

export interface ChatResult {
  text: string;
  usage: ChatUsage;
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export function modelName(): string {
  return MODEL;
}

export async function chat(opts: {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}): Promise<ChatResult> {
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: BASE_URL,
  });

  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: opts.maxTokens,
    // Deterministic by default — text-to-SQL wants the same query every time.
    temperature: opts.temperature ?? 0,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });

  const text = res.choices[0]?.message?.content ?? "";
  return {
    text: text.trim(),
    usage: {
      input: res.usage?.prompt_tokens ?? 0,
      output: res.usage?.completion_tokens ?? 0,
      cache: 0,
    },
  };
}
