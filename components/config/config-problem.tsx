import type { JSX } from 'react';

/**
 * 接手卡 C2: `90_配置/模型.md` 缺失或写坏时，配置页显示这段说明，而不是整页报错。
 * 不写文件路径、不写英文（D10）；也不伪造一份能用的配置。
 */
export function ConfigProblem(): JSX.Element {
  return (
    <section className="bg-card space-y-2 rounded-lg border p-4" data-testid="config-problem">
      <p className="text-sm">配置暂时读不到。</p>
      <p className="text-muted-foreground text-sm">改好团队与模型配置后刷新。</p>
    </section>
  );
}
