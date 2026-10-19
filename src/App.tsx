import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { getTheme, setTheme } from "./libraryApi";
import { DictionaryPage } from "./pages/DictionaryPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ReaderPage } from "./pages/ReaderPage";
import { TrashPage } from "./pages/TrashPage";
import { applyTheme } from "./theme";
import "./styles.css";

type PageId = "library" | "reader" | "trash" | "dictionary";

const pages: { id: PageId; label: string; icon: "library" | "reader" | "trash" }[] = [
  { id: "library", label: "Библиотека", icon: "library" },
  { id: "reader", label: "Читалка", icon: "reader" },
  { id: "trash", label: "Корзина", icon: "trash" },
];

function App() {
  const [page, setPage] = useState<PageId>("library");
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [theme, setThemeId] = useState("light");
  const leaveGuard = useRef<() => boolean | Promise<boolean>>(() => true);
  const registerLeaveGuard = useCallback((guard: () => boolean | Promise<boolean>) => {
    leaveGuard.current = guard;
  }, []);

  useEffect(() => {
    let active = true;
    getTheme()
      .then((stored) => {
        if (!active) {
          return;
        }
        setThemeId(stored);
        applyTheme(stored);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function changeTheme(next: string) {
    const previous = theme;
    setThemeId(next);
    applyTheme(next);
    try {
      await setTheme(next);
    } catch (error) {
      setThemeId(previous);
      applyTheme(previous);
      throw error;
    }
  }

  async function changePage(next: PageId) {
    if (page === "reader" && next !== page && !(await leaveGuard.current())) {
      return;
    }
    setPage(next);
  }

  async function openDocument(id: number) {
    if (page === "reader" && id !== documentId && !(await leaveGuard.current())) {
      return;
    }
    setDocumentId(id);
    setPage("reader");
  }

  const section = page === "dictionary" ? "library" : page;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Icon name="reader" />
          <span>NeuroBookShelf</span>
        </div>
        <nav className="nav" aria-label="Разделы">
          {pages.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === section ? "nav-button active" : "nav-button"}
              aria-current={item.id === section ? "page" : undefined}
              onClick={() => changePage(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main
        className={
          page === "reader" ? "content reader-open" : page === "dictionary" ? "content lexicon-open" : "content"
        }
      >
        {page === "library" && (
          <LibraryPage
            onOpen={openDocument}
            onOpenDictionary={() => setPage("dictionary")}
            theme={theme}
            onTheme={changeTheme}
          />
        )}
        {page === "reader" && (
          <ReaderPage documentId={documentId} registerLeaveGuard={registerLeaveGuard} />
        )}
        {page === "trash" && <TrashPage />}
        {page === "dictionary" && <DictionaryPage onBack={() => setPage("library")} />}
      </main>
    </div>
  );
}

export default App;
