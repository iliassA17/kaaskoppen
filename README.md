# Boekingsschema

De aangeleverde app uit `Boekingsschema-fix-tijdvakken.zip`. De hoofdpagina is
`index.html`; de oudere `boekingen.html` blijft beschikbaar. Beide pagina's
hebben de gedeelde correcties voor opslaan, prijzen en logmeldingen.

## Ontwikkelen en testen

Vereist: Node.js 22 of nieuwer, npm, Python 3 en Chromium.

```sh
cd /workspace/kaaskoppen
npm ci
npm test
npm run dev
```

`npm run dev` start de statische frontend op poort 8000. De cloudomgeving heeft
Chromium op `/usr/bin/chromium`. Elders kun je `CHROMIUM_PATH` instellen of
`npx playwright install chromium` uitvoeren. `npm test` start en stopt zelf een
aparte server op poort 8765.

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
`firestore.googleapis.com` en laadt lettertypen van `fonts.googleapis.com` en
`fonts.gstatic.com`. EmailJS gebruikt `api.emailjs.com`. De filmzoekfunctie
gebruikt vanuit de server `api.anthropic.com`.

## Grenzen van deze eerste verbeterronde

Opslagfouten herstellen nu de lokale boekingen en undo-geschiedenis. Tijdens
opslag worden andere boekingsacties tegengehouden. Dit voorkomt geen conflicten
tussen verschillende apparaten: de bestaande opslag vervangt nog de volledige
boekingenlijst van de gebruiker. Inloggen gebruikt nog de aangeleverde eigen
wachtwoordhash en browseropslag; migratie naar Firebase Authentication en
bijbehorende toegangsregels is een aparte wijziging. De Firestore-regels zitten
niet in het zipbestand en zijn niet beoordeeld.

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
