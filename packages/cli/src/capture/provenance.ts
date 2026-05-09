/**
 * provenance.ts — collect & render the per-profile `PROVENANCE.md`.
 *
 * Provenance discipline (PLAN.md §12.2) requires that every profile in
 * `main` be captured by a known person on a known machine on a known
 * date. We collect:
 *
 *   - capturer name (free text; e.g. "@orchestrator", "Marc Xavier")
 *   - machine model + truncated serial (e.g. "Mac14,2 / serial …F8K2")
 *   - browser version (read from the captured probes)
 *   - mochi version (the CLI version that ran)
 *   - capture timestamp (ISO 8601, set by the tool)
 *
 * The interactive prompt path uses `node:readline/promises`, matching
 * the pattern already used in `packages/cli/src/browsers/subcommand.ts`.
 *
 * A `nonInteractive` path is provided for tests + CI: every field can be
 * pre-supplied as `ProvenanceInputs`. The collector merges with prompt
 * fall-back only when stdin is a TTY.
 *
 * @see PLAN.md §12.2
 */

import { createInterface } from "node:readline/promises";

export interface ProvenanceInputs {
  /** Human capturer label. */
  readonly capturer?: string;
  /** Free-form hardware label. Serial truncation is the caller's job. */
  readonly machine?: string;
  /** Captured browser version (e.g. `131.0.6778.86`). */
  readonly browserVersion?: string;
  /** mochi (cli) version that produced the capture. */
  readonly mochiVersion?: string;
  /** ISO timestamp; defaults to `new Date().toISOString()`. */
  readonly capturedAt?: string;
  /** Any extra notes the human wants to include. */
  readonly notes?: string;
}

export interface ProvenanceRecord {
  readonly profileId: string;
  readonly capturer: string;
  readonly machine: string;
  readonly browserVersion: string;
  readonly mochiVersion: string;
  readonly capturedAt: string;
  readonly notes: string;
}

export interface CollectOptions {
  readonly profileId: string;
  /**
   * Prefilled values. When all required fields are present, no prompts
   * are shown. When fields are missing AND `interactive` is true, we
   * prompt for them.
   */
  readonly inputs?: ProvenanceInputs;
  /** When false, missing fields fall back to "unknown" without prompting. */
  readonly interactive?: boolean;
}

/**
 * Collect a complete {@link ProvenanceRecord}. Prompts are issued only
 * when `interactive: true` and the field is missing in `inputs`. When
 * `interactive: false`, missing fields default to `"unknown"`.
 */
export async function collectProvenance(opts: CollectOptions): Promise<ProvenanceRecord> {
  const inputs = opts.inputs ?? {};
  const fallback = "unknown";
  let capturer = inputs.capturer?.trim();
  let machine = inputs.machine?.trim();
  let browserVersion = inputs.browserVersion?.trim();
  let mochiVersion = inputs.mochiVersion?.trim();
  let notes = inputs.notes?.trim() ?? "";

  if (opts.interactive === true) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      capturer = capturer || (await rl.question("capturer (name or @handle): ")).trim();
      machine = machine || (await rl.question("machine (model + serial-suffix): ")).trim();
      browserVersion =
        browserVersion || (await rl.question("browser version (dotted-quad): ")).trim();
      mochiVersion = mochiVersion || (await rl.question("mochi cli version: ")).trim();
      const noteInput = (await rl.question("notes (optional): ")).trim();
      if (notes.length === 0 && noteInput.length > 0) notes = noteInput;
    } finally {
      rl.close();
    }
  }

  return {
    profileId: opts.profileId,
    capturer: capturer && capturer.length > 0 ? capturer : fallback,
    machine: machine && machine.length > 0 ? machine : fallback,
    browserVersion: browserVersion && browserVersion.length > 0 ? browserVersion : fallback,
    mochiVersion: mochiVersion && mochiVersion.length > 0 ? mochiVersion : fallback,
    capturedAt: inputs.capturedAt ?? new Date().toISOString(),
    notes,
  };
}

/**
 * Render a {@link ProvenanceRecord} as a Markdown document. Stable byte
 * output for given inputs — useful for tests + diffing.
 */
export function renderProvenance(record: ProvenanceRecord): string {
  const lines = [
    `# PROVENANCE — ${record.profileId}`,
    "",
    "Captured by `mochi capture`. PLAN.md §12.2 — every profile in `main`",
    "must carry verifiable provenance.",
    "",
    "| field | value |",
    "|---|---|",
    `| profile id | \`${record.profileId}\` |`,
    `| capturer | ${record.capturer} |`,
    `| machine | ${record.machine} |`,
    `| browser version | ${record.browserVersion} |`,
    `| mochi cli version | ${record.mochiVersion} |`,
    `| captured at (UTC) | ${record.capturedAt} |`,
  ];
  if (record.notes.length > 0) {
    lines.push("", "## Notes", "", record.notes);
  }
  lines.push(""); // trailing newline
  return `${lines.join("\n")}\n`;
}
