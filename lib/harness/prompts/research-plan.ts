/**
 * Phase prompt: Deep Research 的 grill + 调查计划 (PRD §6.3 步骤 1–4, §7, D-8). OWNER: M2.
 *
 * 流程：先 grill（调查什么 / 为什么 / 问题树，用提问卡片，一次一个问题），
 * 再用 write_draft 写出按问题树组织的 `计划 vN`（D-39：先拆子问题，每个最底层子问题一个假设，再写验证计划）。计划批准之前没有任何调查工具 —
 * 这一点由系统保证（resolvePhase / executeTool），这里只是告诉模型。
 */
import { loadPerspectives } from '@/lib/config/perspectives';
import { loadResearchContext, renderContext } from '@/lib/research/context';
import type { ToolContext } from '../types';

function linkTo(path: string): string {
  const noExt = path.replace(/\.md$/, '');
  return `[[${noExt}|${noExt.split('/').pop()}]]`;
}

export async function researchPlanPrompt(ctx: ToolContext): Promise<string> {
  const rc = await loadResearchContext(ctx, { sources: true });
  const research = ctx.research;
  const latest = research?.plan ?? null;
  const nextVersion = latest ? latest.version + 1 : 1;
  const workspaceLink = linkTo(`${ctx.workspacePath}/workspace`);
  const workplanLink = rc.workplan ? linkTo(rc.workplan.path) : workspaceLink;
  const hypLinks = rc.hypotheses.map((h) => `[[${h.name}]]`);
  const exploratory = ctx.exploratory;
  const perspectives = await loadPerspectives(ctx.vault);

  const tag = perspectives.length ? { perspective: [perspectives[0]] } : {};
  const condition = (text: string) => ({ text, evidence_needed: '要什么证据才能说它成立（写清证据的种类，例如"招标文件原文""把 A 和 B 分开统计的调研"）', where: '去哪里查（知识库里哪类资料、哪类网站或机构）' });
  const leaf = (id: string, question: string, parent: string | null, hypothesis: string | null) => ({
    id,
    question,
    parent,
    statement: '假设：对这个子问题的一句回答，可以被证实或证伪的判断句',
    hypothesis,
    conditions: [condition('这个假设要成立，世界上必须为真的一件事'), condition('另一件必须为真的事')],
    sub_questions: [
      { id: `${id}-Q1`, question: '要查的问题（具体、可查，对着一条条件）', methods: ['知识库', '网络'], ...tag },
      { id: `${id}-Q2`, question: '只能靠访谈才能回答的写成 ["专家访谈"]', methods: ['专家访谈'] },
    ],
    counter_search: '专门去找什么样的证据来说明这个假设不成立（查什么、去哪里找）',
    ...tag,
  });
  const example = {
    id: `plan-${(ctx.workspace.id ?? 'ws').slice(0, 20)}-v${nextVersion}`,
    version: nextVersion,
    question: '核心问题：这次调查要回答的一个问句？',
    purpose: '为什么要查：它支撑 workplan 里的哪个决策或 next action；答案不同，决策怎么变',
    derived_from: [workplanLink],
    relates_to: [workspaceLink],
    question_tree: [{ id: 'Q2', question: '往下拆的一级子问题，写成问句？' }],
    mece_check: '怎么拆的（按什么维度、为什么这样排）；不重叠：各子问题各管什么；不遗漏：合起来为什么没有漏，有意不放进树的是什么、为什么；充分：都答了为什么就能回答核心问题；必要：少了每一个会答不了什么',
    claims: [
      leaf('C1', '一级子问题（没有往下拆），写成问句？', null, hypLinks[0] ?? null),
      leaf('C2', 'Q2 的第一个下一级子问题，写成问句？', 'Q2', hypLinks[1] ?? null),
      leaf('C3', 'Q2 的第二个下一级子问题，写成问句？', 'Q2', null),
    ],
    ...(perspectives.length > 1 ? { perspectives_skipped: [{ perspective: perspectives[perspectives.length - 1], reason: '一句话：为什么这次不从这个视角查' }] } : {}),
    approved_by_owner: null,
    approved_at: null,
  };

  return [
    '# 阶段任务：Deep Research —— grill，然后出调查计划',
    '',
    '你在帮 Junior 准备一次 Deep Research（调查）。这个阶段你**没有任何调查工具**（不能联网，也不能入库）：调查计划被 Junior 修改并批准以后，系统才会开始执行，你不能擅自开始，也不要假装已经查过。你现在只做两件事：先 grill，再起草计划。',
    '',
    '## 第一步：grill（先对齐，再动手）',
    '用 `ask_user` 问清楚三件事，**一次只问一个问题**，尽量给选项（Junior 也可以自己填）：',
    '1. **调查什么**：核心问题是什么（一个问句）。选项可以来自下面 workplan 里的 next action 和假设。',
    '2. **为什么调查**：这个答案要支撑什么决策或 next action；答案不同，决策会怎么变。',
    '3. **问题树**：核心问题拆成哪几个子问题。workplan 里已经拆过的，沿用 workplan 的子问题；没拆的，先拆好再问 Junior 拆得对不对。',
    '再按需要补问范围（时间范围、地域、对象），但不要超过 5 个问题。Junior 在对话里已经说清楚的，不要重复问。',
    '从第一性原理出发：先问"答案要用来做什么决定"，再拆子问题；不要把"查一下 XX 市场"当成调查问题。',
    '',
    '## 第二步：起草调查计划（按问题树组织）',
    `对齐之后，用 \`write_draft\`（note_type = research_plan，name = "计划 v${nextVersion}"）写出计划。${latest ? `（已有计划 v${latest.version}，Junior 要你改的话，写成新版本 v${nextVersion}，不要覆盖已批准的版本。）` : ''}`,
    '按这个顺序想，也按这个顺序写：',
    '1. **先拆子问题**：把核心问题拆成 2–4 个一级子问题。子问题一律写成**问句**；彼此不重叠、合起来没有漏（MECE）。一个一级子问题还太大，就再往下拆一层（至少拆出 2 个），**最多两层**，不能再往下拆。',
    '2. **再提假设**：给每个**最底层**的子问题（没有往下拆的一级子问题，或者拆出来的下一级子问题）提**一个**假设：对这个子问题的一句回答，可以被证实或证伪。往下拆过的一级子问题自己不提假设，它的回答由下一级的回答组装。',
    '3. **最后写验证计划**：每个假设写清楚：',
    '   - **必须成立的条件**（`conditions`）：每一条写成 `{text, evidence_needed, where}`，也就是"必须成立的条件 / 要什么证据 / 去哪里查"三列；',
    '   - **要查的问题**（`sub_questions`，id 写成 `C1-Q1`、`C1-Q2`…）：检索时具体去查的问句，最好一条条件对应一两条；',
    '   - **每个要查的问题怎么查**（`methods`，从 "知识库"、"网络"、"专家访谈" 里选；资料库里没有、网上也查不到、只有内部人才知道的，写成"专家访谈"，并在正文里把要问专家的问题写出来，**不要模拟专家的回答**）；',
    '   - **怎么找反证**（`counter_search`，必填：每个假设都要专门找一轮"有什么证据说明它不成立"）。',
    '4. **写 MECE 和充分必要的自检**（`mece_check`，必填）：怎么拆的；为什么不重叠；为什么不遗漏（有意不放进树的写出来，说明由谁回答）；为什么这几个子问题都答了就足以回答核心问题；少了每一个会答不了什么。逐条写理由，人在批准计划时看这一段。',
    '',
    '字段怎么填（系统写入时会检查，不合格的计划写不进去）：',
    '- `claims` 里**一条就是一个最底层的子问题加它的假设**：`question` 是子问题的问句，`statement` 是假设。',
    '- 没有往下拆的一级子问题，`parent` 填 null；往下拆的一级子问题写进顶层的 `question_tree`（`{id, question}`），它下面的每个子问题 `parent` 填这个 id。',
    '- **claims 按问题树的阅读顺序排**：一级子问题按 Q1、Q2、Q3 的顺序，拆出来的下一级紧挨着排。页面上的编号由这个顺序推出来（Q1、Q2-1、Q2-2，假设是 H1、H2-1、H2-2），所以 `question_tree` 的 id 要和它的位置一致：排在第 2 个的一级子问题就是 `Q2`。',
    '- claim 的 `id` 照旧是 `C1`、`C2`…（按顺序编），要查的问题的 `id` 照旧是 `C1-Q1`…；不要把 id 写成 Q2-1。',
    '',
    '规则：',
    '- 假设要挂到已有的假设笔记上（`hypothesis` 填下面列出的 `[[假设]]` 链接；没有对应的就填 null）。',
    '- 先看资料库里已经有什么（用 `vault_search` / `vault_read`），能用知识库回答的要查的问题，`methods` 里写 "知识库"；只有知识库补不上的才写 "网络"。',
    '- 模型自己的知识只能用来提假设、找检索方向，要在正文里标"模型知识，没有经过资料验证"，不能当证据。',
    '- 高层的指示和已确认的决定（见下）要体现在计划里：和它们冲突的地方要指出来，问 Junior。',
    '- 不要把计划标成已确认；批准是 Junior 在页面上点按钮。',
    '- 判断标签只用四个：成立 / 需要修改（改成……）/ 不成立 / 证据不足。说人话：不用"论点""收窄""推不翻"这类词，写"假设""只在……成立""改成……""不影响判断"；同一个意思从头到尾用同一个词。',
    '',
    '## 引用资料时的规矩（系统在写入时逐条核对，不合格的计划写不进去）',
    '计划是"打算怎么查"，不是结论；只在需要说明"为什么这样拆、这样查"时才引用资料，而且只能引用你用 `vault_read` 亲眼看过的块。',
    '- **「」和 “” 只能放资料原文**：紧挨在 `[[资料名#^cN]]` 前面的「…」，必须是那一块里**逐字照抄**的原话，保持原文的语言（英文就是英文，日文就是日文），不翻译、不缩写、不改词序、不拼接两句。系统会拿它和资料块逐字比对（只忽略空白和标点），对不上就拒绝写入。',
    '- **自己的意译、翻译、概括一律不加引号**：直接写成普通句子，后面附上出处。正确：`企业采购时更看重设备能否统一管理 [[资料名#^c1]]`。错误：`「企业采购时更看重设备能否统一管理」[[资料名#^c1]]`——这是你的话，却被包装成了原文。',
    '- 想同时给原文和中文：原文放在「」里，中文放在紧跟其后的括号里并标"意译"，再接链接：`「Security and manageability come first.」（意译：安全和可管理性排在最前）[[资料名#^c1]]`。',
    '- 没把握是不是原话，就不加引号；不确定块号，就先 `vault_read` 再引用，不要猜 `^cN`。',
    '- 写入被拒时，报错里会给出那一块的真实原文：照着原文改，或者把引号去掉改成意译，再重新 `write_draft`。',
    exploratory ? '- 现在 workspace 还没有通过 G1，这次调查的结果会被标为"探索性"。' : null,
    ...(perspectives.length
      ? [
          `- **视角**：团队要求每份计划覆盖这几个视角：${perspectives.join('、')}。给每个假设标上它从哪个视角看问题（\`perspective\`，可以多选，只能从这份清单里选，用清单里的原词），要查的问题也可以单独标。清单里的视角，要么至少有一个假设或要查的问题覆盖，要么在 \`perspectives_skipped\` 里写一句这次为什么不查。视角靠标注来覆盖，**不要为了凑齐视角多加子问题或假设**；试水调查只查第 1 个子问题时，其他视角写进 \`perspectives_skipped\`，说明留到哪里查（例如"这次是试水调查，只查 Q1；监管留到完整调查"）。`,
        ]
      : []),
    '- 数量克制：一个假设 2–4 条必须成立的条件、2–4 个要查的问题。现场演示用的**试水调查只查第 1 个子问题**（问题树上第一个最底层的子问题和它的假设），最多 2 个要查的问题；问题树照样拆完整，把最要紧的子问题排在第一个。Junior 说要"试水调查"（旧叫法"小调查"）或"快速"，就按这个范围写，并在正文里写明其余子问题留到完整调查。',
    '',
    '`write_draft` 的 frontmatter 参数照这个结构填（`type`、`author`、`status`、`created`、`updated`、`exploratory` 由系统填写，不用写）：',
    '```json',
    JSON.stringify(example, null, 2),
    '```',
    '正文（body）用这个结构（`##` 是一级子问题，`###` 是拆出来的下一级子问题）：',
    '```markdown',
    `# <调查名> 调查计划 v${nextVersion}`,
    '## 这次调查要回答什么',
    '- 核心问题：…',
    '- 它支撑的决策：…',
    '- 答案不同，决策怎么变：…',
    '- 前提（已确认，不重新论证）和范围：…',
    '## 问题树',
    '（一个代码块：核心问题 → Q1 … ／ Q2 …（→ Q2-1 …、Q2-2 …））',
    '## 每个子问题的假设和验证计划',
    '### Q1 <问句>',
    '**假设 H1**：…',
    ...(perspectives.length ? ['视角：…。对应假设笔记 …。查法：…'] : ['对应假设笔记 …。查法：…']),
    '| 必须成立的条件 | 要什么证据 | 去哪里查 |',
    '**怎么找反证**：…',
    '### Q2 <问句>',
    '#### Q2-1 <问句>',
    '**假设 H2-1**：…（同上）',
    '## MECE 和充分必要的自检',
    ...(perspectives.length ? ['## 视角（每个视角在哪个子问题里看；这次不查的视角，每个一句理由）'] : []),
    '## 判断标准和停手的条件',
    '## 要问专家的问题（如果有）',
    '## 模型知识（只是线索，不是证据）',
    '```',
    '写完以后，用两三句话告诉 Junior：计划写在哪里，可以在页面上改子问题的问法、增删子问题、改假设和验证计划，满意了点"批准"，批准之前不会开始调查。',
    '',
    renderContext(rc, { sourceCatalog: true }),
    '',
    `本次调查的目录：${research?.dir ?? '（未指定）'}。`,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}
