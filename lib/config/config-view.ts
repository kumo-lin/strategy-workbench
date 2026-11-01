/**
 * D-64 T43 (ui-6): what /config shows, read from 90_配置/ — the team (团队*.md: name, active, perspectives; the
 * comparison table in 团队.md gives each team's roles, methods and sources), the models by role (模型.md), and the
 * rules that do not change with the team (code, listed here for reading).
 */
import { secondJudgeProviderId } from '@/lib/research/citation-verify';
import type { Vault } from '@/lib/vault';
import { loadModelsConfig } from './models';

export interface TeamView {
  team: string;
  active: boolean;
  perspectives: string[];
  roles: string;
  methods: string;
  sources: string;
}

export interface ConfigView {
  teams: string[];
  current: TeamView;
  /** `use`: what the role is used for (v6 2.14 的“用在哪里”). */
  models: { role: '判断' | '执行' | '独立复核'; use: string; providerId: string; label: string; model: string }[];
  rules: readonly string[];
}

/** The rules code enforces whatever the team (D63 §3.3–3.5, D-64 T11–T26). */
export const FIXED_RULES = [
  '开工前先读决策契约、研究计划和 Senior 的意见',
  '研究计划的子问题都是问句，标出 1 到 4 个关键问题，每个关键问题 2 到 3 个竞争假设',
  '判断“成立”要至少 2 个互相独立的公开来源，最好的是 A/B 级，并且没有没被驳倒的反证',
  '访谈最多把判断提到“访谈支持”，不能提到“成立”',
  '文件管理里的资料不够，自动上网补查；连续 2 轮没有新证据就停',
  '每条引用过三道核验，写明能支持什么、不能支持什么',
  '每条建议至少引用报告里的一个判断；每个决定写明适用边界',
  '决定、报告的确认和发布为公司资产，只能由人来做',
] as const;

const CONFIG = '90_配置';

/** The cells of the row whose first cell is `label` in the first table of the body, by the header's team names. */
function tableRow(body: string, label: string): Map<string, string> {
  const rows = body.split('\n').filter((l) => /^\|/.test(l.trim())).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const header = rows[0] ?? [];
  const row = rows.find((r) => r[0] === label) ?? [];
  const out = new Map<string, string>();
  header.forEach((h, i) => {
    const team = h.replace(/（.*）$/, '');
    if (i > 0 && row[i]) out.set(team, row[i]);
  });
  return out;
}

export async function loadConfigView(vault: Vault, team?: string): Promise<ConfigView> {
  const notes = [];
  for (const e of await vault.list(CONFIG)) {
    if (e.kind !== 'file' || !/^团队.*\.md$/.test(e.name)) continue;
    const n = await vault.read(e.path);
    if (typeof n.data.team === 'string') notes.push(n);
  }
  notes.sort((a, b) => Number(b.data.active === true) - Number(a.data.active === true));
  const teams = notes.map((n) => String(n.data.team));
  const chosen = notes.find((n) => n.data.team === team) ?? notes[0];
  const table = notes.find((n) => n.data.active === true)?.body ?? '';
  const name = String(chosen.data.team);
  const cell = (label: string) => tableRow(table, label).get(name) ?? '';
  const config = await loadModelsConfig(vault);
  const provider = (id: string) => ({ providerId: id, label: config.providers[id]?.label ?? id, model: config.providers[id]?.model ?? '' });
  const execution = config.roles?.execution ?? config.active;
  return {
    teams,
    current: {
      team: name,
      active: chosen.data.active === true,
      perspectives: Array.isArray(chosen.data.perspectives) ? chosen.data.perspectives.map(String) : [],
      roles: cell('角色'),
      methods: cell('方法库'),
      sources: cell('调查的信源偏好'),
    },
    models: [
      { role: '判断', use: '研究计划、证据够不够、结论、推荐', ...provider(config.roles?.judgment ?? config.active) },
      { role: '执行', use: '检索、抽证据、按判断写正文', ...provider(execution) },
      // the second judge as the config sets it (an env override is a run-time matter, not configuration)
      { role: '独立复核', use: '引用的第三道核验', ...provider(await secondJudgeProviderId(vault, execution, {} as NodeJS.ProcessEnv)) },
    ],
    rules: FIXED_RULES,
  };
}
