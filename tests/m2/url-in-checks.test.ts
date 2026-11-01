/**
 * A web address is not prose (WS-A full run, 报告 v2): the appendix line about a page that timed out carries its address,
 * whose URL-encoded Chinese ("%E6%96%BD%E5%B7%A5…") the self-check read as the leaked evidence keys E5–E8, and the
 * report stayed a draft. Addresses are taken out before the checks that read keys or numbers. Fixture: that run's lines.
 */
import { describe, expect, it } from 'vitest';
import { numbersIn, stripUrls } from '@/lib/research/number-check';
import { bareNumbers, checkNewLines, checkReportText } from '@/lib/research/selfcheck';

/** 报告 v2, ## 附录：过程记录 (the two lines, shortened only between the addresses). */
const TIMED_OUT = 'http://60.208.61.132:8085/ztb/uploadFile/b28722bc-6af4-4816-afa0-784e0e987e48___%E6%96%BD%E5%B7%A5%E7%9B%91%E7%90%86%E8%AF%84%E6%A0%87%E7%BB%86%E5%88%99.pdf';
const H22 = `- H2-2 的反证：已专门检索一轮（知识库 5 份资料，2 条反驳；搜索「2025 招标 评标办法 价格分 技术分 安全 权重」→ 6 条结果，入库/复用 0 页（另有 4 页打不开），得到 0 条相关证据；跳过：https://218.75.241.163:8081/G2/view-file!viewFilePdf.do?attachId=2c95b18798faa3ad0199603845a66e2b：请求失败（HTTP 404）；${TIMED_OUT}：web request timed out after 30000ms）`;
const ADJUST = '- 计划之外的调整：跳过：C1-Q2 http://cgyx.ccgp.gov.cn/cgyx/pub/proJ/details?projId=74afd121-fcd4-479b-9d29-95197ad442ad：请求失败（HTTP 404）；跳过：C2-Q1 https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?cifrado=QUC1GjXXSiLkydRHJBmbpw%3D%3D&DocumentIdParam=48XPMJxmAeOiAZrm5F1dFi6paQ2N%2BajPTSrC09EfFnyteWLS5xQ3xkoegR%2By6ewtoSBQRyH%2Bnt6aXt6tL5IFR：请求失败（HTTP 404）';

const ISSUED = new Set(Array.from({ length: 60 }, (_, i) => `E${i + 1}`));
const keyFailures = (fs: { code: string; message: string }[]) => fs.filter((f) => f.code === 'unknown_evidence_key' || f.code === 'bare_evidence_key').map((f) => f.message);

describe('a web address in the report', () => {
  it('the old rule read E5–E8 in the encoded address (what kept 报告 v2 a draft)', () => {
    expect(new Set(H22.match(/(?<![A-Za-z0-9])E\d{1,3}(?![A-Za-z0-9])/g))).toEqual(new Set(['E6', 'E5', 'E7', 'E8']));
  });

  it('the whole-report check: no leaked key from the appendix\'s addresses; a bare key in prose is still caught', () => {
    const body = (extra: string) => ['# R 调查报告 v2', '', '## Summary', '- 核心问题：谁决定买？', extra, '', '## 附录：过程记录', H22, ADJUST, ''].join('\n');
    expect(keyFailures(checkReportText(body(''), [], ISSUED))).toEqual([]);
    expect(keyFailures(checkReportText(body('- 一句话答案：IT 决定准入，见 E5。'), [], ISSUED))).toEqual([expect.stringContaining('正文里直接写了 E5，像是没有转成脚注的证据编号')]);
  });

  it('the follow-up check of new lines: neither a key nor a number without source from an address', () => {
    expect(checkNewLines([`- 跳过：${TIMED_OUT}：请求失败`], ISSUED)).toEqual([]);
    expect(checkNewLines(['- 跳过：https://218.75.241.163:8081/G2/view-file!viewFilePdf.do?attachId=2c95b18798faa3ad0199603845a66e2b'], ISSUED)).toEqual([]);
  });

  it('the other ways a key could sit in an address (/E12/, =E3, #E4, %E5) are gone with it', () => {
    for (const u of ['https://example.com/E12/report', 'https://example.com/a?ref=E3', 'https://example.com/a#E4', 'https://example.com/%E5%B7']) {
      expect(stripUrls(`见 ${u}：打不开`)).toBe('见  ：打不开');
      expect(keyFailures(checkNewLines([`- 跳过 ${u}`], ISSUED))).toEqual([]);
    }
  });

  it('numbers: the port, the path and "8081" in an address are not data; a number outside it still is', () => {
    expect(bareNumbers('IT 采购占比见 https://218.75.241.163:8081/G2/view-file')).toEqual([]);
    expect(bareNumbers('IT 采购占 38%，见 https://218.75.241.163:8081/G2/view-file')).toEqual(['38']);
    expect(numbersIn(`支出增长 [^3]（${TIMED_OUT}）`).map((t) => t.raw)).toEqual([]);
    expect(numbersIn('支出增长 12% [^3]，https://example.com/2026/10/report-45').map((t) => t.raw)).toEqual(['12%']);
  });

  it('an address ends at the report\'s own punctuation: what follows is still checked', () => {
    expect(stripUrls(`${TIMED_OUT}：web request timed out`)).toBe(' ：web request timed out');
    expect(stripUrls('（https://a.example/x）E5')).toBe('（ ）E5');
    expect(stripUrls('[原文](https://a.example/x) 之后')).toBe('[原文]( ) 之后');
  });
});
