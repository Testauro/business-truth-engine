export { buildDemo } from './http/app.js';
export type { DemoApp, DemoOptions } from './http/app.js';
export { EvidenceCollector, INVOICING_SOURCE, ORDERS_SOURCE } from './evidence/collector.js';
export type {
  CollectionResult,
  CollectorOptions,
  InvoicesReadModel,
  OrdersReadModel,
} from './evidence/collector.js';
export {
  FAULTS,
  FAULT_DESCRIPTIONS,
  FaultController,
  FaultSchema,
  parseFaultList,
} from './faults.js';
export type { Fault } from './faults.js';
export { loadConfig } from './config.js';
export type { DemoConfig } from './config.js';
export { DEFAULT_SETTLE_MS, runScenario } from './scenario-runner.js';
export type { ScenarioOptions, ScenarioResult } from './scenario-runner.js';
export { DELAYED_INVOICE_MS, InvoicingUnavailableError } from './domain/invoicing.js';
export type { Invoice } from './domain/invoicing.js';
export type { Order } from './domain/orders.js';
export type { Payment } from './domain/payments.js';
export { CATALOG } from './domain/catalog.js';
