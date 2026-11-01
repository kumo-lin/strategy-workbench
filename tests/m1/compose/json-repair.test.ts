/** A long answer in JSON mode sometimes ends one closing bracket short (seen on the patch call, 3 of 3); the reader closes it. */
import { describe, expect, it } from 'vitest';
import { closeOpenBrackets, extractJsonClosing } from '@/lib/research/llm';

describe('closeOpenBrackets', () => {
  it('closes what is left open, innermost first', () => {
    expect(closeOpenBrackets('{"a":{"b":[1,2')).toBe('{"a":{"b":[1,2]}}');
  });
  it('ignores brackets inside strings and leaves text that ends inside a string alone', () => {
    expect(closeOpenBrackets('{"a":"x}]"')).toBe('{"a":"x}]"}');
    expect(closeOpenBrackets('{"a":"abc')).toBe('{"a":"abc');
  });
});

describe('extractJsonClosing', () => {
  const lost = '{"node":{"question":"问","hypothesis":{"short":"短"}}';
  it('reads an object that lost its final brace', () => {
    expect(extractJsonClosing(lost, false)).toEqual({ node: { question: '问', hypothesis: { short: '短' } } });
  });
  it('never repairs an answer that was cut off at the limit', () => {
    expect(() => extractJsonClosing(lost, true)).toThrow();
  });
  it('still rejects text that is not JSON at all', () => {
    expect(() => extractJsonClosing('没有 JSON', false)).toThrow();
  });
});
