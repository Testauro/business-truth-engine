/**
 * @bte/sdk: the public, documented surface of the Business Truth Engine.
 * Consumers import from here (and from @bte/playwright for test fixtures);
 * the other @bte/* packages are implementation and may change shape.
 */
export * from '@bte/core';
export { loadRules, loadRuleFile, parseRuleYaml, ruleJsonSchema, RuleLoadError } from '@bte/rules';
export {
  parseEvidenceNdjson,
  readAllEvidence,
  readEvidenceNdjson,
  toNdjsonLine,
  writeEvidenceNdjson,
  appendEvidenceNdjson,
  InMemoryEvidenceStore,
  EvidenceParseError,
} from '@bte/evidence';
export { createHttpSource, HttpSourceConfigSchema, HttpSourceError } from '@bte/evidence-http';
export type { HttpSourceConfig, HttpRequestConfig, HttpAuthConfig } from '@bte/evidence-http';

export { defineRule } from './rules.js';
export {
  BteConfigSchema,
  CONFIG_FILES,
  CustomSourceConfigSchema,
  NdjsonSourceConfigSchema,
  PostgresSourceConfigSchema,
  SourceConfigSchema,
  defineConfig,
  findConfigFile,
  loadBteConfig,
  loadRawBteConfig,
  loadRuleTargets,
  validateConfig,
} from './config.js';
export type {
  BteConfig,
  BteConfigInput,
  LoadConfigOptions,
  LoadedConfig,
  RawConfig,
  SourceConfig,
} from './config.js';
export { ConfigError, interpolateEnv, loadDotEnv, parseDotEnv } from './env.js';
export { ndjsonSource, resolveSources } from './sources.js';
export type { SourceFactory } from './sources.js';
export { clockFor, loadConfiguredRules, verify } from './verify.js';
export type { VerifyOptions, VerifyResult } from './verify.js';
