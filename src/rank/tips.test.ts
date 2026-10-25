import { describe, expect, it } from 'vitest';
import { afterShown, NO_TIPS, pickTip, storyList, type TipContext, type TipState } from './tips';

const base: TipContext = {
  duels: 12,
  ranked: 10,
  onScreen: [],
  newcomerLog: [],
  recent: [],
  movedUp: null,
  knowsOneForm: false,
};
const ctx = (over: Partial<TipContext>): TipContext => ({ ...base, ...over });

describe('tips', () => {
  it('stays quiet in the first duels and when switched off', () => {
    expect(pickTip(NO_TIPS, ctx({ duels: 3, ranked: 30 }))).toBeNull();
    expect(pickTip({ ...NO_TIPS, off: true }, ctx({ ranked: 30 }))).toBeNull();
  });

  it('suggests Split up for a big franchise near the top, once', () => {
    const c = ctx({ onScreen: [{ id: 'f', title: 'Fate', rank: 12, storylines: ['Fate/stay night', 'Prisma Illya', 'Lord El-Melloi II'] }] });
    const tip = pickTip(NO_TIPS, c);
    expect(tip?.id).toBe('split');
    expect(tip?.text).toContain('Fate covers 3 storylines: Fate/stay night, Prisma Illya and Lord El-Melloi II.');
    expect(tip?.text).not.toMatch(/anime|manga/i);
    expect(tip?.open?.itemId).toBe('f');
    expect(pickTip(afterShown(NO_TIPS, tip!, 12), ctx({ ...c, duels: 40 }))).toBeNull();
  });

  it('explains anime or manga once, naming the title, with a button to open it', () => {
    const c = ctx({ unanswered: { id: 'dn', title: 'Death Note' } });
    const tip = pickTip(NO_TIPS, c);
    expect(tip?.id).toBe('forms');
    expect(tip?.text).toContain('Death Note is both anime and manga.');
    expect(tip?.text).toContain('Library → Browse → Anime or manga?');
    expect(tip?.open).toEqual({ itemId: 'dn', label: 'Open Death Note' });
    expect(pickTip(afterShown(NO_TIPS, tip!, 12), ctx({ ...c, duels: 40 }))).toBeNull();
    expect(pickTip(NO_TIPS, ctx({ unanswered: null }))).toBeNull();
  });

  it('ignores big franchises lower down', () => {
    expect(pickTip(NO_TIPS, ctx({ onScreen: [{ id: 'f', title: 'Fate', rank: 80, storylines: ['A', 'B'] }] }))).toBeNull();
  });

  it('stays quiet for a big franchise with one storyline', () => {
    expect(pickTip(NO_TIPS, ctx({ onScreen: [{ id: 'j', title: 'Jujutsu Kaisen', rank: 3, storylines: [] }] }))).toBeNull();
  });

  it('shortens a long list of storylines', () => {
    expect(storyList(['A', 'B', 'C', 'D', 'E'])).toBe('5 storylines, including A, B and C');
    expect(storyList(['A', 'B'])).toBe('2 storylines: A and B');
  });

  it('points to Browse after five passes in a row', () => {
    expect(pickTip(NO_TIPS, ctx({ newcomerLog: [true, false, false, false, false, false] }))?.id).toBe('browse');
    expect(pickTip(NO_TIPS, ctx({ newcomerLog: [false, false, false, true, false] }))).toBeNull();
  });

  it('explains the view switch once you know one form of a title', () => {
    expect(pickTip(NO_TIPS, ctx({ knowsOneForm: true }))?.id).toBe('views');
  });

  it('notes big jumps and heavy tie use', () => {
    expect(pickTip(NO_TIPS, ctx({ movedUp: { title: 'X', places: 9 } }))?.id).toBe('jump');
    expect(pickTip(NO_TIPS, ctx({ movedUp: { title: 'X', places: 3 } }))).toBeNull();
    const recent = [...Array(10).fill('a'), ...Array(5).fill('tie')];
    expect(pickTip(NO_TIPS, ctx({ recent }))?.id).toBe('ties');
  });

  it('introduces For you at 20 ranked and Stats at 30 ranked and 100 duels', () => {
    expect(pickTip(NO_TIPS, ctx({ ranked: 20 }))?.id).toBe('foryou');
    const s: TipState = { ...NO_TIPS, seen: ['foryou'] };
    expect(pickTip(s, ctx({ ranked: 30, duels: 90 }))).toBeNull();
    expect(pickTip(s, ctx({ ranked: 30, duels: 100 }))?.id).toBe('stats');
  });

  it('spaces tips apart', () => {
    const s = afterShown(NO_TIPS, { id: 'foryou', text: '' }, 20);
    expect(pickTip(s, ctx({ duels: 25, knowsOneForm: true }))).toBeNull();
    expect(pickTip(s, ctx({ duels: 30, knowsOneForm: true }))?.id).toBe('views');
  });
});
