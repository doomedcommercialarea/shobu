import { useEffect, useRef, useState } from 'react';
import { PLACED_AFTER, type Pair } from '../rank/pairs';
import { NICHE_HINT, showNicheHint } from '../rank/nicheHint';
import type { Look } from '../rank/look';
import type { Item, Outcome } from '../types';
import { BackupNote } from './BackupNote';
import { Cover, coverSrc, preloadCover } from './Cover';
import { TitleLink } from './TitleLink';
import { viewWords } from './meta';
import type { AppState } from './useApp';

/** When the vote is cast: once the chosen cover has finished swelling (160 ms in styles.css). Working out the next
 * pair keeps the page busy for a moment, so it waits until nothing is moving. */
const VOTE_AFTER_MS = 170;
/** From the tap, the longest the next pair waits for its covers before it comes in anyway. */
const MAX_WAIT_MS = 700;

/**
 * The duel is a fixed stage: the question, the vs and the buttons stay put. On a pick the chosen cover swells and
 * the other dims; the vote is cast once that has settled; the next pair is held back until its covers are loaded;
 * then each side's cover crossfades into the next one in place, while the swell and the dimming ease back.
 */
export function Duel({ app, onLibrary, onOpen }: { app: AppState; onLibrary: () => void; onOpen: (id: string) => void }) {
  const [picked, setPicked] = useState<Outcome | null>(null);
  // The pair that was picked, shown until the next one is ready, and when the pick was made.
  const [heldPair, setHeldPair] = useState<Pair | null>(null);
  const pickRef = useRef<{ key: string; at: number } | null>(null);
  const next = app.pair;
  const nextKey = next ? `${next.a}|${next.b}` : '';
  const pair = picked && heldPair ? heldPair : next;
  const fresh = pair?.fresh ?? [];
  const a = pair ? app.itemById.get(pair.a) : undefined;
  const b = pair ? app.itemById.get(pair.b) : undefined;

  function choose(outcome: Outcome) {
    if (!pair || picked) return;
    pickRef.current = { key: nextKey, at: performance.now() };
    setHeldPair(pair);
    setPicked(outcome);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => app.vote(outcome), reduced ? 0 : VOTE_AFTER_MS);
  }

  // Once the next pair has been chosen, let it in when its covers are loaded, or at MAX_WAIT_MS from the tap.
  // The cap also ends a pick whose vote changed nothing.
  useEffect(() => {
    const p = pickRef.current;
    if (!picked || !p) return;
    let live = true;
    const release = () => {
      if (!live) return;
      live = false;
      pickRef.current = null;
      setPicked(null);
      setHeldPair(null);
    };
    const cap = window.setTimeout(release, Math.max(0, p.at + MAX_WAIT_MS - performance.now()));
    const na = next ? app.itemById.get(next.a) : undefined;
    const nb = next ? app.itemById.get(next.b) : undefined;
    if (na && nb && nextKey !== p.key) {
      Promise.all([preloadCover(app.look(na)), preloadCover(app.look(nb))]).then(release);
    }
    return () => {
      live = false;
      window.clearTimeout(cap);
    };
    // Only the pick and the arrival of the next pair matter here.
  }, [picked, nextKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Not while a title card or the anime-or-manga list is open over the duel.
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || document.querySelector('[aria-modal="true"]')) return;
      // Nothing else while a pick is under way.
      if (picked) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(e.key)) e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft') choose('a');
      else if (e.key === 'ArrowRight') choose('b');
      else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 't') choose('tie');
      else if (e.key.toLowerCase() === 's') app.skipPair();
      else if (e.key.toLowerCase() === 'n' && fresh.length === 1 && !picked) app.notSeenInDuel(fresh[0]);
      else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') app.undo('duel');
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!a || !b) {
    return (
      <main className="screen empty">
        <h2>Nothing to compare</h2>
        <p>There are no titles left to bring in. Add one from the Library and duels start again.</p>
        <button className="btn btn-primary" onClick={onLibrary}>
          Go to the Library
        </button>
      </main>
    );
  }
  const starting = app.votes.length === 0;

  // A new #1 once the list has 10 titles (before that the top changes every few duels): a title that moved into
  // the top spot, or a single title that joined there.
  const toTop = !!app.moved && app.moved.to === 1 && app.fit.order.length >= 10 && (app.moved.isNew ? !app.moved.both : app.moved.from !== 1);
  const placing = app.fit.order.filter((id) => (app.fit.duels.get(id) ?? 0) < PLACED_AFTER).length;
  const side = (item: Item, outcome: 'a' | 'b') => {
    const title = app.title(item);
    const look = app.look(item);
    const isNew = fresh.includes(item.id);
    const state = picked === outcome ? 'won' : picked && picked !== 'tie' ? 'lost' : picked === 'tie' ? 'tied' : '';
    return (
      <div className={`contender ${state}`}>
        <button className="contender-pick" onClick={() => choose(outcome)} aria-label={`Pick ${title}`}>
          <DuelCover look={look} title={title} />
          <span key={item.id} className={`contender-rank${isNew ? ' is-new' : ''}`}>
            {isNew ? 'New' : `#${app.rankOf.get(item.id)}`}
          </span>
        </button>
        <div className="contender-text" key={item.id}>
          <TitleLink title={title} onOpen={() => onOpen(item.id)} />
          <p className="item-meta">{look.meta}</p>
        </div>
        <button
          className="btn btn-quiet btn-small"
          onClick={() => {
            if (!picked) app.notSeenInDuel(item.id);
          }}
          title={isNew ? 'Key N' : undefined}
        >
          {viewWords(app.view).unseen}
        </button>
      </div>
    );
  };

  const view = (
    <main className="screen duel">
      <p className="duel-question">Which do you prefer?</p>
      <div className="arena">
        {side(a, 'a')}
        <div className="vs" aria-hidden="true">
          vs
        </div>
        {side(b, 'b')}
      </div>
      <div className="action-row">
        <button className="btn" onClick={() => choose('tie')} title="Down arrow or T">
          Too close to call
        </button>
        <button className="btn btn-quiet" onClick={() => !picked && app.skipPair()} title="Key S">
          Skip
        </button>
        <button className="btn btn-quiet" onClick={() => !picked && app.undo('duel')} disabled={!app.canUndo('duel')} title="Key Z">
          Undo
        </button>
      </div>
      {app.placement && app.placing ? (
        <PlacingLine app={app} />
      ) : app.backupDue ? (
        <BackupNote app={app} />
      ) : app.tip ? (
        <div className="tip" role="status">
          <p>
            <span className="note-label">Tip</span>
            {app.tip.text}
          </p>
          <div className="tip-actions">
            {app.tip.open && (
              <button
                className="btn btn-small"
                onClick={() => {
                  onOpen(app.tip!.open!.itemId);
                  app.dismissTip();
                }}
              >
                {app.tip.open.label}
              </button>
            )}
            <button className="btn btn-quiet btn-small" onClick={app.dismissTip}>
              Got it
            </button>
          </div>
        </div>
      ) : null}
      {app.placement || app.backupDue || app.tip ? null : (
        // Always present, so the lines below don't jump when a newcomer duel comes and goes.
        <p className="hint newcomer-hint">
          {fresh.length === 2 ? (
            <span key="two">
              {starting ? 'Your list starts here. ' : ''}Pick the one you prefer, or press Haven't seen under one you don't know.
            </span>
          ) : fresh.length === 1 ? (
            <span key="one">New to your list. Pick as usual if you know it.</span>
          ) : showNicheHint(app.newcomersWaiting, app.votes.length) ? (
            <span key="niche">
              {NICHE_HINT}{' '}
              <button className="btn-link inline" onClick={onLibrary}>
                Library
              </button>
              .
            </span>
          ) : null}
        </p>
      )}
      <p className={`moved${toTop ? ' is-top' : ''}`} aria-live="polite">
        {app.moved && (
          <span key={`${app.votes.length}|${app.moved.title}|${app.moved.to}`}>
            {(toTop ? (
            <span className="top-burst" key={`${app.moved.title}|${app.moved.from}`}>
              {app.moved.isNew ? `${app.moved.title} joins your list at #1.` : `${app.moved.title} takes the top spot (was #${app.moved.from}).`}
            </span>
          ) : app.moved.isNew
            ? app.moved.both
              ? `${app.moved.title} join your list.`
              : `${app.moved.title} joins your list at #${app.moved.to}.`
            : app.moved.to < app.moved.from
            ? `${app.moved.title} moved up to #${app.moved.to} (was #${app.moved.from}).`
            : app.moved.to > app.moved.from
              ? `${app.moved.title} moved down to #${app.moved.to}.`
              : `${app.moved.title} stays at #${app.moved.to}.`)}
          </span>
        )}
      </p>
      <p className="progress-line">
        {app.duelsPlayed.toLocaleString()} {app.duelsPlayed === 1 ? 'duel' : 'duels'}
        {placing > 0 ? `, ${placing} still being placed` : ''}
      </p>
      <p className="keys">Keys: ← → pick, ↓ too close, S skip, Z undo{fresh.length === 1 ? ', N haven\'t seen the new one' : ''}</p>
    </main>
  );
  return view;
}

/**
 * The line under the buttons while a re-placed title is being placed: which duel of how many, and a way out. Once the
 * round is over, where it landed, until the next ordinary duel.
 */
function PlacingLine({ app }: { app: AppState }) {
  const p = app.placement!;
  const status = app.placing!;
  const item = app.itemById.get(p.id);
  if (!item) return <p className="hint newcomer-hint" />;
  const title = app.title(item);
  const rank = app.rankOf.get(p.id);
  if (status.done) {
    return (
      <p className="hint newcomer-hint placing-line">
        <span key="placed">
          {rank === undefined
            ? `${title} is off your list in this view.`
            : `${title} placed at #${rank}${p.from !== undefined && p.from !== rank ? ` (was #${p.from})` : ''}.`}
        </span>
      </p>
    );
  }
  return (
    <p className="hint newcomer-hint placing-line">
      <span key="placing">
        Placing <b>{title}</b> · {status.asked + 1} of {status.total}{' '}
        <button className="btn-link inline" onClick={app.stopPlacement}>
          Stop
        </button>
      </span>
    </p>
  );
}

/**
 * A duel cover that turns into the next title's cover in place: the new picture fades in over the old one, then
 * the old one is dropped. The first cover just appears.
 */
function DuelCover({ look, title }: { look: Look; title: string }) {
  const src = coverSrc(look, 'lg') ?? '';
  const [layers, setLayers] = useState(() => [{ id: 0, look, title, src }]);
  const top = layers[layers.length - 1];
  if (top.src !== src || top.title !== title) setLayers([top, { id: top.id + 1, look, title, src }]);
  return (
    <div className="duel-cover">
      {layers.map((l, i) => (
        <div
          key={l.id}
          className={`duel-cover-layer${l.id > 0 && i === layers.length - 1 ? ' is-entering' : ''}`}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && i === layers.length - 1) setLayers((ls) => ls.slice(-1));
          }}
        >
          <Cover look={l.look} title={l.title} size="lg" />
        </div>
      ))}
    </div>
  );
}
