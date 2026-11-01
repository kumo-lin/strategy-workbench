import { describe, expect, it } from 'vitest';
import { searchResponseSchema } from '@/lib/deepseek/web-tools';

describe('searchResponseSchema', () => {
  it('normalizes null fields from the live API instead of failing the whole search', () => {
    const parsed = searchResponseSchema.parse({
      results: [
        { url: 'https://a.example', title: null, site_name: null, site_icon: null, summary: null, rerank_score: null, authority: null },
        { url: 'https://b.example', title: 'B', site_name: 'b', summary: 's', rerank_score: 0.8, authority: 3 },
      ],
    });
    expect(parsed.results[0]).toMatchObject({ title: '', site_name: '', summary: '', rerank_score: 0, authority: 0 });
    expect(parsed.results[1]).toMatchObject({ title: 'B', site_name: 'b', rerank_score: 0.8, authority: 3 });
  });

  it('still rejects a result without a url', () => {
    expect(() => searchResponseSchema.parse({ results: [{ title: 'x' }] })).toThrow();
  });
});
