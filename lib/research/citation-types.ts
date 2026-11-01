/** What the report viewer shows when a citation is clicked (PRD §6.3 步骤 6, §9.7). Pure types — client-safe. */
export interface CitationDetail {
  /** The wikilink as written in the report, e.g. `[[资料名#^c1]]`. */
  link: string;
  /** Block exists (and the quote, when one preceded the link, matches). */
  ok: boolean;
  error?: 'note_not_found' | 'ambiguous' | 'block_not_found' | 'quote_mismatch';
  sourceName: string;
  sourcePath: string | null;
  blockId: string;
  /** The stored claim line, e.g. `「原文」— 位置：p.12`. */
  blockText: string | null;
  /** Quote written before the link in the report, if any. */
  quote: string | null;
  grade: 'A' | 'B' | 'C' | null;
  gradedBy: 'AI' | '人' | null;
  /** `知识库` = 预置资料；`网络` = 联网抓取入库。 */
  origin: '知识库' | '网络' | '专家访谈' | null;
  /** Expert interview that was simulated (simulated: true): a challenge or a lead, not evidence, not an A/B source. */
  simulated?: boolean;
  /** The source note says it is unverified (reliability), or it sits on a user-upload document platform. */
  unverified?: boolean;
  userUpload?: boolean;
  publisher: string | null;
  url: string | null;
  published: string | null;
}

/** A citation of a simulated expert interview (knowledge / expert-input, simulated: true): marked "（模拟）" wherever it is shown. */
export function isSimulatedInterview(c: Pick<CitationDetail, 'origin' | 'simulated'> | null | undefined): boolean {
  return Boolean(c && c.origin === '专家访谈' && c.simulated === true);
}

/** "A 级 · 知识库" / "B 级 · 网络 · AI 定级". */
export function describeSource(c: Pick<CitationDetail, 'grade' | 'origin' | 'gradedBy'> & { simulated?: boolean; unverified?: boolean; userUpload?: boolean }): string {
  if (c.origin === '专家访谈') return c.simulated ? '专家意见 · 模拟访谈（不计入 A/B 级来源）' : '专家意见 · 按 C 级计';
  const parts = [c.grade ? `${c.grade} 级` : '未定级'];
  if (c.origin) parts.push(c.origin === '知识库' ? '知识库' : `网络 · ${c.gradedBy === '人' ? '人工定级' : 'AI 定级'}`);
  if (c.userUpload) parts.push('用户上传文档，转述');
  if (c.unverified) parts.push('未核实');
  return parts.join(' · ');
}
