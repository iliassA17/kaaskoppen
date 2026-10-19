# Boekingsschema

De aangeleverde boekingsapp met prijs- en betrouwbaarheidsverbeteringen en een
nieuwe login via Firebase Authentication. De hoofdpagina is `index.html`.
`boekingen.html` verwijst door naar dezelfde beveiligde app.

**Activeer deze versie samen met de Firebase-instellingen en databaseregels.**
Alleen de bestanden uploaden naar Netlify is onvoldoende. Zie
[Veilig inloggen activeren](docs/veilig-inloggen.md) voor de volledige procedure,
het behoud van bestaande accounts en het instellen van beheerdersrechten.

## Ontwikkelen en testen

Vereist: Node.js 22 of nieuwer, npm, Python 3 en Chromium. De Firebase-tests
vereisen ook Java 21 of nieuwer.

```sh
cd /workspace/kaaskoppen
npm ci
npm test
npm run test:security
npm run dev
```

`npm run dev` start de statische frontend op poort 8000. De cloudomgeving heeft
Chromium op `/usr/bin/chromium`. Elders kun je `CHROMIUM_PATH` instellen of
`npx playwright install chromium` uitvoeren. `npm test` start en stopt zelf een
aparte server op poort 8765.

`npm run test:security` start zelf lokale Auth- en Firestore-emulators voor
`demo-kaaskoppen`, test de echte databaseregels, migratie en tokencontrole en
voert daarna browsertests uit met de Firebase-SDK. Dit gebruikt geen
productieaccounts, verstuurt geen echte e-mails en publiceert geen regels.
De emulator wordt bij de eerste uitvoering van Google gedownload; de cache
staat standaard naast de checkout in `/workspace/.cache/kaaskoppen`.

De browsertests blokkeren externe verzoeken en gebruiken een lokale Firestore-
testimplementatie. Ze controleren gratis boekingen en statistieken, behoud van
instellingen, veilige tekstweergave, tijdvakconflicten, herstel na opslagfouten,
herhaald klikken en ongedaan maken. Ze testen geen echte Firebase-toegang,
e-mails, OCR, pushberichten of Pathé-resultaten.

De gewone frontend gebruikt de bestaande Firebase-projectconfiguratie. Gebruik
voor handmatige wijzigingen een apart testproject; de geautomatiseerde tests
maken geen verbinding met de bestaande database.

## Netlify

`netlify.toml` publiceert de statische bestanden en de twee serverfuncties.
De eenvoudige lokale server voert Netlify-functies niet uit. Voor die functies
is een Netlify-ontwikkelomgeving of deployment nodig:

- Pathé zoeken: `ANTHROPIC_API_KEY`.
- Pushberichten: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` en eventueel
  `VAPID_SUBJECT`. De publieke sleutel moet overeenkomen met die in de frontend.

Zet geheime waarden uitsluitend in de beveiligde omgevingsinstellingen.
Er zijn geen servercredentials aangeleverd of gekopieerd.

De frontend laadt SDK's van `www.gstatic.com` en `cdn.jsdelivr.net`, gebruikt
`firestore.googleapis.com`, `identitytoolkit.googleapis.com` en
`securetoken.googleapis.com` en laadt lettertypen van `fonts.googleapis.com` en
`fonts.gstatic.com`. EmailJS gebruikt `api.emailjs.com`. De filmzoekfunctie
gebruikt vanuit de server `api.anthropic.com`. De server verifieert Firebase-
tokens met publieke certificaten van `www.googleapis.com`; daarvoor is geen
serviceaccountsleutel op Netlify nodig. `FIREBASE_PROJECT_ID` is standaard
`boekingsschema` en moet voor een ander Firebase-project worden aangepast.

## Grenzen van deze eerste verbeterronde

Opslagfouten herstellen nu de lokale boekingen en undo-geschiedenis. Tijdens
opslag worden andere boekingsacties tegengehouden. Dit voorkomt geen conflicten
tussen verschillende apparaten: de bestaande opslag vervangt nog de volledige
boekingenlijst van de gebruiker. De nieuwe inlogbeveiliging werkt pas op de
live site zodra de procedure in `docs/veilig-inloggen.md` is uitgevoerd.

De ranglijst is voorlopig alleen voor beheerders beschikbaar: de oude ranglijst
las alle privéboekingen en accountgegevens. Een openbare ranglijst vereist een
aparte, beperkte gegevensbron. Gewone gebruikers versturen geen pushberichten
meer naar alle abonnees; beheerders kunnen dat met een geldig token wel.

Er is geen buildstap: HTML, CSS en JavaScript worden rechtstreeks geserveerd.

## Prijsfix v2 controleren

De browsertests controleren nu ook expliciet het wijzigen van een bestaande
boeking van €10 naar €0, de opgeslagen gegevens en het opnieuw openen na
herladen, op beide HTML-pagina's. De opgeslagen standaardprijs wordt bij het
laden opnieuw ingevuld, ook als die €0 is.

Pak `Boekingsschema-prijsfix-v2.zip` uit en deploy de inhoud op de bestaande
Netlify-site; `index.html` moet direct in de publicatiemap staan. Het aanpassen
van bestanden in deze werkmap of in de zip verandert een bestaande Netlify-
deployment niet. Controleer na de deployment dat een boeking na bewerken naar
€0, opslaan en herladen €0 blijft.
