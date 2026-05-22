import { DateTime } from "effect"

import type { InspectorAppSnapshot, InspectorSessionRow } from "./inspector-app.js"

export interface AppProps {
  readonly snapshot: InspectorAppSnapshot
  readonly onSelectSession: (sessionId: string) => void
}

export function App({ onSelectSession, snapshot }: AppProps) {
  const selectedSession = snapshot.sessions.find(
    (session) => session.id === snapshot.selectedSessionId
  )

  return (
    <main className="inspector-shell">
      <aside className="session-rail" aria-label="Inspector sessions">
        <div className="brand-block">
          <p>ORIKA</p>
          <h1>Inspector</h1>
        </div>
        <nav className="session-list" aria-label="Sessions">
          {snapshot.sessions.map((session) => (
            <SessionButton
              key={session.id}
              session={session}
              selected={session.id === snapshot.selectedSessionId}
              onSelect={onSelectSession}
            />
          ))}
        </nav>
      </aside>

      <section className="workspace" aria-label="Selected Inspector session">
        <header className="workspace-header">
          <div>
            <p className="kicker">{selectedSession?.kind ?? "live"}</p>
            <h2>{selectedSession?.label ?? "Session"}</h2>
          </div>
          <div className="session-meter" aria-label="Session event count">
            <strong>{snapshot.events.length}</strong>
            <span>events</span>
          </div>
        </header>

        <section className="category-strip" aria-label="Event categories">
          {snapshot.categories.map((category) => (
            <div key={category.id} className="category-cell">
              <span>{category.label}</span>
              <strong>{category.events}</strong>
            </div>
          ))}
        </section>

        <section className="timeline" aria-label="Timeline events">
          {snapshot.events.map((event) => (
            <article key={event.id} className={`timeline-row ${event.category}`}>
              <time dateTime={DateTime.formatIso(DateTime.makeUnsafe(event.atMs))}>
                {event.atMs}
              </time>
              <div>
                <p>{event.title}</p>
                <span>{event.detail}</span>
              </div>
              <b>{event.category}</b>
            </article>
          ))}
        </section>
      </section>
    </main>
  )
}

interface SessionButtonProps {
  readonly session: InspectorSessionRow
  readonly selected: boolean
  readonly onSelect: (sessionId: string) => void
}

function SessionButton({ onSelect, selected, session }: SessionButtonProps) {
  return (
    <button
      type="button"
      className={selected ? "session-button selected" : "session-button"}
      aria-current={selected ? "page" : undefined}
      onClick={() => onSelect(session.id)}
    >
      <span>{session.label}</span>
      <small>
        {session.kind} / {session.events} events
      </small>
    </button>
  )
}
