import { useEffect, useRef, useState } from 'react';
import { decodeList, type SentList } from '../rank/listLink';
import { Compare } from './Compare';
import { Duel } from './Duel';
import { ForYou } from './ForYou';
import { HowItWorks } from './HowItWorks';
import { ItemSheet } from './ItemSheet';
import { Ranking } from './Ranking';
import { SettingsScreen } from './SettingsScreen';
import { Sort } from './Sort';
import { Stats } from './Stats';
import { useApp } from './useApp';
import { ViewSwitch } from './ViewSwitch';
import { Welcome } from './Welcome';
import { useUpdateReady } from './update';
import { Mark } from './Mark';

type Tab = 'duel' | 'sort' | 'ranking' | 'stats' | 'foryou' | 'settings';
const TABS: [Tab, string][] = [
  ['duel', 'Duel'],
  ['ranking', 'Ranking'],
  ['sort', 'Library'],
  ['stats', 'Taste'],
  ['foryou', 'Picks'],
  ['settings', 'Settings'],
];

/** The Settings tab is a gear, to leave room for the named tabs. Its button carries the label. */
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function App() {
  const app = useApp();
  const [tab, setTab] = useState<Tab | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  /** The front page: shown on a first visit until Start, and whenever the Shōbu name is tapped. */
  const [home, setHome] = useState<boolean | null>(null);
  /**
   * A person's page, open over the tabs: a friend's (by key, optionally at one of their cards), your own as a
   * friend would see it (`self`), or with neither, the list of friends' pages.
   */
  const [comparing, setComparing] = useState<{ key?: string; at?: string; self?: SentList } | null>(null);
  const preview = (self: SentList) => setComparing({ self });

  const hasItems = app.items.length > 0;

  // Bring in a newer catalogue, if the site has one, once per launch.
  const synced = useRef(false);
  useEffect(() => {
    if (!app.ready || !hasItems || synced.current) return;
    synced.current = true;
    app.syncCatalogue().catch(() => undefined);
  });

  // Pick the opening screen once, when data first loads; after that only the person changes tabs.
  useEffect(() => {
    if (app.ready && hasItems && tab === null) setTab('duel');
  }, [app.ready, hasItems, tab]);

  // A friend's page arrives in the link's fragment: keep it, take it out of the address bar, and open it.
  // Pasting a link into a tab that's already open changes only the fragment, hence the hashchange listener.
  const addFriend = useRef(app.addFriend);
  addFriend.current = app.addFriend;
  useEffect(() => {
    if (!app.ready) return;
    const take = () => {
      const list = decodeList(location.hash);
      if (!list) return;
      history.replaceState(null, '', location.pathname + location.search);
      addFriend.current(list).then((key) => setComparing({ key, at: list.at }));
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, [app.ready]);

  // A first visit (nothing stored yet) opens on the front page and stays there until Start.
  useEffect(() => {
    if (app.ready && home === null) setHome(!hasItems);
  }, [app.ready, home, hasItems]);

  // `#home` on the address always opens the front page, for demos: nothing stored is touched, and a link
  // to a friend's page (`#v=…`) is unaffected. Placed after the effect above so it wins on a first load.
  useEffect(() => {
    if (!app.ready) return;
    const front = () => {
      if (location.hash.toLowerCase() !== '#home') return;
      history.replaceState(null, '', location.pathname + location.search);
      setComparing(null);
      setHelp(false);
      setHome(true);
    };
    front();
    window.addEventListener('hashchange', front);
    return () => window.removeEventListener('hashchange', front);
  }, [app.ready]);

  if (!app.ready || home === null) return <div className="boot" />;
  if (help) return <HowItWorks onClose={() => setHelp(false)} />;
  // A friend's link shows Compare even on a first visit, once the title list has loaded.
  const showCompare = comparing !== null && hasItems;
  if ((home || !hasItems) && !showCompare) {
    // The welcome screen loads the catalogue itself; the launch check would only write it all again.
    if (!hasItems) synced.current = true;
    return (
      <Welcome
        app={app}
        onHelp={() => setHelp(true)}
        onStart={() => {
          setHome(false);
          setTab('duel');
        }}
      />
    );
  }

  const current: Tab = tab ?? 'duel';

  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="wordmark"
          onClick={() => {
            setComparing(null);
            setHome(true);
          }}
          aria-label="Shōbu: front page"
          title="Front page"
        >
          <Mark size={22} />
          <span>Shōbu</span>
        </button>
        <ViewSwitch app={app} compact />
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              className={(current === t && !showCompare ? 'on' : '') + (t === 'settings' ? ' tab-icon' : '')}
              aria-current={current === t && !showCompare ? 'page' : undefined}
              {...(t === 'settings' ? { 'aria-label': 'Settings', title: 'Settings' } : {})}
              onClick={() => {
                setComparing(null);
                setHome(false);
                setTab(t);
              }}
            >
              {t === 'settings' ? <GearIcon /> : label}
            </button>
          ))}
        </nav>
      </header>
      {showCompare && (
        <Compare
          app={app}
          key={comparing.self ? 'self' : 'friends'}
          initialKey={comparing.key}
          at={comparing.at}
          self={comparing.self}
          onPreview={preview}
          onOpen={setOpenId}
          onClose={() => setComparing(null)}
          onStart={() => {
            setComparing(null);
            setHome(false);
            setTab('duel');
          }}
        />
      )}
      {!showCompare && current === 'duel' && <Duel app={app} onLibrary={() => setTab('sort')} onOpen={setOpenId} />}
      {!showCompare && current === 'sort' && <Sort app={app} onDone={() => setTab('duel')} onOpen={setOpenId} />}
      {!showCompare && current === 'stats' && <Stats app={app} onOpen={setOpenId} onDuel={() => setTab('duel')} onPreview={preview} />}
      {!showCompare && current === 'foryou' && <ForYou app={app} onOpen={setOpenId} onSort={() => setTab('sort')} />}
      {!showCompare && current === 'ranking' && <Ranking app={app} onOpen={setOpenId} onCompare={() => setComparing({})} onDuel={() => setTab('duel')} onPreview={preview} />}
      {!showCompare && current === 'settings' && <SettingsScreen app={app} onHelp={() => setHelp(true)} />}
      {openId && (
        <ItemSheet
          app={app}
          itemId={openId}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          onDuel={() => {
            setComparing(null);
            setHome(false);
            setTab('duel');
          }}
        />
      )}
      <UpdateBar />
    </div>
  );
}

/** Shown once a new version has taken over; the page keeps running the old one until it reloads. */
function UpdateBar() {
  const ready = useUpdateReady();
  const [later, setLater] = useState(false);
  if (!ready || later) return null;
  return (
    <div className="update-bar" role="status">
      <span>A new version is ready.</span>
      <button className="btn btn-primary btn-small" onClick={() => location.reload()}>
        Reload
      </button>
      <button className="btn btn-quiet btn-small" onClick={() => setLater(true)}>
        Later
      </button>
    </div>
  );
}
