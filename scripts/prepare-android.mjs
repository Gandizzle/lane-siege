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
 *   - `screenOrientation="portrait"` on the main activity. §1 says portrait,
 *     one-handed, and §4.1 and §14.1 build a fixed camera on top of that
 *     assumption. A landscape phone would letterbox a layout that was never
 *     designed to be laid out any other way.
 *
 * Everything else Capacitor's defaults get right: INTERNET is already declared
 * (the game needs it to reach a room), the launcher activity is `singleTask`
 * so returning to a backgrounded match resumes it rather than starting a second
 * one, and `configChanges` already covers the rotations the WebView would
 * otherwise be destroyed and rebuilt for.
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

if (before.includes('android:screenOrientation="portrait"')) {
  console.log('[lane-siege] android manifest already portrait-locked');
  process.exit(0);
}

// Anchored on the activity's own name so this cannot land on the provider or
// on some future second activity.
const anchor = 'android:name=".MainActivity"';
if (!before.includes(anchor)) {
  console.error(`[lane-siege] could not find ${anchor} in ${MANIFEST}; manifest not edited`);
  process.exit(1);
}

const after = before.replace(anchor, `${anchor}\n            android:screenOrientation="portrait"`);
writeFileSync(MANIFEST, after);
console.log('[lane-siege] android manifest locked to portrait (§1)');
