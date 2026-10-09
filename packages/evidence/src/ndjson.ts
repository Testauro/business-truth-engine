import { createReadStream } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { EvidenceRecordSchema } from '@bte/core';
import type { EvidenceRecord } from '@bte/core';
import { EvidenceParseError } from './errors.js';

/** Parse a single NDJSON line. Blank lines and `#` comments are skipped by the callers. */
export function parseEvidenceLine(text: string, file = '<inline>', line = 1): EvidenceRecord {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new EvidenceParseError(
      file,
      line,
      `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = EvidenceRecordSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`,
    );
    throw new EvidenceParseError(file, line, 'record does not match the evidence contract', issues);
  }
  return result.data;
}

function isSkippable(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/** Parse NDJSON text held in memory. */
export function parseEvidenceNdjson(text: string, file = '<inline>'): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    if (isSkippable(lineText)) return;
    records.push(parseEvidenceLine(lineText, file, index + 1));
  });
  return records;
}

/** Stream an NDJSON file from disk, validating each record. */
export async function* readEvidenceNdjson(file: string): AsyncGenerator<EvidenceRecord> {
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNumber = 0;
  for await (const lineText of lines) {
    lineNumber += 1;
    if (isSkippable(lineText)) continue;
    yield parseEvidenceLine(lineText, file, lineNumber);
  }
}

export async function readAllEvidence(files: readonly string[]): Promise<EvidenceRecord[]> {
  const records: EvidenceRecord[] = [];
  for (const file of files) {
    for await (const record of readEvidenceNdjson(file)) records.push(record);
  }
  return records;
}

export function toNdjsonLine(record: EvidenceRecord): string {
  return `${JSON.stringify(EvidenceRecordSchema.parse(record))}\n`;
}

export async function writeEvidenceNdjson(
  file: string,
  records: Iterable<EvidenceRecord>,
): Promise<void> {
  let body = '';
  for (const record of records) body += toNdjsonLine(record);
  await writeFile(file, body, 'utf8');
}

export async function appendEvidenceNdjson(file: string, record: EvidenceRecord): Promise<void> {
  await appendFile(file, toNdjsonLine(record), 'utf8');
}
