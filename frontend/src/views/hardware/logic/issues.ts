import type { CheckIssue } from '@/contracts';

const SEVERITY_ORDER: Record<CheckIssue['severity'], number> = { error: 0, warning: 1, info: 2 };

/** Stable signature used to avoid re-publishing identical issue lists at 30 Hz. */
export function issuesSignature(list: CheckIssue[]): string {
  return list.map((i) => `${i.id}|${i.severity}|${i.title}|${i.message}`).join('\n');
}

/** Sorted copy: errors first, then warnings, then info (stable within a severity). */
export function sortIssues(list: CheckIssue[]): CheckIssue[] {
  return list
    .map((i, k) => ({ i, k }))
    .sort((a, b) => SEVERITY_ORDER[a.i.severity] - SEVERITY_ORDER[b.i.severity] || a.k - b.k)
    .map((x) => x.i);
}

/** Error / warning counts. */
export function issueCounts(list: CheckIssue[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of list) {
    if (i.severity === 'error') errors++;
    else if (i.severity === 'warning') warnings++;
  }
  return { errors, warnings };
}
