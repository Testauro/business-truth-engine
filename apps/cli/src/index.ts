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
