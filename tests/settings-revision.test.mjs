import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TONE_VOLUME,
  LEGACY_DEFAULT_VOLUME,
  SETTINGS_REVISION,
  upgradeSavedSettings,
} from "../lib/settings-revision.ts";

// What the first releases saved: no revision, the tone only on request, the volume that every install started with.
const firstReleaseSave = Object.freeze({
  instrument: "tenor",
  accidental: "sharp",
  theme: "dark",
  autoTone: false,
  toneEngine: "model",
  volume: 0.18,
});

test("a save from the first releases gets the tone that follows the fingering, once", () => {
  const upgraded = upgradeSavedSettings(firstReleaseSave);
  assert.equal(upgraded.autoTone, true);
  assert.equal(upgraded.volume, DEFAULT_TONE_VOLUME);
  assert.equal(upgraded.settingsRevision, SETTINGS_REVISION);
});

test("everything else in the save is passed through and the input is not modified", () => {
  const upgraded = upgradeSavedSettings(firstReleaseSave);
  assert.equal(upgraded.instrument, "tenor");
  assert.equal(upgraded.accidental, "sharp");
  assert.equal(upgraded.theme, "dark");
  assert.equal(upgraded.toneEngine, "model");
  assert.notEqual(upgraded, firstReleaseSave);
  assert.equal(firstReleaseSave.autoTone, false);
  assert.equal(firstReleaseSave.volume, 0.18);
  assert.equal("settingsRevision" in firstReleaseSave, false);
});

test("a volume the learner chose themselves is kept", () => {
  for (const volume of [0, 0.05, 0.17, 0.3, 0.75, 1]) {
    const upgraded = upgradeSavedSettings({ ...firstReleaseSave, volume });
    assert.equal(upgraded.volume, volume, `volume ${volume}`);
    assert.equal(upgraded.autoTone, true);
  }
});

test("a save without a usable volume is left for the loader's own fallback", () => {
  for (const volume of [undefined, null, "0.18", Number.NaN]) {
    const upgraded = upgradeSavedSettings({ autoTone: false, volume });
    assert.equal(Object.is(upgraded.volume, volume), true, String(volume));
    assert.equal(upgraded.autoTone, true);
  }
});

test("after the upgrade the learner's choices are final: switching the tone off stays off", () => {
  const first = upgradeSavedSettings(firstReleaseSave);
  const switchedOff = { ...first, autoTone: false, volume: 0.18 };
  const reloaded = upgradeSavedSettings(JSON.parse(JSON.stringify(switchedOff)));
  assert.equal(reloaded.autoTone, false);
  assert.equal(reloaded.volume, 0.18);
  assert.equal(reloaded.settingsRevision, SETTINGS_REVISION);
});

test("a save of the current revision is not changed", () => {
  const current = { autoTone: false, volume: 0.18, theme: "light", settingsRevision: SETTINGS_REVISION };
  assert.deepEqual(upgradeSavedSettings(current), current);
});

test("a save from a newer release is never downgraded", () => {
  const future = { autoTone: false, volume: 0.18, settingsRevision: SETTINGS_REVISION + 3 };
  const upgraded = upgradeSavedSettings(future);
  assert.equal(upgraded.autoTone, false);
  assert.equal(upgraded.volume, 0.18);
  assert.equal(upgraded.settingsRevision, SETTINGS_REVISION + 3);
});

test("a revision that is not a number counts as the first release", () => {
  for (const settingsRevision of ["2", null, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
    const upgraded = upgradeSavedSettings({ autoTone: false, volume: 0.18, settingsRevision });
    assert.equal(upgraded.autoTone, true, String(settingsRevision));
    assert.equal(upgraded.volume, DEFAULT_TONE_VOLUME, String(settingsRevision));
    assert.equal(upgraded.settingsRevision, SETTINGS_REVISION, String(settingsRevision));
  }
});

test("an empty save is upgraded too", () => {
  const upgraded = upgradeSavedSettings({});
  assert.equal(upgraded.autoTone, true);
  assert.equal(upgraded.settingsRevision, SETTINGS_REVISION);
  assert.equal("volume" in upgraded, false);
});

test("the constants stay consistent with each other", () => {
  assert.equal(Number.isInteger(SETTINGS_REVISION) && SETTINGS_REVISION >= 2, true);
  assert.equal(LEGACY_DEFAULT_VOLUME, 0.18);
  assert.ok(DEFAULT_TONE_VOLUME > LEGACY_DEFAULT_VOLUME && DEFAULT_TONE_VOLUME <= 1);
});
