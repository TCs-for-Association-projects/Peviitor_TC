# Peviitor_TC — Instrucțiuni de configurare (Română)

Ghid pas cu pas pentru a pune în funcțiune acest repository de management al testelor QA de la zero. Urmează pașii **în ordine** — fiecare depinde de cei anteriori.

> 🇬🇧 **English version:** [`INSTRUCTIONS.md`](./INSTRUCTIONS.md)

---

## Înainte de a începe

Ai nevoie de:
- Un **cont GitHub** cu permisiune de a crea repository-uri și de a rula workflow-uri.
- Un **browser web**. Atât pentru fluxul de bază.
- *(Opțional, doar pentru dezvoltare locală)* **Node.js 20 sau mai nou** — descarcă de la <https://nodejs.org/>.

Timp total: **aproximativ 15 minute**, în mare parte așteptând ca GitHub Actions să termine.

---

## Pasul 1 — Urcă codul în repository-ul tău GitHub

Alege una dintre cele două opțiuni.

### Varianta A: Ai deja codul pe calculator

1. Creează un **repository nou, gol** pe GitHub (de ex. `Peviitor_TC`). Nu îl inițializa cu README.
2. Deschide un terminal în folderul proiectului.
3. Conectează folderul la noul repository:
   ```bash
   git remote set-url origin https://github.com/NUMELE_TAU/Peviitor_TC.git
   git push -u origin main
   ```

### Varianta B: Pornești de la repository-ul altcuiva

1. Pe GitHub, apasă butonul **Fork** din dreapta sus a repository-ului original.
2. GitHub va crea o copie în contul tău. Gata cu pasul acesta.

---

## Pasul 2 — Activează workflow-urile

Pe un fork nou, GitHub Actions pot fi dezactivate implicit.

1. Intră în repository-ul tău pe GitHub.
2. Apasă tab-ul **Actions**.
3. Dacă apare un banner galben cu *„Workflows aren't being run on this forked repository"*, apasă **I understand my workflows, go ahead and enable them**.
4. În bara laterală din stânga ar trebui să vezi 5 workflow-uri:
   - Auto-Label Test Case
   - Bootstrap Labels
   - Generate Test Case Template
   - Test Execution
   - Test Matrix

---

## Pasul 3 — Creează etichetele (rulează Bootstrap Labels)

Acest pas creează toate cele ~50 de etichete colorate (epic-uri, story-uri, statusuri etc.) de care au nevoie workflow-urile.

1. Intră în **Actions** → apasă **Bootstrap Labels** în bara laterală.
2. Apasă dropdown-ul **Run workflow** din dreapta.
3. Lasă branch-ul pe `main` și apasă butonul verde **Run workflow**.
4. Așteaptă ~30 secunde. Reîncarcă pagina — rularea ar trebui să aibă o bifă verde.
5. Verifică: mergi la **Issues → Labels**. Ar trebui să vezi etichete precum `epic: F1`, `story: US1`, `status: Passed`, `Test_Case` etc.

> ✅ **Ce a făcut acest pas:** a creat toate etichetele pe care le folosesc dashboard-ul și scripturile de auto-etichetare. Poate fi rulat din nou oricând adaugi epic-uri sau story-uri noi în `config/epics-and-stories.json`.

---

## Pasul 4 — Generează șablonul de formular pentru test case

Formularul de creare a test case-urilor este generat automat din `config/epics-and-stories.json`.

1. Intră în **Actions** → apasă **Generate Test Case Template**.
2. Apasă **Run workflow** → **Run workflow**.
3. Așteaptă ~20 secunde. Un commit nou `chore: regenerate test_case.yml from config` va apărea pe `main`.

> ✅ **Ce a făcut acest pas:** a scris `.github/ISSUE_TEMPLATE/test_case.yml` pe baza config-ului tău. Se rulează automat de fiecare dată când editezi fișierul de config.

---

## Pasul 5 — Activează GitHub Pages (dashboard-ul)

1. Intră în **Settings** (tab-ul din dreapta sus) → **Pages** (bara laterală stânga).
2. La **Source**, selectează **Deploy from a branch**.
3. La **Branch**, alege `main` și folderul `/docs`. Apasă **Save**.
4. Așteaptă ~1 minut. Pagina va afișa:
   > Your site is live at `https://NUMELE_TAU.github.io/Peviitor_TC/`
5. Deschide acel URL într-un tab nou. Ar trebui să vezi **dashboard-ul QA** (posibil gol dacă nu există încă niciun test case).

---

## Pasul 6 — Generează datele inițiale pentru dashboard

1. Intră în **Actions** → apasă **Test Matrix**.
2. Apasă **Run workflow** → **Run workflow**.
3. Așteaptă ~30 secunde. Un commit nou `chore: update test matrix` va apărea pe `main`.
4. Reîncarcă URL-ul tău de GitHub Pages. Dashboard-ul reflectă acum toate issue-urile cu eticheta `Test_Case`.

> ✅ **Ce a făcut acest pas:** a preluat toate issue-urile etichetate `Test_Case`, a regenerat `docs/index.html`, `docs/test-matrix.json` și `docs/test-matrix.csv`. Acest workflow rulează și **automat, la fiecare eveniment pe un issue**, și **în fiecare noapte la ora 03:00 UTC**.

---

## Pasul 7 — Creează primul test case

1. Intră în **Issues** → **New issue**.
2. Apasă **Get started** lângă **Test Case**.
3. Completează formularul:
   - **Title** — folosește formatul `TC - [Funcționalitate] - [Acțiune] - [Rezultat așteptat]`
     *Exemplu:* `TC - Link-uri footer - Hover și click - Se deschid paginile corecte`
   - **Epic** și **User Story** — alege-le pe cele care se potrivesc (user story-ul este prefixat cu codul epic-ului).
   - **Summary**, **Description**, **Testing Type**, **Website Section**, **Test Environment** — completează după caz.
   - **Test Steps** — înlocuiește placeholder-ul cu pașii reali, un rezultat așteptat per bifă.
4. Apasă **Submit new issue**.
5. În ~10 secunde, un comentariu al botului poate apărea (doar dacă ceva nu e în regulă — de exemplu dacă epic-ul și user story-ul nu se potrivesc). Etichete precum `epic: F1`, `story: US1`, `type: Navigation`, `status: Not run` vor fi aplicate automat.

---

## Pasul 8 — Execută un test case (ca tester)

**Nu edita corpul issue-ului după creare.** Folosește **comenzi slash în comentarii**.

1. Deschide issue-ul test case-ului.
2. Derulează până la căsuța de comentarii din partea de jos.
3. Scrie una sau mai multe comenzi:
   ```
   /status passed
   ```
   sau
   ```
   /status failed #42
   /cross-browser
   ```
4. Apasă **Comment**.
5. În ~10 secunde, botul răspunde cu un sumar de execuție formatat care arată tranziția de status, eventualele link-uri către bug-uri și un link către dashboard.

### Lista completă de comenzi

| Comandă | Ce face |
|---|---|
| `/status passed` | ✅ Marchează ca trecut |
| `/status failed #123` | ❌ Marchează ca picat și leagă bug-ul #123 |
| `/status blocked` | 🟡 Marchează ca blocat |
| `/status partially-passed` | 🟠 Trecere parțială |
| `/status not-run` | ⚪ Resetează la „nerulat" |
| `/bug #123` | 🐛 Leagă un bug fără a schimba statusul |
| `/note observatia mea` | 📝 Adaugă o observație fără a schimba statusul |
| `/cross-os` | Activează/dezactivează flag-ul cross-OS |
| `/cross-browser` | Activează/dezactivează flag-ul cross-browser |

Poți combina mai multe comenzi într-un singur comentariu — fiecare este procesată în ordine.

> ⚠ **Include mereu o referință la un bug când marchezi un test ca picat.** Botul te avertizează dacă nu o faci.

---

## Pasul 9 — Vizualizează dashboard-ul

Reîncarcă `https://NUMELE_TAU.github.io/Peviitor_TC/`. Workflow-ul Test Matrix rulează automat la fiecare modificare de issue, așa că noul test case și statusul său de execuție ar trebui să apară într-un minut.

**Cele patru pagini ale dashboard-ului:**

- **Overview** — KPI-uri, bară de status, grafic pe epic-uri, donut-uri de distribuție.
- **Test Cases** — tabel filtrabil și sortabil. Încearcă filtrele: epic, assignee, status.
- **Coverage** — matrice interactivă de trasabilitate a cerințelor și analiză a lacunelor.
- **Guide** — documentație încorporată pentru configurare și ghid pentru începători, cu structuri JSON copy-paste.

**Scurtături:**
- Apasă **`/`** oriunde pentru a muta focus-ul pe căutarea globală.
- Apasă iconița **🌙 / ☀️** din dreapta sus pentru a schimba între tema întunecată și cea luminoasă.
- Folosește link-urile **⬇ CSV** și **⬇ JSON** din footer pentru a exporta datele.

---

## Pasul 10 — Întreținere (pe termen lung)

### Adaugă un Epic sau User Story nou

1. Editează `config/epics-and-stories.json` direct pe GitHub (iconița creion pe fișier).
2. Adaugă intrarea nouă în array-ul `epics` sau `userStories`, cu un ID unic, o etichetă și un număr de issue.
3. Fă commit pe `main`.
4. Workflow-urile **Generate Test Case Template** și **Bootstrap Labels** rulează automat și actualizează formularul, respectiv creează etichetele noi.

### Adaugă un tip de testare, secțiune sau mediu nou

Același proces — editează `config/epics-and-stories.json` și fă commit. Workflow-urile se ocupă de restul.

### Ceva arată greșit pe dashboard

1. Intră în **Actions** → **Test Matrix** → apasă **Run workflow** pentru a forța regenerarea.
2. Fă refresh forțat paginii dashboard (`Ctrl+Shift+R` / `Cmd+Shift+R`).

---

## Depanare (Troubleshooting)

**Etichetele nu s-au aplicat pe noul meu test case.**
→ Issue-ul trebuie să aibă eticheta `Test_Case`. Șablonul o aplică automat. Dacă ai creat issue-ul fără șablon, adaugă eticheta manual și workflow-ul de auto-etichetare se va rerula.

**Comanda slash nu a funcționat.**
→ Verifică dacă comentariul este pe un issue care are eticheta `Test_Case`. Comenzile din *corpul* issue-ului sunt ignorate — trebuie să fie într-un *comentariu*.

**Dashboard-ul este gol.**
→ Nu ai rulat încă **Test Matrix** (Pasul 6), sau nu există issue-uri cu eticheta `Test_Case`. Asigură-te și că GitHub Pages este activat (Pasul 5).

**Workflow-ul a picat cu „permission denied" la push.**
→ Intră în **Settings → Actions → General → Workflow permissions** și setează pe **Read and write permissions**.

---

## Ghid rapid

| Vreau să… | Fac asta |
|---|---|
| Creez un test case | Issues → New issue → șablon Test Case |
| Marchez un test ca trecut | Comentez `/status passed` pe issue |
| Marchez ca picat cu bug | Comentez `/status failed #123` pe issue |
| Adaug epic-uri noi | Editez `config/epics-and-stories.json` și fac push |
| Forțez refresh-ul dashboard-ului | Actions → Test Matrix → Run workflow |
| Export toate datele | Footer-ul dashboard-ului → ⬇ CSV sau ⬇ JSON |

---

<sub>Pentru detalii tehnice complete, vezi [`README.md`](./README.md).</sub>
