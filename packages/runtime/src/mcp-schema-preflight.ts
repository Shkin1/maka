/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv';

const validator = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const compiledSchemas = new WeakMap<object, ValidateFunction | undefined>();

export function validateMcpJsonSchemaInput(
  schema: unknown,
  input: unknown,
):
  | { readonly success: true; readonly value: unknown }
  | { readonly success: false; readonly error: Error } {
  const compiled = compileMcpSchema(schema);
  if (!compiled || compiled(input)) return { success: true, value: input };
  return {
    success: false,
    error: new Error(schemaErrorSummary(compiled.errors)),
  };
}

function compileMcpSchema(schema: unknown): ValidateFunction | undefined {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return undefined;
  if (compiledSchemas.has(schema)) return compiledSchemas.get(schema);
  let compiled: ValidateFunction | undefined;
  try {
    compiled = validator.compile(stripUnsafeRegexConstraints(schema) as AnySchema);
  } catch {
    // The MCP endpoint remains authoritative for unsupported schema dialects.
    compiled = undefined;
  }
  compiledSchemas.set(schema, compiled);
  return compiled;
}

function stripUnsafeRegexConstraints(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const hasPatternProperties = isRecord(value.patternProperties);
  const entries: Array<[string, unknown]> = [];
  for (const [key, nested] of Object.entries(value)) {
    if (key === '$schema' || key === 'pattern' || key === 'patternProperties') continue;
    if (key === 'additionalProperties' && hasPatternProperties) continue;
    entries.push([key, projectSchemaKeyword(key, nested)]);
  }
  return Object.fromEntries(entries);
}

function projectSchemaKeyword(key: string, value: unknown): unknown {
  if (key === 'properties' || key === '$defs' || key === 'definitions') {
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([name, schema]) => [name, stripUnsafeRegexConstraints(schema)]),
    );
  }
  if (key === 'dependencies' || key === 'dependentSchemas') {
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([name, schema]) => [
        name,
        Array.isArray(schema) ? schema : stripUnsafeRegexConstraints(schema),
      ]),
    );
  }
  if (key === 'allOf' || key === 'anyOf' || key === 'oneOf' || key === 'prefixItems') {
    return Array.isArray(value) ? value.map(stripUnsafeRegexConstraints) : value;
  }
  if (
    key === 'items' ||
    key === 'additionalItems' ||
    key === 'additionalProperties' ||
    key === 'unevaluatedItems' ||
    key === 'unevaluatedProperties' ||
    key === 'propertyNames' ||
    key === 'contains' ||
    key === 'not' ||
    key === 'if' ||
    key === 'then' ||
    key === 'else'
  ) {
    return Array.isArray(value)
      ? value.map(stripUnsafeRegexConstraints)
      : stripUnsafeRegexConstraints(value);
  }
  return value;
}

function schemaErrorSummary(errors: ErrorObject[] | null | undefined): string {
  if (!errors) return 'input does not match the declared schema';
  return errors
    .slice(0, 5)
    .map(
      (issue) =>
        `${issue.instancePath || issue.schemaPath || 'input'} ${issue.message ?? 'is invalid'}`,
    )
    .join('; ')
    .slice(0, 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
