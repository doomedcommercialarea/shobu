import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocalStore, toExport, type Snapshot } from '../store/store';
import { saveCopy } from './saveCopy';
import { backupIsDue, snoozed, type BackupNote } from './backup';
import { useInstall } from './install';
import { askPersistence, checkPersisted, PERSIST_AFTER, type Persistence } from './storage';
import { loadCatalogueFile, loadCatalogueVersion, mergeCatalogue } from '../anilist/catalogueFile';
import { isManga, storylinesOf } from '../anilist/group';
import { fit as fitModel, type Fit } from '../rank/solver';
import { NEWCOMER_MIN_P, newcomerShare, nextPair, pairKey, replaceSide, type Newcomer, type Pair } from '../rank/pairs';
import { seenModel } from '../rank/seen';
import { countedVotes, placementPair, placementStatus, setAsideCount, type Placement, type Resets } from '../rank/replace';
import { afterShown, NO_TIPS, pickTip, type Tip, type TipState } from '../rank/tips';
import { applyGroupOps, resolveMarks, resolveVotes, splitId, type GroupOp } from '../anilist/overrides';
import { lookOf, sideFor, type Look } from '../rank/look';
import { cleanName, entryOf, type SentList } from '../rank/listLink';
import { applyAnswer, clearIn, formUnknown, formsOf, hasBoth, inView, knownIn, projectMarks, type Answer } from '../rank/medium';
import { DEFAULT_SETTINGS, type Entry, type Item, type Mark, type Outcome, type Settings, type Status, type View, type Vote } from '../types';

export const store = new LocalStore();

export { BACKUP_AFTER_CHANGES, BACKUP_AFTER_DAYS, type BackupNote } from './backup';

/** Each screen undoes only what was done on it. Grouping changes are undone from Settings. */
export type UndoScope = 'duel' | 'sort';

type UndoEntry = { scope: UndoScope } & (
  | { kind: 'vote'; voteId: number; pair: Pair }
  | { kind: 'mark'; itemId: string; prev?: Mark; pair?: Pair | null }
  | { kind: 'skip'; itemId: string }
  /** A newcomer duel: the vote and the mark that came with it, undone together. */
  | { kind: 'newcomer'; voteId: number; itemIds: string[]; pair: Pair }
);

export interface Moved {
  title: string;
  from: number;
  to: number;
  /** A title that just joined your list from a newcomer duel. */
  isNew?: boolean;
  /** Two titles joined at once (the first duel of a new list). */
  both?: boolean;
}

/** A friend's list, from a link they sent (see listLink.ts). */
export interface Friend extends SentList {
  /** One saved list per name; a new link from the same name replaces the old one. */
  key: string;
  received: number;
}
const MAX_FRIENDS = 20;
const friendKey = (l: SentList) => (l.name ? `n:${l.name.toLowerCase()}` : `l:${l.made ?? ''}:${l.entries.slice(0, 8).join('.')}`);

/** Newcomer outcomes kept for working out how often to bring one in. */
const NEWCOMER_LOG = 20;

/** Whether a fit already made covers exactly these titles and votes (in any order of titles). */
function sameFitInput(pre: { ids: string[]; votes: Vote[] }, ids: string[], votes: Vote[]): boolean {
  if (pre.votes.length !== votes.length) return false;
  for (let i = 0; i < votes.length; i++) {
    const a = pre.votes[i];
    const b = votes[i];
    if (a.a !== b.a || a.b !== b.b || a.outcome !== b.outcome) return false;
  }
  const mine = new Set(pre.ids);
  return mine.size === new Set(ids).size && ids.every((id) => mine.has(id));
}

export function displayTitle(item: Item, settings: Settings) {
  return settings.titleLanguage === 'romaji'
    ? item.titleRomaji ?? item.title
    : item.titleEnglish ?? item.titleRomaji ?? item.title;
}

/** The name of one AniList entry in the chosen title language. */
export function entryName(e: Entry, settings: Settings) {
  return (settings.titleLanguage === 'romaji' ? (e.titleRomaji ?? e.titleEnglish) : (e.titleEnglish ?? e.titleRomaji)) ?? `AniList ${e.id}`;
}

export function useApp() {
  const [ready, setReady] = useState(false);
  // What is stored: the catalogue as built, your marks and votes as recorded, and your grouping changes.
  const [baseItems, setItems] = useState<Item[]>([]);
  const [rawMarks, setMarks] = useState<Map<string, Mark>>(new Map());
  const [rawVotes, setVotes] = useState<Vote[]>([]);
  const [groupOps, setGroupOps] = useState<GroupOp[]>([]);
  /** Re-placed titles: each one's cut-off time; its duels from before it are set aside. */
  const [resets, setResets] = useState<Resets>({});
  /** The re-placed title whose round of duels is under way (or just finished), this session only. */
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [backup, setBackup] = useState<BackupNote | null>(null);
  /** Whether the browser has agreed to keep this data; null until checked. */
  const [persisted, setPersisted] = useState<Persistence | null>(null);
  const { installed } = useInstall();
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [catalogueAt, setCatalogueAt] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [pair, setPair] = useState<Pair | null>(null);
  const [skippedPairs, setSkippedPairs] = useState<Set<string>>(new Set());
  const [moved, setMoved] = useState<Moved | null>(null);
  /** Whether each recent newcomer was a title you'd seen. */
  const [newcomerLog, setNewcomerLog] = useState<boolean[]>([]);
  /** Newcomers skipped this session. */
  const [passed, setPassed] = useState<Set<string>>(new Set());
  /** Titles left unanswered at the last "Later" on the anime-or-manga list; it comes back only for others. */
  const [formsLater, setFormsLater] = useState<string[]>([]);
  /** Which tips have been shown, and whether they're switched off. */
  const [tips, setTips] = useState<TipState>(NO_TIPS);
  /** The tip on screen, and the duel count when it appeared. */
  const [tip, setTip] = useState<(Tip & { at: number }) | null>(null);
  /** Lists friends have sent, newest first, and the name you put on lists you send. */
  const [friends, setFriends] = useState<Friend[]>([]);
  const [myName, setMyNameState] = useState('');
  const friendsRef = useRef<Friend[]>([]);
  friendsRef.current = friends;
  const warm = useRef<Map<string, number> | undefined>(undefined);
  /** The fit a duel just made for its "moved to #N" line, so the ranking doesn't fit the same votes again. */
  const prefit = useRef<{ ids: string[]; votes: Vote[]; fit: Fit } | null>(null);
  /** Goes up whenever all data is replaced, so slow background work can tell its data is gone. */
  const generation = useRef(0);

  const applySnapshot = useCallback((s: Snapshot) => {
    setItems(s.items);
    // "Want to watch" was removed; those titles go back to unsorted.
    const dropped = s.marks.filter((m) => (m.status as string) === 'want');
    for (const m of dropped) store.deleteMark(m.itemId).catch(() => undefined);
    setMarks(new Map(s.marks.filter((m) => !dropped.includes(m)).map((m) => [m.itemId, m])));
    setVotes(s.votes);
    // The "Include manga" switch became the anime / manga / both view.
    const legacy = s.settings as Settings & { manga?: boolean };
    const view: View = legacy.view ?? (legacy.manga === false ? 'anime' : 'both');
    const { manga: _manga, ...rest } = legacy;
    setSettingsState({ ...rest, view });
    setSkipped((s.meta.skipped as string[]) ?? []);
    setDismissed((s.meta.dismissed as string[]) ?? []);
    setNewcomerLog((s.meta.newcomerLog as boolean[]) ?? []);
    setTips({ ...NO_TIPS, ...((s.meta.tips as Partial<TipState>) ?? {}) });
    setTip(null);
    setGroupOps((s.meta.groupOps as GroupOp[]) ?? []);
    setResets((s.meta.resets as Resets) ?? {});
    setPlacement(null);
    setBackup((s.meta.backup as BackupNote) ?? null);
    setCatalogueAt((s.meta.catalogueGeneratedAt as string) ?? null);
    setFriends((s.meta.friends as Friend[]) ?? []);
    setMyNameState((s.meta.myName as string) ?? '');
    setFormsLater((s.meta.formsLater as string[]) ?? []);
    setUndoStack([]);
    setPair(null);
  }, []);

  useEffect(() => {
    // Only the last load counts: in development React runs this twice, and a late first load could
    // otherwise overwrite what was saved in between (a friend's list read from the link, say).
    let live = true;
    store
      .loadAll()
      .then((s) => live && applySnapshot(s))
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [applySnapshot]);

  // What the app works with: titles after your grouping changes, with marks and votes following them.
  const grouping = useMemo(() => applyGroupOps(baseItems, groupOps), [baseItems, groupOps]);
  const allItems = grouping.items;
  const allMarks = useMemo(() => resolveMarks(rawMarks.values(), grouping.resolve), [rawMarks, grouping]);
  const playedVotes = useMemo(() => resolveVotes(rawVotes, grouping.resolveSide), [rawVotes, grouping]);
  /** The duels that count: a re-placed title's duels from before its cut-off are set aside. */
  const votes = useMemo(() => countedVotes(playedVotes, resets), [playedVotes, resets]);
  const itemById = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);

  // The view (anime, manga or both) decides which titles show, and how marks read: in the anime view,
  // a title you've only read counts as not seen.
  const view = settings.view;
  const items = useMemo(() => allItems.filter((i) => inView(i, view)), [allItems, view]);
  const marks = useMemo(() => projectMarks(items, allMarks, view), [items, allMarks, view]);
  /** How a title is shown in this view: the side of it you know. */
  const look = useCallback((item: Item): Look => lookOf(item, sideFor(item, view, allMarks.get(item.id))), [view, allMarks]);

  // One ranking over everything you've seen in any form; each view shows its part of it.
  const seenIds = useMemo(
    () => [...projectMarks(allItems, allMarks, 'both').values()].filter((m) => m.status === 'seen').map((m) => m.itemId),
    [allItems, allMarks],
  );

  const fullFit: Fit = useMemo(() => {
    // A fit from the duel that was just played counts only if it covers exactly these titles and votes; a
    // render in between (marks saved before the vote, say) leaves it waiting for the one that does.
    const pre = prefit.current;
    const f = pre && sameFitInput(pre, seenIds, votes) ? pre.fit : fitModel({ ids: seenIds, anchors: {}, votes, warm: warm.current });
    warm.current = f.theta;
    return f;
  }, [seenIds, votes]);

  const inViewSeen = useCallback((id: string) => marks.get(id)?.status === 'seen', [marks]);
  const fit: Fit = useMemo(() => ({ ...fullFit, order: fullFit.order.filter(inViewSeen) }), [fullFit, inViewSeen]);

  const rankOf = useMemo(() => new Map(fit.order.map((id, i) => [id, i + 1])), [fit]);

  /** Which of your titles holds each AniList entry, for reading a friend's list. */
  const itemOfEntry = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of allItems) for (const e of i.entryIds) m.set(e, i.id);
    return m;
  }, [allItems]);
  /** Your whole ranking (anime and manga together) as AniList entries, for a link to send. */
  const myEntries = useMemo(
    () => fullFit.order.flatMap((id) => {
      const it = itemById.get(id);
      const e = it && entryOf(it);
      return e === undefined ? [] : [e];
    }),
    [fullFit, itemById],
  );

  /** The chance you've seen each unsorted title in this view. Sort's queue and newcomer duels both use it. */
  const seenGuess = useMemo(() => seenModel(items, marks), [items, marks]);

  /** Unsorted titles you've probably seen, likeliest first: candidates for newcomer duels. */
  const newcomers: Newcomer[] = useMemo(() => {
    const later = new Set(skipped);
    return [...seenGuess.probability.entries()]
      .filter(([id]) => !marks.has(id) && !later.has(id) && !passed.has(id))
      .map(([id, p]) => ({ id, p }))
      .sort((x, y) => y.p - x.p)
      .slice(0, 20);
  }, [seenGuess, marks, skipped, passed]);

  /** How many of those newcomer duels would actually offer (the same cut-off the pair picker uses). */
  const newcomersWaiting = useMemo(() => newcomers.filter((c) => c.p >= NEWCOMER_MIN_P).length, [newcomers]);

  // Keep a valid duel ready.
  const isValid = useCallback(
    (p: Pair | null) =>
      !!p &&
      [p.a, p.b].every((id) => (p.fresh?.includes(id) ? !marks.has(id) && itemById.has(id) : rankOf.has(id))),
    [marks, itemById, rankOf],
  );
  /** Where a re-placed title's round stands, and its next duel; null when there is no round. A round with nobody left
   * to ask counts as over. */
  const placing = useMemo(() => {
    if (!placement) return null;
    const status = placementStatus(placement, fit.order, votes);
    const next = placementPair(placement, fit, status, skippedPairs);
    return next ? { ...status, next } : { ...status, done: true, total: status.asked, next: null };
  }, [placement, fit, votes, skippedPairs]);
  const placingNow = !!placing && !placing.done;
  useEffect(() => {
    if (!ready || isValid(pair)) return;
    setPair(
      placing?.next ?? nextPair({ fit, recent: votes, skipped: skippedPairs, newcomers, newcomerShare: newcomerShare(newcomerLog) }),
    );
  }, [ready, pair, isValid, fit, votes, skippedPairs, newcomers, newcomerLog, placing]);

  const logNewcomer = useCallback(
    async (hit: boolean) => {
      const next = [...newcomerLog, hit].slice(-NEWCOMER_LOG);
      setNewcomerLog(next);
      await store.setMeta('newcomerLog', next);
    },
    [newcomerLog],
  );

  /**
   * Titles with an anime and a manga logged as seen without saying which, most recently logged first. Until
   * answered they count as seen in the Anime and Manga views both. Asked about on switching to one of those views.
   */
  const formUnanswered = useMemo(
    () =>
      allItems
        .filter((i) => formUnknown(i, allMarks.get(i.id)))
        .sort((x, y) => (allMarks.get(y.id)?.updatedAt ?? 0) - (allMarks.get(x.id)?.updatedAt ?? 0))
        .map((i) => i.id),
    [allItems, allMarks],
  );
  // Tips: one at a time, when something relevant is on screen. Shown once, then left alone.
  const knowsOneForm = useMemo(
    () => [...allMarks.values()].some((m) => m.anime !== undefined && m.manga !== undefined && m.anime !== m.manga),
    [allMarks],
  );
  // The backup reminder takes the tip slot while it is due, so no tip is used up behind it.
  const size = rawMarks.size + rawVotes.length;
  const backupDue = ready && backupIsDue(size, backup, Date.now());

  // Ask the browser to keep the data once there is something worth keeping, and again once the app is
  // installed (Chrome grants it more readily then).
  const worthKeeping = ready && size >= PERSIST_AFTER;
  useEffect(() => {
    if (!worthKeeping) return;
    let cancelled = false;
    (async () => {
      let now = await checkPersisted();
      if (now === 'no') now = await askPersistence();
      if (!cancelled) setPersisted(now);
    })();
    return () => {
      cancelled = true;
    };
  }, [worthKeeping, installed]);

  useEffect(() => {
    if (!ready) return;
    if (tip && (votes.length < tip.at || votes.length - tip.at >= 2)) return setTip(null);
    if (tip || !pair || backupDue || placingNow) return;
    const next = pickTip(tips, {
      duels: votes.length,
      ranked: fit.order.length,
      onScreen: [pair.a, pair.b].flatMap((id) => {
        const it = itemById.get(id);
        if (!it) return [];
        // One-off spin-offs (a single short series) don't make the tip worth showing.
        const storylines = storylinesOf(it.entries)
          .filter((l) => l.entries.length >= 2)
          .map((l) => entryName(l.lead, settings));
        return [{ id, title: displayTitle(it, settings), rank: rankOf.get(id), storylines }];
      }),
      newcomerLog,
      recent: votes.slice(-15).map((v) => v.outcome),
      movedUp: moved && !moved.isNew && moved.from > moved.to ? { title: moved.title, places: moved.from - moved.to } : null,
      knowsOneForm,
      unanswered: (() => {
        const it = view === 'both' && formUnanswered.length ? itemById.get(formUnanswered[0]) : undefined;
        return it ? { id: it.id, title: displayTitle(it, settings) } : null;
      })(),
    });
    if (!next) return;
    const after = afterShown(tips, next, votes.length);
    setTips(after);
    setTip({ ...next, at: votes.length });
    store.setMeta('tips', after).catch(() => undefined);
  }, [ready, tip, tips, pair, votes, fit, itemById, settings, rankOf, newcomerLog, moved, knowsOneForm, backupDue, placingNow, view, formUnanswered]);

  const changeTips = useCallback(async (next: TipState) => {
    setTips(next);
    setTip(null);
    await store.setMeta('tips', next);
  }, []);

  const pushUndo = (e: UndoEntry) => setUndoStack((s) => [...s.slice(-99), e]);

  /** Writes a mark (or removes it) and records how to undo it. */
  const putMark = useCallback(
    async (itemId: string, next: Mark | undefined, scope: UndoScope, pairNow: Pair | null) => {
      const prev = rawMarks.get(itemId);
      setMarks((m) => {
        const n = new Map(m);
        if (next) n.set(itemId, next);
        else n.delete(itemId);
        return n;
      });
      pushUndo({ scope, kind: 'mark', itemId, prev, pair: pairNow });
      if (next) await store.setMark(next);
      else await store.deleteMark(itemId);
    },
    [rawMarks],
  );

  /**
   * Records an answer about a title: watched and/or read, or not. For a title with one form only the
   * status is kept; for a title with both, the answer is merged with what was known.
   */
  const answer = useCallback(
    async (itemId: string, ans: Answer, scope: UndoScope = 'sort') => {
      const item = itemById.get(itemId);
      if (!item) return;
      await putMark(itemId, applyAnswer(item, allMarks.get(itemId), ans, Date.now()), scope, pair);
    },
    [itemById, allMarks, putMark, pair],
  );

  /** Seen or not, as the current view means it: in the anime view, "seen" means watched. */
  const markItem = useCallback(
    async (itemId: string, status: Status, scope: UndoScope = 'sort') => {
      const item = itemById.get(itemId);
      if (item && hasBoth(item) && view !== 'both') return answer(itemId, { [view]: status === 'seen' }, scope);
      await putMark(itemId, { itemId, status, updatedAt: Date.now() }, scope, pair);
    },
    [itemById, view, answer, putMark, pair],
  );

  const clearMark = useCallback(
    async (itemId: string, scope: UndoScope = 'sort', everything = false) => {
      const item = itemById.get(itemId);
      // In the anime or manga view, clearing a title with both forms clears only that form.
      const partial = item && !everything ? clearIn(item, allMarks.get(itemId), view, Date.now()) : undefined;
      if (partial) return putMark(itemId, partial, scope, pair);
      // Marks left on titles that were joined into this one count for it too, so clear those as well.
      const keys = [...rawMarks.keys()].filter((k) => grouping.resolve(k) === itemId);
      if (keys.length === 0) return;
      setMarks((m) => {
        const n = new Map(m);
        for (const k of keys) n.delete(k);
        return n;
      });
      pushUndo({ scope, kind: 'mark', itemId, prev: rawMarks.get(itemId) ?? allMarks.get(itemId), pair });
      await Promise.all(keys.map((k) => store.deleteMark(k)));
    },
    [itemById, allMarks, view, putMark, rawMarks, grouping, pair],
  );

  const skipSort = useCallback(
    async (itemId: string) => {
      const next = [...skipped.filter((id) => id !== itemId), itemId];
      setSkipped(next);
      pushUndo({ scope: 'sort', kind: 'skip', itemId });
      await store.setMeta('skipped', next);
    },
    [skipped],
  );

  /** The mark for a newcomer you picked in a duel: seen, in the form the view means. */
  const newcomerMark = (item: Item): Mark => {
    const at = Date.now();
    if (view !== 'both') return applyAnswer(item, allMarks.get(item.id), { [view]: true }, at);
    // In the both view a title with both forms could be either; ask afterwards.
    if (hasBoth(item)) return { itemId: item.id, status: 'seen', updatedAt: at };
    return applyAnswer(item, allMarks.get(item.id), { anime: true, manga: true }, at);
  };

  /** The vote to record, with the side of each title the cards showed. */
  const voteFor = (p: Pair, outcome: Outcome): Vote => {
    const side = (id: string) => {
      const it = itemById.get(id);
      return it ? sideFor(it, view, allMarks.get(id)) : undefined;
    };
    return { a: p.a, b: p.b, outcome, mode: p.mode, at: Date.now(), sideA: side(p.a), sideB: side(p.b) };
  };

  const vote = useCallback(
    async (outcome: Outcome) => {
      if (!pair) return;
      // A finished round's last line stays until the next ordinary duel.
      const inRound = !!placement && pair.mode === 'place' && pair.b === placement.id;
      if (placement && !inRound && placing?.done) setPlacement(null);
      if (pair.fresh?.length) {
        const fresh = pair.fresh.map((id) => itemById.get(id)).filter((i): i is Item => !!i);
        if (fresh.length !== pair.fresh.length) return;
        const newMarks = fresh.map(newcomerMark);
        // Save first, then update the marks and the votes together. Setting the marks before the saves let the
        // screen render in between with the newcomer marked but no vote yet: the pair turned invalid, a stop-gap
        // pair was drawn from a half-updated ranking, and a moment later it was replaced (a visible flash).
        await Promise.all(newMarks.map((mk) => store.setMark(mk)));
        const v = voteFor(pair, outcome);
        const id = await store.addVote(v);
        const saved = { ...v, id };
        const nextVotes = [...votes, saved];
        setMarks((m) => {
          const n = new Map(m);
          for (const mk of newMarks) n.set(mk.itemId, mk);
          return n;
        });
        setVotes((vs) => [...vs, saved]);
        pushUndo({ scope: 'duel', kind: 'newcomer', voteId: id, itemIds: fresh.map((i) => i.id), pair });
        logNewcomer(true);
        const freshIds = new Set(fresh.map((i) => i.id));
        const ids = [...seenIds, ...freshIds];
        const after = fitModel({ ids, anchors: {}, votes: nextVotes, warm: warm.current });
        prefit.current = { ids, votes: nextVotes, fit: after };
        const order = after.order.filter((x) => freshIds.has(x) || inViewSeen(x));
        // The one that joined; with two new titles, the winner (or the first, on a tie).
        const shown = fresh.length === 1 ? fresh[0] : (fresh.find((i) => i.id === (outcome === 'a' ? pair.a : pair.b)) ?? fresh[0]);
        const to = order.indexOf(shown.id) + 1;
        setMoved({
          title: fresh.length === 2 ? `${displayTitle(fresh[0], settings)} and ${displayTitle(fresh[1], settings)}` : displayTitle(shown, settings),
          from: to,
          to,
          isNew: true,
          both: fresh.length === 2,
        });
        setPair(null);
        return;
      }
      const winner = outcome === 'a' ? pair.a : outcome === 'b' ? pair.b : null;
      // In a re-placed title's round, the line under the buttons says where it stands, so no "moved" line.
      const focus = inRound ? placement.id : winner;
      const before = focus ? rankOf.get(focus) : undefined;
      const v = voteFor(pair, outcome);
      const id = await store.addVote(v);
      const saved = { ...v, id };
      const nextVotes = [...votes, saved];
      setVotes((vs) => [...vs, saved]);
      pushUndo({ scope: 'duel', kind: 'vote', voteId: id, pair });
      if (focus && before !== undefined) {
        const after = fitModel({ ids: seenIds, anchors: {}, votes: nextVotes, warm: warm.current });
        prefit.current = { ids: seenIds, votes: nextVotes, fit: after };
        const to = after.order.filter(inViewSeen).indexOf(focus) + 1;
        setMoved(inRound ? null : { title: displayTitle(itemById.get(focus)!, settings), from: before, to });
      } else setMoved(null);
      setPair(null);
    },
    [pair, rankOf, votes, seenIds, inViewSeen, itemById, settings, view, allMarks, logNewcomer, placement, placing],
  );

  /**
   * "Haven't seen" on one side of a duel. The other side stays where it is and gets a new partner, so a title
   * you could answer about doesn't disappear with the one you couldn't.
   */
  const notSeenInDuel = useCallback(
    async (itemId: string) => {
      if (!pair) return;
      if (pair.fresh?.includes(itemId)) logNewcomer(false);
      // In a round, the title being placed going unseen ends the round; an opponent going unseen gets replaced by
      // the round's next pick (the effect above).
      if (placement && pair.mode === 'place' && pair.b === placement.id) {
        if (itemId === placement.id) setPlacement(null);
        setPair(null);
      }
      // Set the next duel first; the mark below records this one for undo.
      else setPair(replaceSide({ fit, recent: votes, skipped: skippedPairs, newcomers }, pair, itemId));
      setMoved(null);
      await markItem(itemId, 'unseen', 'duel');
    },
    [pair, fit, votes, skippedPairs, newcomers, logNewcomer, markItem, placement],
  );

  /** Leave the anime-or-manga list for now; it comes back when other titles join it. */
  const laterForms = useCallback(async () => {
    setFormsLater(formUnanswered);
    await store.setMeta('formsLater', formUnanswered);
  }, [formUnanswered]);

  const skipPair = useCallback(() => {
    if (!pair) return;
    if (pair.fresh) {
      const fresh = pair.fresh;
      setPassed((s) => new Set([...s, ...fresh]));
    }
    setSkippedPairs((s) => new Set(s).add(pairKey(pair.a, pair.b)));
    setMoved(null);
    setPair(null);
  }, [pair]);

  const undo = useCallback(async (scope: UndoScope) => {
    const at = undoStack.map((e) => e.scope).lastIndexOf(scope);
    if (at < 0) return;
    const last = undoStack[at];
    setUndoStack((s) => s.filter((_, i) => i !== at));
    setMoved(null);
    if (last.kind === 'vote') {
      setVotes((vs) => vs.filter((v) => v.id !== last.voteId));
      setPair(last.pair);
      await store.deleteVote(last.voteId);
    } else if (last.kind === 'newcomer') {
      setVotes((vs) => vs.filter((v) => v.id !== last.voteId));
      setMarks((m) => {
        const n = new Map(m);
        for (const id of last.itemIds) n.delete(id);
        return n;
      });
      setPair(last.pair);
      await store.deleteVote(last.voteId);
      await Promise.all(last.itemIds.map((id) => store.deleteMark(id)));
    } else if (last.kind === 'mark') {
      if (last.prev) {
        const prev = last.prev;
        setMarks((m) => new Map(m).set(last.itemId, prev));
        await store.setMark(prev);
      } else {
        setMarks((m) => {
          const n = new Map(m);
          n.delete(last.itemId);
          return n;
        });
        await store.deleteMark(last.itemId);
      }
      if (last.pair !== undefined) setPair(last.pair);
    } else {
      const next = skipped.filter((id) => id !== last.itemId);
      setSkipped(next);
      await store.setMeta('skipped', next);
    }
  }, [undoStack, skipped]);

  /** Hide a title from For you. Stored by entry ids so it survives regrouping. */
  const dismiss = useCallback(
    async (itemId: string, hide: boolean) => {
      const entryIds = itemById.get(itemId)?.entryIds ?? [];
      const keys = entryIds.map(String);
      const next = hide ? [...new Set([...dismissed, ...keys])] : dismissed.filter((k) => !keys.includes(k));
      setDismissed(next);
      await store.setMeta('dismissed', next);
    },
    [dismissed, itemById],
  );

  const setSettings = useCallback(async (s: Settings) => {
    setSettingsState(s);
    await store.setSettings(s);
  }, []);

  const saveItems = useCallback(async (next: Item[]) => {
    // Stored first: on first launch this is the whole catalogue, and showing it before the write finishes
    // lets your first answers queue behind it for a few seconds.
    await store.putItems(next);
    setItems((cur) => {
      const map = new Map(cur.map((i) => [i.id, i]));
      for (const i of next) map.set(i.id, i);
      return [...map.values()];
    });
  }, []);

  /**
   * Brings in the catalogue shipped with the site. Without `force`, does
   * nothing unless the shipped file is newer than the one last merged.
   * Returns how many titles were new to this device.
   */
  const syncCatalogue = useCallback(
    async (force = false) => {
      const gen = generation.current;
      // Most launches have nothing new: check the small version file before downloading the catalogue.
      if (!force && catalogueAt) {
        const version = await loadCatalogueVersion();
        if (version && version <= catalogueAt) return 0;
      }
      const file = await loadCatalogueFile();
      if (!force && catalogueAt && file.generatedAt <= catalogueAt) return 0;
      // A copy was loaded or everything deleted while the file downloaded: this merge is for data that's gone.
      if (gen !== generation.current) return 0;
      const known = new Set(baseItems.map((i) => i.id));
      const merged = mergeCatalogue(baseItems, file.items);
      await saveItems(merged);
      await store.setMeta('catalogueGeneratedAt', file.generatedAt);
      setCatalogueAt(file.generatedAt);
      return merged.filter((i) => !known.has(i.id)).length;
    },
    [baseItems, catalogueAt, saveItems],
  );

  const replaceAll = useCallback(
    async (s: Snapshot) => {
      generation.current++;
      // Bring the copy's titles up to date with the catalogue this site ships, so an older copy gets
      // the newer titles (and manga) straight away.
      let snapshot = s;
      try {
        const file = await loadCatalogueFile();
        if (!s.meta.catalogueGeneratedAt || file.generatedAt > (s.meta.catalogueGeneratedAt as string)) {
          const merged = mergeCatalogue(s.items, file.items);
          const byId = new Map(s.items.map((i) => [i.id, i]));
          for (const i of merged) byId.set(i.id, i);
          snapshot = { ...s, items: [...byId.values()], meta: { ...s.meta, catalogueGeneratedAt: file.generatedAt } };
        }
      } catch {
        // Offline: keep the copy as it is; the next launch brings the catalogue in.
      }
      await store.replaceAll(snapshot);
      applySnapshot(await store.loadAll());
      // A list loaded from a file is, by definition, saved in that file.
      const note: BackupNote = { at: Date.now(), size: s.marks.length + s.votes.length };
      setBackup(note);
      await store.setMeta('backup', note);
    },
    [applySnapshot],
  );

  const resetAll = useCallback(async () => {
    generation.current++;
    await store.clearAll();
    warm.current = undefined;
    applySnapshot({ items: [], marks: [], votes: [], settings, meta: {} });
  }, [applySnapshot, settings]);

  const snapshot = useCallback(
    (): Snapshot => ({
      items: baseItems,
      marks: [...rawMarks.values()],
      votes: rawVotes,
      settings,
      meta: { skipped, dismissed, newcomerLog, tips, groupOps, resets, friends, myName, formsLater, ...(catalogueAt ? { catalogueGeneratedAt: catalogueAt } : {}) },
    }),
    [baseItems, rawMarks, rawVotes, settings, skipped, dismissed, newcomerLog, tips, groupOps, resets, friends, myName, formsLater, catalogueAt],
  );

  /** Keeps a friend's list; returns its key. */
  const addFriend = useCallback(async (list: SentList) => {
    const key = friendKey(list);
    // Where the link opened is about that visit, not the list.
    const { at: _at, ...kept } = list;
    const friend: Friend = { ...kept, key, received: Date.now() };
    const next = [friend, ...friendsRef.current.filter((f) => f.key !== key)].slice(0, MAX_FRIENDS);
    friendsRef.current = next;
    setFriends(next);
    await store.setMeta('friends', next);
    return key;
  }, []);

  const removeFriend = useCallback(async (key: string) => {
    const next = friendsRef.current.filter((f) => f.key !== key);
    friendsRef.current = next;
    setFriends(next);
    await store.setMeta('friends', next);
  }, []);

  const setMyName = useCallback(async (name: string) => {
    const n = cleanName(name) ?? '';
    setMyNameState(n);
    await store.setMeta('myName', n);
  }, []);

  /** Saves a copy of everything to a file (the share sheet on phones). */
  const saveBackup = async () => {
    const name = `shobu-${new Date().toISOString().slice(0, 10)}.json`;
    const result = await saveCopy(name, JSON.stringify(toExport(snapshot())));
    if (result !== 'cancelled') {
      const note: BackupNote = { at: Date.now(), size };
      setBackup(note);
      await store.setMeta('backup', note);
    }
    return result;
  };

  const snoozeBackup = async () => {
    const note = snoozed(backup, Date.now());
    setBackup(note);
    await store.setMeta('backup', note);
  };

  // Saved before the screen changes, so whoever asked for the change can show its result in the same update.
  const saveOps = async (next: GroupOp[]) => {
    await store.setMeta('groupOps', next);
    setGroupOps(next);
  };

  async function writeMark(itemId: string, mark: Mark | null) {
    setMarks((m) => {
      const n = new Map(m);
      if (mark) n.set(itemId, mark);
      else n.delete(itemId);
      return n;
    });
    if (mark) await store.setMark(mark);
    else await store.deleteMark(itemId);
  }

  /**
   * Joins `otherId` into `keepId`. The joined title's duels count for the one kept; duels between
   * the two are set aside. If either was marked seen, the result is seen.
   */
  const joinItems = async (keepId: string, otherId: string) => {
    const keep = itemById.get(keepId);
    const other = itemById.get(otherId);
    if (!keep || !other || keepId === otherId) return;
    const now = Date.now();
    const keepMark = rawMarks.get(keepId);
    const otherMark = rawMarks.get(otherId) ?? null;
    const op: GroupOp = {
      kind: 'join',
      keep: keep.entryIds[0],
      other: other.entryIds[0],
      at: now,
      otherMark,
      keepMark: keepMark ?? null,
      label: `${displayTitle(other, settings)} into ${displayTitle(keep, settings)}`,
    };
    const either = [marks.get(keepId)?.status, marks.get(otherId)?.status];
    const status: Status | null = either.includes('seen') ? 'seen' : either.includes('unseen') ? 'unseen' : null;
    if (status && status !== keepMark?.status) await writeMark(keepId, { itemId: keepId, status, updatedAt: now });
    if (otherMark) await writeMark(otherId, null);
    setMoved(null);
    await saveOps([...groupOps, op]);
  };

  /** Moves the given entries of a title into a title of their own, unmarked. Returns its id. */
  /**
   * Moves groups of a title's entries into titles of their own (one new title per group). Returns their ids.
   * Past duels stay with the original. A new title that is all anime or all manga takes its mark from what
   * you said about that form of the original, if anything; otherwise it starts unmarked.
   */
  const splitItem = async (itemId: string, groups: number[][]) => {
    const item = itemById.get(itemId);
    const moving = groups.flat();
    if (!item || moving.length === 0 || moving.length >= item.entryIds.length || groups.some((g) => g.length === 0)) return [];
    const parentMark = allMarks.get(itemId);
    const taken = new Set(groupOps.flatMap((o) => (o.kind !== 'join' ? [o.id] : [])));
    const ops: GroupOp[] = [];
    const ids: string[] = [];
    const now = Date.now();
    for (const [n, entryIds] of groups.entries()) {
      const id = splitId(entryIds, (x) => itemById.has(x) || taken.has(x));
      taken.add(id);
      ids.push(id);
      const names = (item.entries ?? []).filter((e) => entryIds.includes(e.id)).map((e) => e.titleEnglish ?? e.titleRomaji);
      ops.push({
        kind: 'split',
        entryIds,
        id,
        at: now + n,
        label: `${names[0] ?? 'Part'}${names.length > 1 ? ` and ${names.length - 1} more` : ''} out of ${displayTitle(item, settings)}`,
      });
      const formats = (item.entries ?? []).filter((e) => entryIds.includes(e.id)).map((e) => e.format);
      const forms = formsOf({ formats });
      if (forms.anime !== forms.manga) {
        const known = knownIn(item, parentMark, forms.anime ? 'anime' : 'manga');
        if (known !== undefined && parentMark && (parentMark.anime !== undefined || parentMark.manga !== undefined)) {
          await writeMark(id, { itemId: id, status: known ? 'seen' : 'unseen', updatedAt: now });
        }
      }
    }
    setMoved(null);
    await saveOps([...groupOps, ...ops]);
    return ids;
  };

  /** Whether a title can be ranked as anime and manga apart: it has both, and you know both. */
  const canRankApart = (itemId: string) => {
    const item = itemById.get(itemId);
    if (!item || !hasBoth(item) || grouping.apart.has(itemId)) return false;
    const entries = item.entries ?? [];
    if (!entries.some((e) => isManga(e.format)) || !entries.some((e) => !isManga(e.format))) return false;
    // Said in so many words: a plain "seen" from before forms were asked doesn't count.
    const mark = allMarks.get(itemId);
    return mark?.anime === true && mark?.manga === true;
  };

  /**
   * Makes a title two: its anime keeps the id, its manga becomes a title of its own, marked read. Past duels
   * follow the side the card showed. Doing it again after ranking them together reuses the same operation,
   * so the manga part gets its own duels back.
   */
  const rankApart = async (itemId: string) => {
    const item = itemById.get(itemId);
    if (!item || !canRankApart(itemId)) return undefined;
    const anime = (item.entries ?? []).filter((e) => !isManga(e.format));
    const now = Date.now();
    const old = groupOps.find((o) => o.kind === 'forms' && item.entryIds.includes(o.of));
    let op: GroupOp;
    let next: GroupOp[];
    if (old && old.kind === 'forms') {
      op = { ...old, together: false, at: now };
      next = groupOps.map((o) => (o === old ? op : o));
    } else {
      const of = Math.min(...anime.map((e) => e.id));
      const taken = (x: string) => itemById.has(x) || groupOps.some((o) => o.kind !== 'join' && o.id === x);
      let id = `f-${of}`;
      for (let n = 2; taken(id); n++) id = `f-${of}-${n}`;
      op = { kind: 'forms', of, id, at: now, label: displayTitle(item, settings) };
      next = [...groupOps, op];
    }
    await writeMark(op.id, { itemId: op.id, status: 'seen', updatedAt: now });
    setMoved(null);
    await saveOps(next);
    return op.id;
  };

  /** Puts a title ranked apart back together. Its mark says what you said about each part. */
  const rankTogether = async (itemId: string) => {
    const other = grouping.apart.get(itemId);
    const op = groupOps.find((o) => o.kind === 'forms' && !o.together && (o.id === itemId || o.id === other));
    if (!other || !op || op.kind !== 'forms') return undefined;
    const animeId = op.id === itemId ? other : itemId;
    const animeItem = itemById.get(animeId);
    const mangaItem = itemById.get(op.id);
    const now = Date.now();
    await saveOps(groupOps.map((o) => (o === op ? { ...op, together: true, at: now } : o)));
    if (animeItem && mangaItem) {
      const watched = knownIn(animeItem, allMarks.get(animeId), 'anime');
      const read = knownIn(mangaItem, allMarks.get(op.id), 'manga');
      const whole = { id: animeId, formats: [...animeItem.formats, ...mangaItem.formats] };
      const ans: Answer = {};
      if (watched !== undefined) ans.anime = watched;
      if (read !== undefined) ans.manga = read;
      if (watched !== undefined || read !== undefined) await writeMark(animeId, applyAnswer(whole, undefined, ans, now));
    }
    setMoved(null);
    return animeId;
  };

  /**
   * Re-places a title: its duels so far are set aside, and Duel runs a short round to find its place. Doing it again
   * moves the cut-off to now, so the last round's duels are set aside too.
   */
  const replaceTitle = async (itemId: string) => {
    if (!rankOf.has(itemId)) return;
    const now = Date.now();
    const next = { ...resets, [itemId]: now };
    await store.setMeta('resets', next);
    setResets(next);
    setPlacement({ id: itemId, since: now, from: rankOf.get(itemId), others: fit.order.filter((id) => id !== itemId) });
    setMoved(null);
    setTip(null);
    setPair(null);
  };

  /** Counts a re-placed title's earlier duels again, alongside any played since. */
  const restoreDuels = async (itemId: string) => {
    if (resets[itemId] === undefined) return;
    const { [itemId]: _gone, ...next } = resets;
    await store.setMeta('resets', next);
    setResets(next);
    if (placement?.id === itemId) {
      setPlacement(null);
      setPair(null);
    }
    setMoved(null);
  };

  /** Leaves a round before it ends; the duels answered so far still count. */
  const stopPlacement = () => {
    setPlacement(null);
    setMoved(null);
    setPair(null);
  };

  /** Takes a grouping change back out. A joined title gets its old mark back. */
  async function removeGroupOp(op: GroupOp) {
    if (op.kind === 'forms') {
      const m = grouping.apart.get(op.id);
      if (m) await rankTogether(op.id);
      return;
    }
    const next = groupOps.filter((o) => o !== op && !(o.at === op.at && o.kind === op.kind && (o.kind !== 'split' || o.id === (op as { id?: string }).id)));
    await saveOps(next);
    if (op.kind === 'join') {
      if (op.otherMark && !rawMarks.has(op.otherMark.itemId)) await writeMark(op.otherMark.itemId, op.otherMark);
      // The kept title's mark goes back to what it was before the join, unless it was changed since.
      const keepId = [...baseItems].find((i) => i.entryIds.includes(op.keep))?.id;
      if (keepId && op.keepMark !== undefined && rawMarks.get(keepId)?.updatedAt === op.at) await writeMark(keepId, op.keepMark);
    }
  }

  return {
    ready,
    items,
    itemById,
    marks,
    votes,
    settings,
    skipped,
    fit,
    rankOf,
    pair,
    moved,
    canUndo: (scope: UndoScope) => undoStack.some((e) => e.scope === scope),
    markItem,
    answer,
    allItems,
    allMarks,
    view,
    seenIds,
    clearMark,
    skipSort,
    seenGuess,
    newcomersWaiting,
    notSeenInDuel,
    tip,
    dismissTip: () => setTip(null),
    tips,
    changeTips,
    formUnanswered,
    formsLater,
    laterForms,
    dismissed,
    dismiss,
    vote,
    skipPair,
    undo,
    setSettings,
    saveItems,
    syncCatalogue,
    catalogueAt,
    replaceAll,
    resetAll,
    snapshot,
    title: (item: Item) => displayTitle(item, settings),
    look,
    baseItems,
    groupOps,
    backup,
    backupDue,
    persisted,
    saveBackup,
    snoozeBackup,
    resolveId: grouping.resolve,
    joinItems,
    splitItem,
    removeGroupOp,
    resets,
    /** How many of a title's duels its cut-off sets aside. */
    setAsideOf: (id: string) => setAsideCount(playedVotes, resets, id),
    replaceTitle,
    restoreDuels,
    placement,
    placing,
    stopPlacement,
    /** Every duel played, including those set aside. */
    duelsPlayed: playedVotes.length,
    apart: grouping.apart,
    canRankApart,
    rankApart,
    rankTogether,
    /** Your whole ranking, anime and manga together, whatever the view. */
    fullOrder: fullFit.order,
    itemOfEntry,
    myEntries,
    friends,
    addFriend,
    removeFriend,
    myName,
    setMyName,
  };
}

export type AppState = ReturnType<typeof useApp>;
