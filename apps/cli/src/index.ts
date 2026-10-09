export { buildProgram, runCli } from './cli.js';
export type { CliIo, CliState } from './cli.js';
export { makeClock, render, runEvaluate } from './evaluate-command.js';
export type {
  EvaluateCommandOptions,
  EvaluateCommandResult,
  OutputFormat,
} from './evaluate-command.js';
export {
  EXIT_ERROR,
  EXIT_GATE_FAILED,
  EXIT_OK,
  GATE,
  REPORT_SCHEMA_VERSION,
  indexEvidence,
  renderJson,
  renderJunit,
  renderMarkdown,
  renderText,
  summarize,
} from './report.js';
export type { EvaluationReport, EvidenceReference, FailOn } from './report.js';
export { runInit } from './commands/init.js';
export type { InitOptions, InitResult } from './commands/init.js';
export { runVerify } from './commands/verify.js';
export type { VerifyCommandOptions, VerifyCommandResult } from './commands/verify.js';
export { explainText, runExplain } from './commands/explain.js';
export type { ExplainOptions } from './commands/explain.js';
