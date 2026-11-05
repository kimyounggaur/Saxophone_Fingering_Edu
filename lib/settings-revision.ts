/**
 * Generations of the app's saved settings.
 *
 * The app saves every setting in the browser, including the ones the learner never touched.  A default
 * that changes in a later release would therefore never reach a browser that has used the app before.
 * Each saved settings object carries the revision it was written with; `upgradeSavedSettings` applies the
 * changed defaults to older saves exactly once, and afterwards the learner's own choices stay as they are.
 *
 * Revisions
 *   1  first releases: the saxophone tone only on request (`autoTone` off), volume 18 %.
 *   2  the tone of the selected saxophone plays whenever the fingering changes (`autoTone` on) and the
 *      volume is easy to hear.  Measured with SaxTone 3.0 (docs/audio-engine.md): a note at 18 % is about
 *      -26 LUFS, at 50 % about -19 LUFS.
 *
 * Keep this file free of TypeScript-only runtime syntax (enums, parameter properties) so that the Node
 * test runner can import it directly with type stripping.
 */

export const SETTINGS_REVISION = 2;

/** Volume of a fresh install (the slider runs from 0 to 1). */
export const DEFAULT_TONE_VOLUME = 0.5;
/** The volume that revision-1 releases started with; an exact match means the learner never moved the slider. */
export const LEGACY_DEFAULT_VOLUME = 0.18;

const FIRST_REVISION = 1;

/**
 * Returns a copy of settings saved by this or an older release, upgraded to `SETTINGS_REVISION`.
 * Only the fields that changed defaults are touched; every other field is passed through unchanged.
 */
export function upgradeSavedSettings<T extends object>(saved: T): T & { settingsRevision: number } {
  const record = saved as Record<string, unknown>;
  const savedRevision =
    typeof record.settingsRevision === "number" && Number.isFinite(record.settingsRevision)
      ? record.settingsRevision
      : FIRST_REVISION;
  const upgraded: Record<string, unknown> = { ...record };
  if (savedRevision < 2) {
    // The tone follows the fingering from now on, including for learners who saved the old default (off).
    // Whoever switches it off again afterwards keeps it off: the revision below is saved with the choice.
    upgraded.autoTone = true;
    if (typeof record.volume === "number" && Math.abs(record.volume - LEGACY_DEFAULT_VOLUME) < 1e-9) {
      upgraded.volume = DEFAULT_TONE_VOLUME;
    }
  }
  upgraded.settingsRevision = Math.max(savedRevision, SETTINGS_REVISION);
  return upgraded as T & { settingsRevision: number };
}
