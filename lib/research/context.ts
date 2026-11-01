/**
 * Context assembly for Deep Research (PRD §10.2 context 组装): the workplan and
 * hypotheses of this Workspace, the confirmed decisions and exec directives of
 * the project, the method-library skills that apply, and a catalogue of what the
 * vault already holds. Shared by the plan prompt and the execution steps.
 */
import type { ToolContext } from '@/lib/harness/types';
import type { Vault } from '@/lib/vault';
import { confirmedConclusions, ownerOpinions, renderPremises, type Conclusion, type Opinion } from './premises';

export interface ContextNote {
  path: string;
  name: string;
  status: string;
  /** Short statement / first lines of the body. */
  excerpt: string;
}

export interface ResearchContext {
  workplan: (ContextNote & { version: number }) | null;
  hypotheses: ContextNote[];
  decisions: ContextNote[];
  meetings: ContextNote[];
  methods: ContextNote[];
  sources: { path: string; name: string; grade: string; origin: string; publisher: string; claims: number }[];
  /** D-64 T16: the project's confirmed conclusions (premises) and the owner's opinions (direction). */
  conclusions: Conclusion[];
  opinions: Opinion[];
}

const stripFence = (s: string) => s.replace(/```[\s\S]*?```/g, '');

function excerptOf(body: string, max: number): string {
  const text = stripFence(body).replace(/^#.*$/gm, '').replace(/\n{2,}/g, '\n').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** `type`: only notes whose frontmatter says so (a stray note in the folder is not context). */
/**
 * A method note is cut at section boundaries, never inside a step: so what 提炼's step 4 ("推到 Now what") sits
 * near the end of a ~6,000-character note and was cut off by a flat 3,000-character slice.
 */
export function excerptBySections(body: string, max: number): string {
  const text = stripFence(body).replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= max) return text;
  const sections = text.split(/^(?=## )/m);
  let out = '';
  for (const sec of sections) {
    if (out && (out + sec).length > max) break;
    out += sec;
  }
  return out.length > max ? `${out.slice(0, max)}…` : `${out.trimEnd()}\n…（后面的小节略）`;
}

async function notesIn(vault: Vault, dir: string, max: number, excerptChars: number, type?: string, bySections = false): Promise<ContextNote[]> {
  let entries;
  try {
    entries = await vault.list(dir);
  } catch {
    return [];
  }
  const out: ContextNote[] = [];
  for (const e of entries) {
    if (e.kind !== 'file' || out.length >= max) continue;
    try {
      const n = await vault.read(e.path);
      if (type && n.data.type !== type) continue;
      const statement = typeof n.data.statement === 'string' ? n.data.statement : '';
      out.push({
        path: e.path,
        name: e.name.replace(/\.md$/, ''),
        status: String(n.data.status ?? ''),
        excerpt: statement || (bySections ? excerptBySections(n.body, excerptChars) : excerptOf(n.body, excerptChars)),
      });
    } catch {
      /* unreadable note: skip */
    }
  }
  return out;
}

export async function loadResearchContext(ctx: ToolContext, opts: { sources?: boolean } = {}): Promise<ResearchContext> {
  const { vault, workspacePath, projectPath } = ctx;

  let workplan: ResearchContext['workplan'] = null;
  try {
    for (const e of await vault.list(workspacePath)) {
      const m = /^workplan v(\d+)\.md$/.exec(e.name);
      if (e.kind === 'file' && m && (!workplan || Number(m[1]) > workplan.version)) {
        const n = await vault.read(e.path);
        workplan = { path: e.path, name: e.name.replace(/\.md$/, ''), status: String(n.data.status), excerpt: excerptOf(n.body, 2500), version: Number(m[1]) };
      }
    }
  } catch {
    /* no workplan yet */
  }

  const methods = (await notesIn(vault, '00_团队知识/方法库', 12, 8000, undefined, true)).filter((m) => /调查|假设|证据|反证|so what/i.test(m.name));

  const sources: ResearchContext['sources'] = [];
  if (opts.sources !== false) {
    try {
      for (const e of (await vault.list('10_资料库')).slice(0, 60)) {
        if (e.kind !== 'file') continue;
        const n = await vault.read(e.path);
        sources.push({
          path: e.path,
          name: e.name.replace(/\.md$/, ''),
          grade: String(n.data.grade ?? '?'),
          origin: String(n.data.origin ?? '?'),
          publisher: String(n.data.publisher ?? '?'),
          claims: [...(await vault.getBlocks(e.path)).keys()].filter((k) => /^c\d+$/.test(k)).length,
        });
      }
    } catch {
      /* empty library */
    }
  }

  return {
    workplan,
    hypotheses: await notesIn(vault, `${projectPath}/假设`, 20, 300),
    // decisions: only what sits in 决策/ AND says type: decision (5.0 run-through 3.19: a working note was offered as a decision)
    decisions: await notesIn(vault, `${projectPath}/决策`, 15, 500, 'decision'),
    meetings: await notesIn(vault, `${projectPath}/会议`, 8, 900),
    methods,
    sources,
    conclusions: await confirmedConclusions(vault, workspacePath),
    opinions: await ownerOpinions(vault, workspacePath),
  };
}

const list = (notes: ContextNote[], label: (n: ContextNote) => string) => (notes.length ? notes.map(label).join('\n') : '（无）');

/** Markdown block for a system / user prompt. */
export function renderContext(rc: ResearchContext, opts: { sourceCatalog?: boolean } = {}): string {
  const parts = [
    `## 本 Workspace 的 workplan\n${rc.workplan ? `[[${rc.workplan.path.replace(/\.md$/, '')}|${rc.workplan.name}]]（${rc.workplan.status}）\n${rc.workplan.excerpt}` : '（还没有 workplan）'}`,
    `## 假设\n${list(rc.hypotheses, (n) => `- [[${n.name}]]（${n.status}）${n.excerpt}`)}`,
    `## 项目里已确认的决定\n${list(
      rc.decisions.filter((d) => d.status === '已确认'),
      (n) => `- [[${n.name}]]：${n.excerpt}`,
    )}`,
    `## 高层的指示和会议（simulated 表示模拟）\n${list(rc.meetings, (n) => `- [[${n.name}]]：${n.excerpt}`)}`,
    renderPremises(rc.conclusions ?? [], rc.opinions ?? []),
  ];
  if (rc.methods.length) parts.push(`## 团队的方法库（必须遵循）\n${rc.methods.map((m) => `### ${m.name}\n${m.excerpt}`).join('\n\n')}`);
  if (opts.sourceCatalog && rc.sources.length) {
    parts.push(
      `## 资料库里已有的资料（${rc.sources.length} 条）\n${rc.sources
        .slice(0, 40)
        .map((s) => `- [[${s.name}]]（${s.grade} 级，${s.origin}，${s.publisher}，${s.claims} 条论断）`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/**
 * The business decision the project supports (项目.md: "**支撑的决策**：…", e.g. D1 "差异化押哪一层 × 怎么拿到"):
 * what "AI 的推荐判断" has to answer. Falls back to the project's core question; null without a project note.
 */
export async function projectDecision(vault: Vault, projectPath: string): Promise<string | null> {
  let note;
  try {
    note = await vault.read(`${projectPath}/项目.md`);
  } catch {
    return null;
  }
  const line = note.body.split('\n').find((l) => /支撑的决策/.test(l) && /[：:]/.test(l));
  if (line) return line.replace(/^[-*\s]*\**支撑的决策\**\s*[：:]\s*/, '').replace(/\*\*/g, '').trim() || null;
  return typeof note.data.core_question === 'string' ? note.data.core_question : null;
}
