import { useEffect, useRef } from "react";
import { Icon } from "./icons";
import { runSearch, stepSearch, useApp } from "../app/store";

export function Search() {
  const s = useApp((x) => x.search);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  useEffect(() => input.current?.select(), []);
  const close = () => useApp.setState((x) => ({ search: { ...x.search, open: false, hits: [], index: 0 } }));
  const count = s.busy ? "…" : s.query.trim() ? (s.hits.length ? `${s.index + 1} of ${s.hits.length}` : "No matches") : "";
  return (
    <div className="find" role="search">
      <Icon name="search" />
      <label htmlFor="find" className="sr">
        Find in document
      </label>
      <input
        id="find"
        ref={input}
        type="search"
        placeholder="Find in document"
        defaultValue={s.query}
        onChange={(e) => {
          const v = e.target.value;
          clearTimeout(timer.current);
          timer.current = window.setTimeout(() => runSearch(v), 220);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            if (s.query !== e.currentTarget.value) runSearch(e.currentTarget.value);
            else stepSearch(e.shiftKey ? -1 : 1);
          }
          if (e.key === "Escape") close();
        }}
      />
      <span className="n" aria-live="polite">
        {count}
      </span>
      <button aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => stepSearch(-1)} disabled={!s.hits.length}>
        <Icon name="up" />
      </button>
      <button aria-label="Next match" title="Next (Enter)" onClick={() => stepSearch(1)} disabled={!s.hits.length}>
        <Icon name="down" />
      </button>
      <button className={s.caseSensitive ? "on" : undefined} aria-pressed={s.caseSensitive} title="Match case" onClick={() => runSearch(s.query, !s.caseSensitive)}>
        Aa
      </button>
      <button aria-label="Close search" onClick={close}>
        <Icon name="x" />
      </button>
    </div>
  );
}
