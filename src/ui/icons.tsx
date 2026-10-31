// Inline 24×24 stroke icons in the CocoaCanvas style.
import type { JSX } from "react";

const P: Record<string, JSX.Element> = {
  select: <path d="M5 3l14 7-6 2-2 6z" />,
  hand: <path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L8 15" />,
  text: <path d="M9 4h6M9 20h6M12 4v16" />,
  highlight: <path d="m9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />,
  underline: <path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16" />,
  strikeout: <path d="M16 4H9a3 3 0 0 0-2.8 4M14 12a4 4 0 0 1 0 8H6M4 12h16" />,
  note: (
    <>
      <path d="M4 4h16v11l-5 5H4z" />
      <path d="M15 20v-5h5" />
    </>
  ),
  pen: <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6" />,
  line: <path d="M5 19 19 5" />,
  arrow: <path d="M5 19 19 5M10 5h9v9" />,
  textbox: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  rotl: <path d="M3 4v6h6M3.5 15a9 9 0 1 0 2.1-9.4L3 10" />,
  rotr: <path d="M21 4v6h-6M20.5 15a9 9 0 1 1-2.1-9.4L21 10" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </>
  ),
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
};

export function Icon({ name }: { name: string }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {P[name] ?? null}
    </svg>
  );
}

/** The CocoaSuite "C" mark with a page — CocoaPDF's identity. */
export function BrandMark() {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true">
      <path d="M44 6C39.5 1.9 34.5 0 28 0C12.5 0 0 12.5 0 28C0 43.5 12.5 56 28 56C34.5 56 39.5 54.1 44 50L36 40C33.8 42 31.3 43 28 43C19.7 43 13 36.3 13 28C13 19.7 19.7 13 28 13C31.3 13 33.8 14 36 16L44 6Z" fill="#D15A2C" />
      <path d="M24 18h11l7 7v15H24z" fill="#D15A2C" />
      <path d="M35 18v7h7" stroke="#1a1a1a" strokeWidth="1.6" fill="none" />
    </svg>
  );
}
