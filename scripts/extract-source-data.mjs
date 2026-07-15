#!/usr/bin/env node

/**
 * Extracts the canonical saxophone key, note, and transposition literals without
 * executing the legacy generator. Keep this script deterministic: generated
 * output is reviewed by source hash and should not contain timestamps.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const EXTRACTOR_VERSION = "1.0.0";
const EXPECTED_SOURCE_SHA256 =
  "50ffcc418d9a9923a027187df36495e9c6931607e5f3ed57e3d5ea3c9d3ecbd4";
const EXPECTED_KEY_COUNT = 23;
const EXPECTED_NOTE_COUNT = 33;
const EXPECTED_WRITTEN_MIDI_MIN = 58;
const EXPECTED_WRITTEN_MIDI_MAX = 90;
const EXPECTED_UNUSED_KEY_IDS = ["altFSharp", "bis", "frontF", "sideC"];
const EXPECTED_TRANSPOSITIONS = Object.freeze({ alto: 9, tenor: 14, soprano: 2 });

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const defaultSourcePath = resolve(
  projectRoot,
  "..",
  "01 Source",
  "generate-alto-sax-fingering-chart.mjs",
);
const defaultOutputPath = resolve(projectRoot, "lib", "generated", "source-data.ts");

function fail(message) {
  throw new Error(`[source-data] ${message}`);
}

function parseCli(argv) {
  const options = {
    sourcePath: defaultSourcePath,
    outputPath: defaultOutputPath,
    checkOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.checkOnly = true;
      continue;
    }
    if (argument === "--source" || argument === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        fail(`${argument} requires a path`);
      }
      index += 1;
      if (argument === "--source") options.sourcePath = resolve(process.cwd(), value);
      else options.outputPath = resolve(process.cwd(), value);
      continue;
    }
    fail(`unknown argument: ${argument}`);
  }

  return options;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  fail(`unsupported computed/property name at ${node.getStart()}`);
}

/**
 * Interprets a deliberately tiny literal-only AST subset. It does not resolve
 * identifiers, imports, property access, templates, or arbitrary calls.
 */
function literalValue(node, context) {
  if (ts.isParenthesizedExpression(node)) return literalValue(node.expression, context);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isPrefixUnaryExpression(node)) {
    const operand = literalValue(node.operand, context);
    if (typeof operand !== "number") fail(`${context}: unary operand is not numeric`);
    if (node.operator === ts.SyntaxKind.MinusToken) return -operand;
    if (node.operator === ts.SyntaxKind.PlusToken) return operand;
    fail(`${context}: unsupported unary operator`);
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element, index) => {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
        fail(`${context}[${index}]: spread/omitted elements are forbidden`);
      }
      return literalValue(element, `${context}[${index}]`);
    });
  }

  if (ts.isObjectLiteralExpression(node)) {
    const result = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        fail(`${context}: only explicit property assignments are allowed`);
      }
      const key = propertyName(property.name);
      if (Object.hasOwn(result, key)) fail(`${context}: duplicate property ${key}`);
      result[key] = literalValue(property.initializer, `${context}.${key}`);
    }
    return result;
  }

  // The canonical notes array uses a single local constructor helper `n`.
  // We model that call explicitly instead of running it.
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "n"
  ) {
    if (node.arguments.length !== 6) {
      fail(`${context}: n() must have exactly 6 literal arguments`);
    }
    const [label, midi, pressed, short, formula, note] = node.arguments.map((argument, index) =>
      literalValue(argument, `${context}.n[${index}]`),
    );
    return { label, midi, pressed, short, formula, note };
  }

  fail(`${context}: unsupported non-literal syntax ${ts.SyntaxKind[node.kind]}`);
}

function findConstInitializer(sourceFile, variableName) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === variableName &&
        declaration.initializer
      ) {
        matches.push(declaration.initializer);
      }
    }
  }
  if (matches.length !== 1) {
    fail(`expected exactly one top-level const ${variableName}; found ${matches.length}`);
  }
  return matches[0];
}

function assertPlainRecord(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${context} must be an object`);
  }
}

function assertString(value, context) {
  if (typeof value !== "string") fail(`${context} must be a string`);
}

function assertFiniteNumber(value, context) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${context} must be a finite number`);
  }
}

function assertUnique(values, context) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(`${context} contains duplicate ${JSON.stringify(value)}`);
    seen.add(value);
  }
}

function sameSortedStrings(left, right) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function validateExtractedData(data) {
  if (!Array.isArray(data.keys) || data.keys.length !== EXPECTED_KEY_COUNT) {
    fail(`expected ${EXPECTED_KEY_COUNT} keys; found ${data.keys?.length ?? "non-array"}`);
  }
  if (!Array.isArray(data.notes) || data.notes.length !== EXPECTED_NOTE_COUNT) {
    fail(`expected ${EXPECTED_NOTE_COUNT} notes; found ${data.notes?.length ?? "non-array"}`);
  }
  assertPlainRecord(data.chartConfigs, "chartConfigs");

  const keyIds = data.keys.map((key, index) => {
    assertPlainRecord(key, `keys[${index}]`);
    assertString(key.id, `keys[${index}].id`);
    assertString(key.label, `keys[${index}].label`);
    assertString(key.type, `keys[${index}].type`);
    assertString(key.group, `keys[${index}].group`);
    assertFiniteNumber(key.x, `keys[${index}].x`);
    assertFiniteNumber(key.y, `keys[${index}].y`);
    if (!['circle', 'pill'].includes(key.type)) fail(`keys[${index}].type is invalid`);
    if (key.type === "circle") assertFiniteNumber(key.r, `keys[${index}].r`);
    if (key.type === "pill") {
      assertFiniteNumber(key.w, `keys[${index}].w`);
      assertFiniteNumber(key.h, `keys[${index}].h`);
    }
    return key.id;
  });
  assertUnique(keyIds, "key ids");
  const keyIdSet = new Set(keyIds);

  const usedKeyIds = new Set();
  const midiValues = data.notes.map((note, index) => {
    assertPlainRecord(note, `notes[${index}]`);
    assertString(note.label, `notes[${index}].label`);
    assertFiniteNumber(note.midi, `notes[${index}].midi`);
    if (!Number.isInteger(note.midi)) fail(`notes[${index}].midi must be an integer`);
    if (!Array.isArray(note.pressed)) fail(`notes[${index}].pressed must be an array`);
    assertString(note.short, `notes[${index}].short`);
    assertString(note.formula, `notes[${index}].formula`);
    assertString(note.note, `notes[${index}].note`);
    assertUnique(note.pressed, `notes[${index}].pressed`);
    for (const keyId of note.pressed) {
      assertString(keyId, `notes[${index}].pressed key id`);
      if (!keyIdSet.has(keyId)) fail(`notes[${index}] references unknown key ${keyId}`);
      usedKeyIds.add(keyId);
    }
    return note.midi;
  });
  assertUnique(midiValues, "note MIDI values");

  const expectedMidiValues = Array.from(
    { length: EXPECTED_NOTE_COUNT },
    (_, index) => EXPECTED_WRITTEN_MIDI_MIN + index,
  );
  if (!expectedMidiValues.every((midi, index) => midiValues[index] === midi)) {
    fail(
      `written MIDI must be continuous and ordered ${EXPECTED_WRITTEN_MIDI_MIN}..${EXPECTED_WRITTEN_MIDI_MAX}; found ${midiValues.join(",")}`,
    );
  }

  const unusedKeyIds = keyIds.filter((keyId) => !usedKeyIds.has(keyId)).sort();
  if (!sameSortedStrings(unusedKeyIds, EXPECTED_UNUSED_KEY_IDS)) {
    fail(
      `unused keys must be ${EXPECTED_UNUSED_KEY_IDS.join(",")}; found ${unusedKeyIds.join(",")}`,
    );
  }

  const instrumentIds = Object.keys(data.chartConfigs);
  if (!sameSortedStrings(instrumentIds, Object.keys(EXPECTED_TRANSPOSITIONS))) {
    fail(`instrument ids must be alto,tenor,soprano; found ${instrumentIds.join(",")}`);
  }
  for (const [instrumentId, expectedSemitones] of Object.entries(EXPECTED_TRANSPOSITIONS)) {
    const config = data.chartConfigs[instrumentId];
    assertPlainRecord(config, `chartConfigs.${instrumentId}`);
    if (config.transpositionSemitones !== expectedSemitones) {
      fail(
        `${instrumentId} transposition must be ${expectedSemitones}; found ${config.transpositionSemitones}`,
      );
    }
  }

  return { unusedKeyIds };
}

function slashPath(path) {
  return path.split(sep).join("/");
}

function renderGeneratedModule(data) {
  const serialized = JSON.stringify(data, null, 2);
  return `/**
 * AUTO-GENERATED FILE — DO NOT EDIT.
 * Source: ${data.source.relativePath}
 * Source SHA-256: ${data.source.sha256}
 * Extractor version: ${data.extractorVersion}
 *
 * Regenerate with: node scripts/extract-source-data.mjs
 */

export const SOURCE_DATA = ${serialized} as const;

export type GeneratedSourceData = typeof SOURCE_DATA;
`;
}

function main() {
  const options = parseCli(process.argv.slice(2));
  const sourceText = readFileSync(options.sourcePath, "utf8");
  const sourceSha256 = createHash("sha256").update(sourceText, "utf8").digest("hex");
  if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
    fail(
      `canonical source hash changed: expected ${EXPECTED_SOURCE_SHA256}, found ${sourceSha256}. Review the source diff before updating the pinned hash.`,
    );
  }

  const sourceFile = ts.createSourceFile(
    options.sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const details = sourceFile.parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("; ");
    fail(`TypeScript parser diagnostics: ${details}`);
  }

  const extracted = {
    chartConfigs: literalValue(
      findConstInitializer(sourceFile, "chartConfigs"),
      "chartConfigs",
    ),
    keys: literalValue(findConstInitializer(sourceFile, "keys"), "keys"),
    notes: literalValue(findConstInitializer(sourceFile, "notes"), "notes"),
  };
  const validation = validateExtractedData(extracted);

  const sourceRelativePath = slashPath(relative(projectRoot, options.sourcePath));
  const generatedData = {
    schemaVersion: 1,
    extractorVersion: EXTRACTOR_VERSION,
    source: {
      relativePath: sourceRelativePath,
      sha256: sourceSha256,
    },
    invariants: {
      keyCount: EXPECTED_KEY_COUNT,
      noteCount: EXPECTED_NOTE_COUNT,
      writtenMidiMin: EXPECTED_WRITTEN_MIDI_MIN,
      writtenMidiMax: EXPECTED_WRITTEN_MIDI_MAX,
      unusedKeyIds: validation.unusedKeyIds,
    },
    ...extracted,
  };
  const output = renderGeneratedModule(generatedData);

  if (options.checkOnly) {
    const current = readFileSync(options.outputPath, "utf8");
    if (current !== output) fail(`generated module is stale: ${options.outputPath}`);
  } else {
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, output, "utf8");
  }

  const action = options.checkOnly ? "verified" : "generated";
  console.log(
    `[source-data] ${action}: ${EXPECTED_KEY_COUNT} keys, ${EXPECTED_NOTE_COUNT} notes, MIDI ${EXPECTED_WRITTEN_MIDI_MIN}..${EXPECTED_WRITTEN_MIDI_MAX}, instruments alto/tenor/soprano`,
  );
  console.log(`[source-data] SHA-256 ${sourceSha256}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
