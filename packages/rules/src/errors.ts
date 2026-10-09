export class RuleLoadError extends Error {
  readonly file: string;
  readonly issues: readonly string[];

  constructor(file: string, message: string, issues: readonly string[] = []) {
    super(`${file}: ${message}${issues.length > 0 ? `\n  - ${issues.join('\n  - ')}` : ''}`);
    this.name = 'RuleLoadError';
    this.file = file;
    this.issues = issues;
  }
}
