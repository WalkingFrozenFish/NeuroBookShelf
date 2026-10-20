import { ReactNode } from "react";

type IconName =
  | "search"
  | "library"
  | "reader"
  | "trash"
  | "import"
  | "export"
  | "edit"
  | "read"
  | "restore"
  | "back"
  | "forward"
  | "down"
  | "minus"
  | "plus"
  | "width"
  | "page"
  | "select"
  | "overlay"
  | "clear"
  | "notes"
  | "bookmark"
  | "translate"
  | "dictionary"
  | "path"
  | "settings";

const paths: Record<IconName, ReactNode> = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  library: (
    <>
      <path d="M4 19.5V6.2A2.2 2.2 0 0 1 6.2 4H20v15.5" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M8 4v13" />
    </>
  ),
  reader: (
    <>
      <path d="M12 6.2C10.2 4.8 7.6 4.2 4 4.2V19c3.6 0 6.2.6 8 2 1.8-1.4 4.4-2 8-2V4.2c-3.6 0-6.2.6-8 2Z" />
      <path d="M12 6.2V21" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 13h8l1-13" />
    </>
  ),
  import: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  export: (
    <>
      <path d="M12 14V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M5 19h14" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13 7 4 4" />
    </>
  ),
  read: (
    <>
      <path d="M4 5h6.5A2.5 2.5 0 0 1 13 7.5V20a2.2 2.2 0 0 0-2.2-2.2H4V5Z" />
      <path d="M20 5h-6.5A2.5 2.5 0 0 0 11 7.5V20a2.2 2.2 0 0 1 2.2-2.2H20V5Z" />
    </>
  ),
  restore: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6" />
      <path d="M4 4v5h5" />
    </>
  ),
  back: <path d="M15 5 8 12l7 7" />,
  forward: <path d="m9 5 7 7-7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  minus: <path d="M6 12h12" />,
  plus: (
    <>
      <path d="M12 6v12" />
      <path d="M6 12h12" />
    </>
  ),
  width: (
    <>
      <path d="M4 7h16" />
      <path d="M4 17h16" />
      <path d="M7 10h10v4H7z" />
    </>
  ),
  page: <path d="M7 3h7l5 5v13H7V3Z" />,
  select: (
    <>
      <path d="M5 9V5h4" />
      <path d="M15 5h4v4" />
      <path d="M19 15v4h-4" />
      <path d="M9 19H5v-4" />
    </>
  ),
  overlay: (
    <>
      <path d="M5 6h14v9H8l-3 3V6Z" />
    </>
  ),
  clear: (
    <>
      <path d="m7 7 10 10" />
      <path d="m17 7-10 10" />
    </>
  ),
  notes: (
    <>
      <path d="M7 3h8l4 4v14H7V3Z" />
      <path d="M15 3v4h4" />
      <path d="M10 12h6" />
      <path d="M10 16h4" />
    </>
  ),
  bookmark: <path d="M7 4h10v16l-5-3-5 3V4Z" />,
  translate: (
    <>
      <path d="M4 6h9" />
      <path d="M8 6c0 6-3 8-5 9" />
      <path d="M6 10c1.2 1.6 3 2.8 5.5 3.4" />
      <path d="m13 18 3-8 3 8" />
      <path d="M14.2 16h3.6" />
    </>
  ),
  dictionary: (
    <>
      <path d="M5 5h11a3 3 0 0 1 3 3v11H8a3 3 0 0 0-3 3V5Z" />
      <path d="M8 5v14" />
    </>
  ),
  path: (
    <>
      <path d="M4 7.5h5.2L11 9.5H20v8H4v-10Z" />
      <path d="M4 7.5V6h5l1.5 1.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
