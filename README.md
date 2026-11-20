# kolo — AI analiza fudbalskog kola

Upišeš ligu („Bundesliga ovaj vikend“, „La Liga 14. kolo“, „Premijer liga BiH“) i app:

1. **Istražuje kolo na webu** (Claude Opus 5.5 + web pretraga): raspored, tabela doma/gostovanje, forma, xG, tendencije golova, poluvremena, H2H s poluvremenima, izostanci, motivacija, kvote.
2. **Analizira kao profesionalni kladioničar** (Opus 5.5, režim *Ultra* = maksimalno razmišljanje): model očekivanih golova po meču → vjerovatnoće za sva tržišta (1X2, dupla šansa, ishod bez remija, azijske linije s povratom, GG/NG, tim daje gol, poluvrijeme/kraj…) → poređenje s kvotama → očekivana vrijednost (EV).
3. **Pravi tikete za uplatu** s ulozima iz tvog budžeta:
   - **Sigurica** — najsigurniji tipovi umjesto 1X2: dupla šansa, „Više 2.0 (tačno 2 = povrat)“, „tim daje gol“, 1+ itd.
   - **Value** — najveća razlika između procjene i kvote, manji ulozi.
   - **Ludi sistem** — preokreti poluvrijeme/kraj (1/2, 2/1, X/1…), sistem k/n, mali ulog.
   - **Mix** — najbolje iz svih strategija.
   - Po potrebi **Forma & H2H** i druge strategije koje app sama predloži.

Jedini cilj je zarada na duže staze: app traži tipove s pozitivnom očekivanom vrijednošću i kaže kad vrijednosti nema (tada predloži manji ulog). Siguran tiket ne postoji.

## Pokretanje

Potreban je Node.js 20.12+ i Claude API ključ (https://platform.claude.com).

```bash
npm install
cp .env.example .env      # upiši ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

Proba bez ključa i bez troška (izmišljeni podaci): `npm run demo`.

S telefona u istoj mreži: u `.env` postavi `HOST=0.0.0.0` i `APP_PASSWORD=...`, pa otvori `http://<IP-računara>:3000`.

## Potrošnja (optimizovano)

| Gdje se štedi | Kako |
|---|---|
| Dvije faze | Skupo „max“ razmišljanje čita samo kratak dosije (~5–8k tokena), a ne sirove rezultate pretrage. |
| Ograničena pretraga | Standard do 12, Ultra do 22 pretrage; model prvo traži stranice koje pokrivaju cijelo kolo (tabela, xG, povrede, kvote). Dinamičko filtriranje rezultata pretrage smanjuje tokene. |
| Ponovna upotreba podataka | Isti upit u roku od `DOSSIER_TTL_HOURS` (12 h) ne pretražuje web ponovo. „Nova strategija“ plaća samo analizu. |
| Prompt caching | Stabilni sistemski promptovi i dosije su keširani (ponovljeni ulaz ~10× jeftiniji). |
| Lokalni proračun | Promjena budžeta, kvota iz tvoje kladionice, ulaga i ishoda računa se u browseru — bez API troška. |
| Limit | `MONTHLY_BUDGET_USD` zaustavlja nove analize kad se mjesečni budžet potroši. |

Okvirno: Standard ≈ $0.5–1.5, Ultra ≈ $1.5–4 po kolu (zavisi od broja mečeva i pretraga). Tačan trošak svake analize (tokeni, pretrage, $) vidi se ispod analize i u zaglavlju (potrošnja ovog mjeseca).

## Kako koristiti rezultat

- **Kvote**: isprekidan okvir = procijenjena kvota. Upiši kvotu svoje kladionice; EV, ukupna kvota i dobitak se odmah preračunaju.
- **Budžet**: promijeni gore — svi ulozi se skaliraju.
- **Uplaćen**: označi tikete koje si uplatio, upiši stvarni ulog, poslije utakmica klikni ✓ / ↺ (povrat) / ✗ po tipu. Zaglavlje prikazuje ukupan bilans.
- **Kopiraj tiket**: tekst tiketa za kladionicu.

## Tehnički

- `server.js` — HTTP server, poslovi s praćenjem napretka (SSE; analiza nastavlja i ako zatvoriš browser), historija u `data/`.
- `lib/claude.js` — Claude API: faza 1 `web_search_20260209` + `web_fetch_20260209` (nastavak nakon `pause_turn`), faza 2 structured output (JSON shema u `lib/schema.js`), adaptivno razmišljanje, server-side fallback.
- `lib/prompts.js` — instrukcije za istraživanje i strategiju.
- `public/calc.js` — matematika tiketa (kombinacija, pojedinačno, sistem k/n, povrat uloga, EV, obračun).
- `npm test` — testovi matematike i Claude integracije (lažni API odgovori, bez troška).

18+ · Klađenje nosi rizik gubitka novca. Igraj odgovorno.
