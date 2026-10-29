/**
 * Hidden names (moderation.ts) and the reports that hide them
 * (reportStore.ts): a name hidden after enough reporters shows as the
 * default and a new one shows again; a name the admin allowed stays shown;
 * a locked player shows no name at all; and all of it survives a restart.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileModeration, Moderation } from './moderation.ts';
import { FileReportStore, ReportStore, reportedId } from './reportStore.ts';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane-siege-moderation-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('hidden names', () => {
  it('hides one name, shows the next, and hides every name of a locked player', () => {
    const moderation = new Moderation();
    moderation.hide('zed', 'Rude', 'admin');
    expect(moderation.shownName('zed', 'Rude')).toBe('');
    expect(moderation.shownName('zed', 'Polite')).toBe('Polite');
    moderation.setLocked('zed', true);
    expect(moderation.shownName('zed', 'Polite')).toBe('');
    moderation.setLocked('zed', false);
    expect(moderation.shownName('zed', 'Polite')).toBe('Polite');
    // An empty seat, or a default name, is left as it is.
    expect(moderation.shownName(null, 'Rude')).toBe('Rude');
  });

  it('lets a name the admin allowed stand, however many report it after', () => {
    const moderation = new Moderation();
    const reports = new ReportStore(moderation, 2);
    reports.add('ann', 'zed', 'Edgy', 'lobby');
    expect(reports.add('bo', 'zed', 'Edgy', 'match')).toBe('hidden');
    moderation.allow('zed', 'Edgy');
    expect(moderation.shownName('zed', 'Edgy')).toBe('Edgy');
    expect(reports.add('cai', 'zed', 'Edgy', 'match')).toBe('allowed');
    expect(moderation.shownName('zed', 'Edgy')).toBe('Edgy');
  });

  it('takes a saved build’s seat back to the player who saved it', () => {
    expect(reportedId('ghost:zed')).toBe('zed');
    expect(reportedId('zed')).toBe('zed');
  });

  it('keeps the hidden names and the reports across a restart', () => {
    const dir = tempDir();
    const moderation = new FileModeration(join(dir, 'moderation.json'));
    const reports = new FileReportStore(moderation, join(dir, 'reports.json'), 2);
    reports.add('ann', 'zed', 'Rude', 'match');
    reports.add('bo', 'zed', 'Rude', 'match');
    moderation.setLocked('yo', true);

    const again = new FileModeration(join(dir, 'moderation.json'));
    expect(again.isHidden('zed', 'Rude')).toBe(true);
    expect(again.isLocked('yo')).toBe(true);
    const reportsAgain = new FileReportStore(again, join(dir, 'reports.json'), 2);
    expect(reportsAgain.list()[0]).toMatchObject({
      playerId: 'zed',
      name: 'Rude',
      reporters: ['ann', 'bo'],
    });
    // A reporter counted before the restart is still only counted once.
    expect(reportsAgain.add('ann', 'zed', 'Rude', 'lobby')).toBe('repeat');
  });

  it('forgets a player who asks, and their own reports with them', () => {
    const moderation = new Moderation();
    const reports = new ReportStore(moderation, 5);
    reports.add('ann', 'zed', 'Rude', 'match');
    reports.add('zed', 'bo', 'Bob', 'lobby');
    reports.forget('zed');
    moderation.forget('zed');
    expect(reports.list()).toEqual([expect.objectContaining({ playerId: 'bo', reporters: [] })]);
  });
});
