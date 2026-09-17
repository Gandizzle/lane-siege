/**
 * The native Android side of a build. §1, §17 (M6).
 *
 * `android/` is generated - it has been in .gitignore since the first commit,
 * and `npx cap add android` reproduces it from capacitor.config.ts. That is a
 * good arrangement right up to the point where the app needs something the
 * config file has no field for, and then the choice is to commit sixty files of
 * Gradle scaffolding for the sake of one attribute, or to apply that attribute
 * from a script that IS committed.
 *
 * This is the script. It creates the platform if it is not there, copies the
 * web build into it, and then applies what the config file cannot say. It is
 * idempotent and fails loudly rather than silently leaving the app wrong, so a
 * clean clone reaches an openable Android project with one command:
 *
 *     npm run build:android
 *
 * WHAT IT SETS, AND WHY
 *
 *   - `screenOrientation="fullUser"` on the main activity. §1 says portrait,
 *     one-handed, and that is still the shape the game is designed around - but
 *     the layout now has a landscape arrangement of the same three areas
 *     (layout.ts), so a sideways phone gets a screen built for it rather than a
 *     letterboxed one. `fullUser` is what says that without taking the choice
 *     away from the player: a device with rotation locked stays where the owner
 *     put it, and one with auto-rotate on may use any of the four.
 *
 *     This is also a REPAIR. Earlier builds of this script locked the activity
 *     to `portrait`, and `android/` is generated once and then reused, so the
 *     lock is still sitting in the manifest of every checkout that ever ran it.
 *     The patch below replaces whatever value is there rather than only filling
 *     in a missing attribute, which is why it is a regex and not an `includes`.
 *
 * Everything else Capacitor's defaults get right: INTERNET is already declared
 * (the game needs it to reach a room), the launcher activity is `singleTask`
 * so returning to a backgrounded match resumes it rather than starting a second
 * one, and `configChanges` already covers the rotations the WebView would
 * otherwise be destroyed and rebuilt for - so a turn of the phone reaches the
 * renderer as a resize, which is what app.ts watches for.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PLATFORM = 'android';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';

const capacitor = (...args) => {
  execFileSync('npx', ['cap', ...args], { stdio: 'inherit' });
};

// `add` scaffolds and copies; `sync` copies into a platform that exists and
// updates its plugins. Which one is right depends only on whether the
// generated directory is there, so this decides rather than asking.
if (existsSync(PLATFORM)) {
  capacitor('sync', PLATFORM);
} else {
  console.log('[lane-siege] no android/ yet - creating it (it is generated, not committed)');
  capacitor('add', PLATFORM);
}

if (!existsSync(MANIFEST)) {
  console.error(`[lane-siege] ${MANIFEST} is missing after cap; nothing was patched`);
  process.exit(1);
}

const before = readFileSync(MANIFEST, 'utf8');
const WANTED = 'fullUser';

// Anchored on the activity's own name so this cannot land on the provider or
// on some future second activity.
const anchor = 'android:name=".MainActivity"';
if (!before.includes(anchor)) {
  console.error(`[lane-siege] could not find ${anchor} in ${MANIFEST}; manifest not edited`);
  process.exit(1);
}

// Either value: whatever the attribute says now, or nothing at all. A manifest
// left over from the portrait-locked version of this script has to be corrected
// rather than left alone, so an existing attribute is rewritten in place.
const existing = /android:screenOrientation="([^"]*)"/;
const current = existing.exec(before);

if (current?.[1] === WANTED) {
  console.log(`[lane-siege] android manifest already allows rotation (${WANTED})`);
  process.exit(0);
}

const after = current
  ? before.replace(existing, `android:screenOrientation="${WANTED}"`)
  : before.replace(anchor, `${anchor}\n            android:screenOrientation="${WANTED}"`);

writeFileSync(MANIFEST, after);
console.log(
  current
    ? `[lane-siege] android manifest orientation ${current[1]} -> ${WANTED}: both layouts are supported`
    : `[lane-siege] android manifest orientation set to ${WANTED}: both layouts are supported`,
);
