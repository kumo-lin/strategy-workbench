/** 复核 A: a note's file name as readers see it — the research plan is stored as `workplan vN` (frozen data), shown as 研究计划 vN. */
export const readerName = (name: string): string => name.replace(/^workplan(?=( v\d+)?$)/, '研究计划');
