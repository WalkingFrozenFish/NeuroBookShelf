import { t } from "./i18n";
import { useUiLanguage } from "./i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { errorText, getAppearance, setAppearance } from "./libraryApi";
import { DictionaryPage } from "./pages/DictionaryPage";
import { LibraryPage } from "./pages/LibraryPage";
import { ReaderPage } from "./pages/ReaderPage";
import { applyAppearance, cachedAppearance, normalizeAppearance, type Appearance } from "./theme";
import { TranslationQueuePanel } from "./TranslationQueuePanel";
import "./styles.css";

type PageId = "library" | "reader" | "dictionary";

const pages: { id: PageId; label: string; icon: "library" | "reader" }[] = [
  { id: "library", label: "Библиотека", icon: "library" },
  { id: "reader", label: "Читалка", icon: "reader" },
];

function App() {
  useUiLanguage();
  const [page, setPage] = useState<PageId>("library");
  const [documentId, setDocumentId] = useState<number | null>(null);
  const [appearance, setAppearanceState] = useState(cachedAppearance);
  const [appearancePending, setAppearancePending] = useState(true);
  const [appearanceError, setAppearanceError] = useState("");
  const appearanceSaving = useRef(false);
  const leaveGuard = useRef<() => boolean | Promise<boolean>>(() => true);
  const registerLeaveGuard = useCallback((guard: () => boolean | Promise<boolean>) => {
    leaveGuard.current = guard;
  }, []);

  useEffect(() => {
    let active = true;
    applyAppearance(cachedAppearance());
    getAppearance()
      .then((stored) => {
        if (!active) {
          return;
        }
        const next = normalizeAppearance(stored);
        setAppearanceState(next);
        applyAppearance(next);
      })
      .catch((error) => { if (active) setAppearanceError(errorText(error)); })
      .finally(() => { if (active) setAppearancePending(false); });
    return () => {
      active = false;
    };
  }, []);

  async function changeAppearance(next: Appearance) {
    if (appearancePending || appearanceSaving.current) return;
    appearanceSaving.current = true;
    setAppearancePending(true);
    setAppearanceError("");
    const previous = appearance;
    setAppearanceState(next);
    applyAppearance(next);
    try {
      await setAppearance(next);
    } catch (error) {
      setAppearanceState(previous);
      applyAppearance(previous);
      setAppearanceError(errorText(error));
    } finally {
      appearanceSaving.current = false;
      setAppearancePending(false);
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
        <nav className="nav" aria-label={t("Разделы")}>
          {pages.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === section ? "nav-button active" : "nav-button"}
              aria-current={item.id === section ? "page" : undefined}
              onClick={() => changePage(item.id)}
            >
              <Icon name={item.icon} />
              {t(item.label)}
            </button>
          ))}
        </nav>
      </header>
      {appearanceError && <p className="error appearance-error" role="alert">{t("Не удалось сохранить или загрузить оформление:")}{" "}{appearanceError}</p>}
      <main
        className={
          page === "reader" ? "content reader-open" : page === "dictionary" ? "content lexicon-open" : "content"
        }
      >
        {page === "library" && (
          <LibraryPage
            onOpen={openDocument}
            onOpenDictionary={() => setPage("dictionary")}
            appearance={appearance}
            onAppearance={changeAppearance}
            appearancePending={appearancePending}
          />
        )}
        {page === "reader" && (
          <ReaderPage documentId={documentId} registerLeaveGuard={registerLeaveGuard} appearance={appearance} onAppearance={changeAppearance} appearancePending={appearancePending} />
        )}
        {page === "dictionary" && <DictionaryPage onBack={() => setPage("library")} />}
      </main>
      <TranslationQueuePanel />
    </div>
  );
}

export default App;
