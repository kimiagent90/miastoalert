## MiastoAlert

Produkcja‑ready PWA do zgłaszania i śledzenia w czasie rzeczywistym:
- 🚓 Policja
- 🎫 Kontrola biletów

Interfejs jest w 100% po polsku, aplikacja działa jako PWA (tryb standalone, obsługa offline, ikony) i jest gotowa do wdrożenia na Vercel / Railway.

### Stos technologiczny

- **Frontend**: React (Vite), Google Maps JavaScript API, PWA (manifest, service worker, offline fallback)
- **Backend**: Node.js, Express, PostgreSQL, JWT, role (owner / moderator / user)

---

### Konfiguracja środowiska

Skopiuj plik `.env.example` do `.env` i uzupełnij wartości:

- **DATABASE_URL** – pełny URL do bazy PostgreSQL, np. z Railway:
  - `postgres://uzytkownik:haslo@host:5432/miastoalert`
- **JWT_SECRET** – silny tajny klucz używany do podpisywania tokenów JWT.
- **OWNER_EMAIL / OWNER_PASSWORD** – dane logowania właściciela (owner) do panelu administracyjnego.
  - Konto właściciela jest tworzone automatycznie przy pierwszym uruchomieniu backendu, jeśli w bazie nie ma jeszcze ownera.
- **VITE_API_BASE** – opcjonalne, adres API dla frontendu:
  - lokalnie możesz zostawić puste (`''`), wtedy frontend użyje względnych ścieżek `/api` i skorzysta z proxy Vite → Express.
  - w produkcji ustaw na pełny adres backendu, np. `https://twoj-backend.onrailway.app`.
- **VITE_GOOGLE_MAPS_API_KEY** – klucz Google Maps JavaScript API (z włączonym Maps JavaScript API).

---

### Uruchomienie lokalne

1. Zainstaluj zależności:

   ```bash
   npm install
   ```

2. Uruchom bazę PostgreSQL lokalnie lub użyj zdalnej (np. Railway) i ustaw `DATABASE_URL` w `.env`.

3. Zbuduj frontend:

   ```bash
   npm run build
   ```

4. Uruchom serwer produkcyjny (Express + serwowanie statycznego frontendu z `dist/`):

   ```bash
   npm start
   ```

Backend podczas startu:
- wykona migracje (tworzenie tabel `users`, `reports`, `confirmations`),
- utworzy użytkownika **owner** na podstawie `OWNER_EMAIL` i `OWNER_PASSWORD` (jeśli jeszcze nie istnieje),
- zacznie sprzątać zgłoszenia starsze niż 60 minut w tle (cron).

> Uwaga: jeśli `DATABASE_URL` lub `JWT_SECRET` nie są ustawione, serwer zakończy działanie z błędem – ustaw te zmienne przed `npm start`.

---

### Uruchomienie w trybie deweloperskim

W trybie dev wygodnie jest uruchomić frontend i backend osobno:

1. W jednym terminalu:

   ```bash
   npm run dev
   ```

   - Frontend działa pod adresem `http://localhost:5173`.
   - Proxy Vite przekazuje żądania `/api` do `http://localhost:5000` (zdefiniowane w `vite.config.js`).

2. W drugim terminalu (po ustawieniu `.env`):

   ```bash
   npm start
   ```

---

### PWA i iOS

- Plik manifestu: `public/manifest.webmanifest`
- Service worker: `public/sw.js`
- Strona offline: `public/offline.html`
- Ikony aplikacji: `public/icon-192.svg`, `public/icon-512.svg`

Na iOS:
- można dodać aplikację do ekranu początkowego przez **Safari → Udostępnij → Dodaj do ekranu początkowego**,
- aplikacja działa w trybie **standalone** (pełny ekran).

---

### Backend – API i bezpieczeństwo

- **Autoryzacja**:
  - anonimowy użytkownik wybiera miasto (`/api/auth/anonymous`) – przypisywany jest do niego token JWT i miasto (nie może go zmienić samodzielnie),
  - właściciel / moderator logują się przez `/api/auth/login` (email + hasło, zdefiniowane w bazie / zmiennych właściciela),
  - endpoint `/api/auth/me` zwraca bieżącego użytkownika i jego oceny.
- **Zgłoszenia**:
  - `/api/reports` (POST) – dodanie zgłoszenia (typ: `policja` / `kontrola`, ulica/przystanek, opcjonalnie numer autobusu i kierunek, lokalizacja z mapy),
  - `/api/reports` (GET) – lista zgłoszeń dla danego miasta, filtrowana na ostatnie 30 / 60 minut,
  - zgłoszenia są automatycznie usuwane po 60 minutach (zadanie cron).
- **Potwierdzenia i ocena użytkownika**:
  - `/api/reports/:id/confirm` – potwierdzenie zgłoszenia (maks. jedno potwierdzenie na użytkownika na zgłoszenie),
  - potwierdzenie zwiększa ocenę autora zgłoszenia o +1,
  - usunięcie zgłoszenia przez moderatora/owner’a zmniejsza ocenę autora o -1.
- **Panel administracyjny**:
  - `/api/admin/overview` – lista użytkowników i zgłoszeń (właściciel + moderatorzy),
  - `/api/admin/users/:id/role` – zmiana roli użytkownika (tylko owner),
  - `/api/admin/users/:id/ban` – banowanie / odbanowanie użytkownika,
  - `/api/admin/users/:id/reset-city` – reset miasta użytkownika (wybór miasta nastąpi ponownie przy kolejnym uruchomieniu),
  - `/api/admin/reports/:id` – usunięcie zgłoszenia.
- **Zabezpieczenia**:
  - rate limiting dla tworzenia zgłoszeń (`/api/reports`, 10 żądań na minutę),
  - blokada duplikatów zgłoszeń w promieniu ok. 200 m i w ciągu ostatnich 5 minut,
  - nagłówki bezpieczeństwa przez `helmet`,
  - walidacja podstawowych pól po stronie backendu.

---

### Frontend – funkcje

- **Wybór miasta przy pierwszym uruchomieniu**:
  - użytkownik wybiera miasto z listy,
  - miasto jest zapisywane w JWT i localStorage,
  - nie może być samodzielnie zmienione (tylko moderator/owner przez panel).
- **Mapa Google**:
  - ciemny motyw, wygląd jak natywna aplikacja iOS,
  - markery z emoji:
    - 🚓 dla zgłoszeń Policji,
    - 🎫 dla kontroli biletów,
  - kliknięcie w mapę ustawia lokalizację nowego zgłoszenia.
- **Zgłoszenia**:
  - formularz z wymaganymi polami:
    - Typ (🚓 / 🎫),
    - Ulica / przystanek,
  - opcjonalnie:
    - Numer autobusu,
    - Kierunek,
  - lista ostatnich zgłoszeń z filtrem 30 / 60 minut.
- **Potwierdzenia**:
  - każdy użytkownik może potwierdzić dane zgłoszenie dokładnie raz,
  - liczba potwierdzeń jest widoczna na liście.
- **Panel administracyjny**:
  - dostępny po zalogowaniu jako owner / moderator,
  - możliwość przeglądania użytkowników, banowania, zmiany ról, resetu miasta i usuwania zgłoszeń.

---

### Deploy na Railway / Vercel

- **Backend (Railway)**:
  - utwórz nowy serwis Node.js z tego repozytorium,
  - ustaw zmienne środowiskowe: `DATABASE_URL`, `JWT_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`,
  - upewnij się, że Railway ma skonfigurowaną bazę PostgreSQL i poprawny `DATABASE_URL`.
- **Frontend (Vercel lub to samo Railway)**:
  - budowanie frontendu odbywa się przez `npm run build` (Vite),
  - w tym projekcie Express serwuje już statyczne pliki z katalogu `dist/`, więc możesz wdrożyć cały projekt jako jeden serwis Node.js (bez osobnego frontendu na Vercel),
  - jeśli chcesz osobnego frontendu (np. na Vercel), ustaw:
    - `VITE_API_BASE` na adres backendu,
    - w Vercel: build command `npm run build`, output `dist`.

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
