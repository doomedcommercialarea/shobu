import { useEffect, useRef, useState } from 'react';
import { VIEW_LABEL } from '../rank/medium';
import { useDialogFocus } from './dialogFocus';
import type { AppState } from './useApp';

/**
 * On switching to the Anime or Manga view: titles that are both anime and manga, logged as seen without saying
 * which. Until answered they count as seen in both views. Later leaves them; the list comes back only when other
 * titles join it. Duels in the Both view never stop for this.
 */
export function FormCheck({ app }: { app: AppState }) {
  const pending = app.formUnanswered;
  const fresh = pending.filter((id) => !app.formsLater.includes(id));
  const asks = app.view !== 'both' && fresh.length > 0;
  // Once open, it stays until every title is answered or Later is tapped.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (asks) setOpen(true);
  }, [asks]);
  useEffect(() => {
    if (pending.length === 0) setOpen(false);
  }, [pending.length]);
  if (!open || pending.length === 0) return null;
  return <FormSheet app={app} ids={pending} onLater={() => { setOpen(false); app.laterForms(); }} />;
}

function FormSheet({ app, ids, onLater }: { app: AppState; ids: string[]; onLater: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  useDialogFocus(sheet);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onLater();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLater]);
  const n = ids.length;
  const view = VIEW_LABEL[app.view];
  return (
    <div className="sheet-backdrop">
      <div ref={sheet} tabIndex={-1} className="sheet form-check" role="dialog" aria-modal="true" aria-labelledby="form-check-title">
        <button className="sheet-close btn btn-quiet btn-small" onClick={onLater}>
          Later
        </button>
        <h2 id="form-check-title">Anime or manga?</h2>
        <p className="hint">
          {n === 1 ? 'This title is' : `These ${n} titles are`} logged as seen without saying whether it was the anime or the manga.
          Until you answer, {n === 1 ? 'it counts' : 'they count'} as seen in the {view} view.
        </p>
        <ul className="form-list">
          {ids.map((id) => {
            const it = app.itemById.get(id);
            if (!it) return null;
            const title = app.title(it);
            return (
              <li key={id}>
                <span>{title}</span>
                <span className="form-choices" role="group" aria-label={title}>
                  <button className="btn btn-small" onClick={() => app.answer(id, { anime: true, manga: false })}>
                    Anime
                  </button>
                  <button className="btn btn-small" onClick={() => app.answer(id, { anime: false, manga: true })}>
                    Manga
                  </button>
                  <button className="btn btn-small" onClick={() => app.answer(id, { anime: true, manga: true })}>
                    Both
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
