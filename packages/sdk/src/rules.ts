import type { Rule, RuleInput } from '@bte/core';
import { RuleSchema } from '@bte/core';

/**
 * Author a rule in TypeScript with full typing. Validated immediately, so a
 * broken rule fails at module load with the same messages as a YAML rule.
 */
export function defineRule(input: RuleInput): Rule {
  const result = RuleSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`,
    );
    throw new Error(
      `invalid rule ${typeof input.id === 'string' ? `"${input.id}"` : ''}:\n  - ${issues.join('\n  - ')}`,
    );
  }
  return result.data;
}
