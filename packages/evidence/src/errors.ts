export class EvidenceParseError extends Error {
  readonly file: string;
  readonly line: number;
  readonly issues: readonly string[];

  constructor(file: string, line: number, message: string, issues: readonly string[] = []) {
    super(
      `${file}:${line}: ${message}${issues.length > 0 ? `\n  - ${issues.join('\n  - ')}` : ''}`,
    );
    this.name = 'EvidenceParseError';
    this.file = file;
    this.line = line;
    this.issues = issues;
  }
}
