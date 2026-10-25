/** A short guide to what each part of the app does. Linked from the welcome screen and Settings. */
export function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <main className="screen settings howto">
      <div className="action-row start">
        <button className="btn btn-quiet btn-small btn-back" onClick={onClose}>
          Back
        </button>
      </div>
      <h2>How Shōbu works</h2>
      <p>
        Shōbu builds a ranking of the anime you've watched and the manga you've read. You never score anything. You pick
        between two titles at a time, and the order follows from your picks.
      </p>

      <section>
        <h3>1. Duel</h3>
        <p>
          Duel shows two titles and asks which you prefer. A tie is allowed. Left and right arrows pick, the down arrow
          ties, S skips the pair and Z undoes. Early duels place a new title roughly; later ones settle neighbours that are
          still close. Each duel moves the ranking straight away.
        </p>
        <p>
          Your list starts in Duel. Titles marked New aren't on your list yet; they're ones you probably know. If you know
          it, pick as usual and it joins your list. If not, press Haven't seen under it (or N) and another takes its place.
          New titles come often while your list is short, and less often later, depending on how many you turn out to
          know. Two titles that have met twice aren't asked again for a few months, so the top of your list doesn't keep
          replaying the same close calls. Duel only brings in titles you're likely to know, so if yours are less popular,
          few new ones may come up; a line under the buttons then points to the Library, where you can log them yourself.
        </p>
        <p>
          In the both view, a new title that is both an anime and a manga could be either. Every few picks, Duel asks
          about those together: anime, manga or both. Later leaves them for the Library.
        </p>
      </section>

      <section>
        <h3>2. Library</h3>
        <p>
          The Library holds every title. Quick log shows one at a time, likeliest first, and asks if you know it; it's a
          fast way to add a batch at once. Browse shows covers you can narrow by status, decade and year and put in a different order, which helps you remember what
          you've seen once the obvious ones are done. A title is logged once you've said whether you know it. Its search box looks through every title; if what you want isn't
          there, it offers to search AniList, which finds anything older or less popular.
        </p>
        <p>
          Some titles exist as both anime and manga, such as Death Note. For those, Quick log and the title's card ask which you've seen:
          the anime, the manga, both or neither. A card is one franchise, so the answer is about the whole thing, not one season. Duels in
          the Both view don't stop to ask. A title brought in there counts as seen in the Anime and Manga views until you say which, and
          switching to one of those views lists the titles still to answer.
        </p>
      </section>

      <section>
        <h3>3. Ranking and Taste</h3>
        <p>
          Ranking is the full list, with each title's duel count. A title is marked settled once more duels are unlikely
          to move it far; until then its position is a best guess.
        </p>
        <p>
          Every title has one card with everything about it: your record, whether you've seen it (and which, anime or
          manga), what the title groups together, Split up and Join, and Not interested for suggestions. Open it by tapping
          the title's name in Duel or Quick log, the i on a cover in Browse, or the title anywhere in Ranking, Picks and
          Taste.
        </p>
        <p>
          If a title sits in the wrong spot, Re-place it from its card. Its duels so far are set aside, and Duel asks a few
          quick ones, each against a settled title in the middle of where it could still go, until its place is found,
          sometimes with one or two more against its new neighbours (about 9 duels for a list of 120). Stop leaves the round early; what you've answered still counts. Set-aside
          duels stay stored: Count its old duels again, on the card or in Settings, puts them back alongside the new ones.
          Set-aside duels don't count anywhere else in the app either, including Taste.
        </p>
        <p>
          Taste opens with cards, each one finding with its number: your type, who climbed or fell this week, where you
          part from AniList's scores, the themes, era and studio your top 20 leans to, how long your #1 has held the top,
          the popular titles you haven't seen, and a few facts from your duels. Each card's Share sends a link to your page that
          opens at that card; Picture shares it as a picture instead. Your type
          is the pattern in your top titles least likely to happen by chance; when a second one also stands out, it shows
          as "with a streak of". It needs 30 ranked titles and 100 duels; Hot takes needs 30 ranked, Guilty pleasure 40. Below the cards, Taste in
          numbers shows where each genre, theme, studio and decade sits in your list, and Your duels has the counts, the
          top-10 chart, how settled the list is and your duel records.
        </p>
        <p>
          Share my page, at the top of Ranking, makes a link to your page: your ranking in the view you're in and your Taste
          cards, as you see them now. A friend who opens it sees your top 10, your cards and the rest of your list, each title
          marked with where they rank it. Once they've ranked 10 titles they also see a match score (how often you'd both
          pick the same title of two you've both ranked) and what you both love. If they send theirs back, it's under
          Ranking → Friends. Nothing goes to a server; the page is inside the link, and the pages you receive are kept on
          this device.
        </p>
      </section>

      <section>
        <h3>4. Anime, manga or both</h3>
        <p>
          The switch at the top sets what the whole app shows. There is one ranking underneath. The anime view shows what
          you've watched, the manga view what you've read, and both shows everything. A title you've only read counts as
          not seen in the anime view. Duels only use titles in the current view.
        </p>
        <p>
          A title's card shows the side you know. In the manga view, Death Note shows the manga's cover and years. In the
          both view, a title you've only read shows as the manga, one you've only watched as the anime, and one you know
          both ways as the anime with the manga noted.
        </p>
      </section>

      <section>
        <h3>5. Fixing groups</h3>
        <p>
          Titles are grouped into franchises automatically, and the grouping is sometimes wrong. A franchise can swallow
          spin-offs you think of as separate, or two titles that should be one can sit apart. Open a title and choose
          Split up or Join with another title.
        </p>
        <p>
          Split lets you tick the parts to take out. Past duels stay with the original; the new titles start with none.
          Join folds another title into this one and counts duels from both. Every change is listed in Settings (the gear at the end of the tab bar), where you
          can undo it. Your changes survive catalogue updates.
        </p>
      </section>

      <section>
        <h3>6. Picks</h3>
        <p>
          Suggestions come from AniList users' recommendations for the titles you rank highest, plus the genres and tags
          (themes such as Found Family or Time Skip) you rank well. The recommendations count for most.
          Tonight's pick is one of the best of them, the same all day until you press Another; Share sends it as a
          picture. Below are rows: one for each of your top three ("Because you rank … highly"), Hidden gems (strongly
          recommended from your list, but not among the 300 most popular titles), and Read the manga or Watch the anime (titles you
          know in one form, have ruled out in the other and rank in the top third; Read shows in the Anime and Both views,
          Watch in the Manga and Both views). A title shows in one row only. Press Not interested, or
          the × on a cover, and it won't come back. Hidden ones can be restored at the bottom of the page.
        </p>
      </section>

      <section>
        <h3>7. Tips</h3>
        <p>
          Duel shows a short tip the first time something it explains comes up, such as a franchise that may need splitting
          or the Library's Browse tab. Each tip shows once and they are spaced apart. Settings can turn them off or show them
          again.
        </p>
      </section>

      <section>
        <h3>8. Your data</h3>
        <p>
          Everything is stored in this browser on this device. There is no account. Use Save a copy in Settings now and
          then; on an iPhone it opens the share sheet, where you can pick Save to Files. Load a copy brings it back, or
          moves your list to another device, along with friends' lists you've received. The app reminds you when you have
          unsaved work.
        </p>
      </section>

      <div className="action-row start">
        <button className="btn btn-primary" onClick={onClose}>
          Back
        </button>
      </div>
    </main>
  );
}
