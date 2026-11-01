/**
 * Structured model calls for the orchestrated steps. The model only returns
 * JSON that a zod schema accepts; anything else is retried once with the error
 * fed back, then fails loudly. The call asks for JSON mode (`response_format: json_object`,
 * which DeepSeek's chat API honours: syntactically valid JSON); the shape is still checked by
 * the schema here, and a text that is not JSON is still parsed leniently.
 */
import { DEFAULT_TEMPERATURE } from '@/lib/config/models';
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import type { z } from 'zod';

/** Room for the model's reasoning and a long Chinese answer (a reasoning model spends more than half on thinking). */
export const MAX_OUTPUT_TOKENS = 16_000;

export class LlmJsonError extends Error {
  name = 'LlmJsonError';
}

/**
 * The answer was cut off at the output limit (finish_reason = length) and does not parse. Asking the same thing
 * again hits the same limit (C1, full run: twice), so it is thrown at once; the caller asks for less per call.
 */
export class LlmTruncatedError extends LlmJsonError {
  name = 'LlmTruncatedError';
}

/** The model did not answer within `timeoutMs` (an attempt of its own, not the caller's abort). */
export class LlmTimeoutError extends Error {
  name = 'LlmTimeoutError';
}

/** First balanced top-level JSON object/array in `text` (tolerates ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.search(/[{[]/);
  if (start < 0) throw new LlmJsonError('no JSON found in the model output');
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      try {
        return parseLenient(src.slice(start, i + 1));
      } catch {
        break; // the balance count was thrown off by a stray quote: fall through to the whole text
      }
    }
  }
  // the balance count can be thrown off by a stray quote inside a string: try the repaired text as a whole
  const tail = src.slice(start);
  const end = tail.lastIndexOf(close);
  if (end > 0) {
    try {
      return parseLenient(tail.slice(0, end + 1));
    } catch (e) {
      throw new LlmJsonError(e instanceof Error ? e.message : String(e));
    }
  }
  throw new LlmJsonError('unterminated JSON in the model output');
}

/** `text` with the brackets it left open closed, innermost first; text that ends inside a string is returned as it is. */
export function closeOpenBrackets(text: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop();
  }
  return inStr ? text : text + stack.reverse().join('');
}

/**
 * `extractJson`, and for an answer that was NOT cut off at the output limit one more try with the brackets it left
 * open closed: a long Chinese answer in JSON mode sometimes ends one closing bracket short (the patch call of the
 * workplan decomposition, 3 of 3). A cut-off answer is never repaired: closing it would hand back partial data.
 */
export function extractJsonClosing(text: string, cutOff: boolean): unknown {
  try {
    return extractJson(text);
  } catch (e) {
    if (cutOff) throw e;
    try {
      return extractJson(closeOpenBrackets(text));
    } catch {
      throw e;
    }
  }
}

/**
 * JSON.parse, and on failure one repair: a `"` inside a string that is not followed by `,` `}` `]` or `:` is the
 * model quoting a word ("推断") without escaping it, the most common way a long Chinese answer breaks (live run
 * 10/25: the summary with its recommendation failed twice at the same kind of spot).
 */
export function parseLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (first) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') {
          const next = /\S/.exec(text.slice(i + 1))?.[0];
          if (next !== undefined && !',}]:'.includes(next)) {
            out += '\\"';
            continue;
          }
          inStr = false;
        } else if (ch === '\n') {
          out += '\\n';
          continue;
        }
      } else if (ch === '"') inStr = true;
      out += ch;
    }
    try {
      return JSON.parse(out);
    } catch {
      throw first;
    }
  }
}

export interface LlmJsonOptions<T> {
  model: LanguageModel;
  /** Short tag for errors / logs, e.g. `extract`. */
  task: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  /** Extra attempts after the first (default 1): for output that is not valid JSON. */
  retries?: number;
  /** Per call: give up on a model call that has not answered within this time (throws LlmTimeoutError). */
  timeoutMs?: number;
  /** The output limit, thinking included (default MAX_OUTPUT_TOKENS). */
  maxOutputTokens?: number;
}

export async function llmJson<T>(opts: LlmJsonOptions<T>): Promise<T> {
  const attempts = (opts.retries ?? 1) + 1;
  const maxOutputTokens = opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS;
  let prompt = opts.prompt;
  let lastError = '';
  for (let i = 0; i < attempts; i++) {
    const timeout = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined;
    const signal = timeout ? (opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout) : opts.signal;
    let text: string;
    let finish = '';
    try {
      const r = await generateText({ model: opts.model, system: opts.system, prompt, temperature: DEFAULT_TEMPERATURE, abortSignal: signal, output: Output.json(), maxOutputTokens });
      text = r.text;
      finish = r.finishReason;
    } catch (e) {
      // JSON mode answered something the SDK could not parse: it is still text we can try to read
      if (NoObjectGeneratedError.isInstance(e) && typeof e.text === 'string') {
        text = e.text;
        finish = e.finishReason ?? '';
      } else {
      // our own timer fired (and the caller did not abort): a timeout, not a cancellation
        if (timeout?.aborted && !opts.signal?.aborted) throw new LlmTimeoutError(`${opts.task}: no answer within ${opts.timeoutMs} ms`);
        throw e;
      }
    }
    try {
      const parsed = opts.schema.safeParse(extractJsonClosing(text, finish === 'length'));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`).join('; ');
      if (finish === 'length') throw new LlmTruncatedError(`${opts.task}: 输出到了长度上限（${maxOutputTokens} tokens，含模型思考）被截断（${lastError}）`);
    } catch (e) {
      if (e instanceof LlmTruncatedError) throw e;
      if (e instanceof Error && e.name === 'AbortError') throw e;
      lastError = e instanceof Error ? e.message : String(e);
      if (finish === 'length') throw new LlmTruncatedError(`${opts.task}: 输出到了长度上限（${maxOutputTokens} tokens，含模型思考）被截断，JSON 不完整（${lastError}）`);
      // show where it broke (the next attempt is told, and the log keeps it for diagnosis)
      const at = /position (\d+)/.exec(lastError);
      if (at) lastError += `；出错位置附近：${JSON.stringify(text.slice(Math.max(0, Number(at[1]) - 40), Number(at[1]) + 20))}`;
    }
    prompt = `${opts.prompt}\n\n上一次的输出不合格：${lastError}\n请只输出符合要求的 JSON，不要任何其他文字。`;
  }
  throw new LlmJsonError(`${opts.task}: model did not return valid JSON (${lastError})`);
}
