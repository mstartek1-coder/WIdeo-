# 🎬 WIdeo Studio

Studio w przeglądarce do tworzenia **hiperrealistycznego wideo z dźwiękiem i animacją**.
Łączy najlepsze modele AI (Google Veo 3, Kling, Hailuo, Seedance, Flux, ElevenLabs, Claude)
z własnym silnikiem montażowym (WebGL2 + Web Audio). Bez kluczy API też działa: ma proceduralne,
fotorealistyczne tła, syntezator ambientu i muzyki oraz reżysera offline.

```
pomysł → reżyser AI (scenopis) → klipy AI + lektor + efekty → montaż (kamera, kolor, przejścia, napisy, miks) → eksport MP4/WebM
```

## Co potrafi

**Obraz**
- **Generowanie wideo AI**: Veo 3 (z natywnym dźwiękiem), Kling 2.1 Master, Hailuo 02, Seedance 1 Pro albo dowolny model z Replicate.
- **Zdjęcia AI** (Flux 1.1 Pro Ultra w trybie RAW, Imagen 4) i **animacja zdjęcia** (image→video).
- **Kreator promptów „hiperrealizm”**: ruch kamery, obiektyw, światło, kamera/taśma (ARRI, RED, Kodak 500T, IMAX…), styl, fizyka ruchu i negatywny prompt przeciw typowym artefaktom AI.
- **Silnik proceduralny (offline, WebGL2)**: ocean o zachodzie, lot nad morzem chmur (wolumetryczne chmury), zorza nad górami z odbiciem w jeziorze, mgławica, nocne miasto za mokrą szybą (bokeh i krople).
- **Montaż**: ruch kamery (Ken Burns/dolly) z krzywymi ruchu, przejścia (przenikanie, przez czerń, kurtyna, najazd), korekcja barwna z presetami (teal & orange, noir, bleach bypass…).
- **Look filmowy**: bloom/halacja, ziarno zależne od luminancji, aberracja chromatyczna, winieta, wyostrzenie, kasety kinowe 1.85/2.0/2.39, tone mapping ACES.
- **Animowane napisy** z presetami (zwiastun kinowy, maszyna do pisania, wjazdy, zoom) i własnymi keyframe'ami (pozycja, krycie, skala, obrót, rozstrzelenie, odkrycie tekstu).

**Dźwięk**
- **Lektor AI** (ElevenLabs, także po polsku) – scena sama wydłuża się do długości nagrania.
- **Efekty dźwiękowe AI** z opisu i **muzyka AI**.
- **Syntezator (offline)**: realistyczne ambienty (fale, wiatr, noc ze świerszczami, kosmiczny dron, deszcz z grzmotami) i muzyka w 4 nastrojach (epicka, spokojna, mroczna, podnosząca na duchu).
- **Miks**: automatyczne ściszanie muzyki pod lektorem (ducking), crossfade'y ambientu między scenami, dźwięk z klipów Veo, limiter.
- **Napisy dialogowe** generowane z tekstu lektora.

**Workflow**
- **Reżyser AI (Claude)**: z kilku zdań tworzy scenopis – prompty wizualne, język kamery, światło, tekst lektora, opisy dźwięku, przejścia, nastrój muzyki. Pilnuje spójności postaci między ujęciami.
- **„⚡ Generuj wszystko AI”** – jednym kliknięciem klipy dla wszystkich scen i nagrania lektora (3 zadania równolegle).
- Oś czasu z przeciąganiem napisów i zmianą długości scen, cofanie/ponawianie, autozapis, projekt jako JSON.
- **Eksport**: film MP4/WebM z dźwiękiem, miks WAV, klatka PNG. Formaty 16:9, 9:16 (Reels/TikTok), 1:1, do 4K.

## Szybki start

Wymagany Node.js 20+ i aktualna przeglądarka z WebGL2 (Chrome/Edge zalecane do eksportu).

```bash
npm install
cp .env.example .env     # opcjonalnie: wpisz klucze API
npm start
```

Otwórz **http://127.0.0.1:5173**. Na start wczytuje się projekt demo – wciśnij spację.

## Klucze API (wszystkie opcjonalne)

| Zmienna w `.env` | Co odblokowuje |
|---|---|
| `ANTHROPIC_API_KEY` | Reżyser AI (Claude) – scenopis z promptami i lektorem |
| `REPLICATE_API_TOKEN` | Wideo: Veo 3 / Veo 3 Fast / Kling / Hailuo / Seedance; zdjęcia: Flux, Imagen |
| `GEMINI_API_KEY` | Google Veo bezpośrednio przez Gemini API (wideo z dźwiękiem) |
| `ELEVENLABS_API_KEY` | Lektor (TTS), efekty dźwiękowe, muzyka |

Dodatkowe ustawienia: `DIRECTOR_MODEL`, `VEO_MODEL`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `HOST`, `PORT`, `MEDIA_DIR`, `MAX_UPLOAD_MB` (zob. `.env.example`).
Klucze zostają na serwerze – przeglądarka nigdy ich nie widzi. Generowane pliki trafiają do `media/`.

> Generowanie wideo AI jest płatne u dostawców, a najlepsze modele (np. Veo 3) są drogie – sprawdź cenniki przed generowaniem wielu scen. Przycisk „Generuj wszystko AI” uruchamia zadania tylko dla scen bez materiału.

## Jak uzyskać efekt „jak z kamery”

1. **Jedno ujęcie = jedna akcja.** Modele najlepiej radzą sobie z 4–10 s i jednym wyraźnym ruchem.
2. **Opisuj fizykę i materiały**: „wet cobblestones reflecting neon”, „dust in the backlight”, „wind moving her hair”.
3. **Powtarzaj opis postaci** w każdej scenie (wiek, ubiór, fryzura, kolory) – reżyser AI robi to automatycznie.
4. **Dobierz optykę i światło** w kreatorze – 85 mm + złota godzina daje naturalną głębię i skórę.
5. **Veo 3** generuje dźwięk w klipie – opisz go w polu „Dźwięk w klipie” (dialogi w cudzysłowie).
6. **Zdjęcie → wideo**: wygeneruj zdjęcie Fluxem (RAW), a potem „Animuj to zdjęcie” – często najbardziej fotorealistyczna ścieżka.
7. W montażu ujednolić kolor presetem i dodać lekkie ziarno oraz winietę – różne klipy zaczną wyglądać jak jeden film.

## Skróty klawiszowe

`Spacja` odtwarzanie · `←/→` klatka (z `Shift` – sekunda) · `Home/End` początek/koniec · `Ctrl+Z` / `Ctrl+Shift+Z` cofnij/ponów · `Delete` usuń zaznaczone · `Ctrl+kółko` na osi czasu – zoom.

## Architektura

```
server/                     Node.js bez frameworków
  index.js                  statyczne studio, API, media z obsługą Range (przewijanie wideo), upload
  jobs.js                   kolejka zadań generowania, zapis wyników do media/
  providers/
    director.js             Claude – scenopis (structured outputs, JSON Schema)
    replicate.js            Veo 3, Kling, Hailuo, Seedance, Flux, Imagen (+ dowolny model)
    veo.js                  Google Veo przez Gemini API
    elevenlabs.js           lektor, efekty dźwiękowe, muzyka
public/
  js/core/                  czysta logika (działa też w Node – testy)
    project.js              model projektu, walidacja, demo
    timeline.js             układ scen, przejścia, ruch kamery, animacje napisów, napisy dialogowe
    keyframes.js, easing.js interpolacja i krzywe ruchu (w tym cubic-bezier)
    prompt.js               kreator promptów hiperrealistycznych
    storyboard.js           reżyser offline + import planu reżysera AI
    synth.js                DSP: filtry, Freeverb, ambienty, generator muzyki, zapis WAV
  js/engine/
    shaders.js              sceny proceduralne GLSL, kompozycja, bloom, postprodukcja
    renderer.js             renderer WebGL2, synchronizacja klipów, napisy (Canvas 2D)
    audio.js                miks Web Audio (na żywo i offline), ducking, limiter
    synth-worker.js         synteza dźwięku w Web Workerze
    exporter.js             eksport MP4/WebM, WAV, PNG, JSON
  js/ui/                    interfejs: oś czasu, inspektor, kontroler aplikacji
tests/                      testy node:test (logika, DSP, serwer)
```

## Testy

```bash
npm test
```

## Ograniczenia

- Eksport filmu nagrywa podgląd **w czasie rzeczywistym** (MediaRecorder) – nie przełączaj karty w trakcie. Kontener zależy od przeglądarki: Chrome/Edge zapisują MP4 (H.264 lub VP9), inne – WebM.
- Ciężkie sceny proceduralne (chmury wolumetryczne) na słabszym GPU mogą gubić klatki w 4K – obniż „Jakość tła proc.” w zakładce Projekt.
- Schematy wejść modeli na Replicate bywają zmieniane przez autorów. Model można podmienić w polu „Własny model”, a serwer przyjmuje też `extraInput` z dodatkowymi parametrami.
- Serwer domyślnie nasłuchuje tylko na `127.0.0.1` – to narzędzie lokalne, bez logowania.
