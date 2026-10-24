# Boekingsschema

**Deze branch `stripe-productie` is de voorbereide productieversie voor
Firebase-project `boekingsschema` en https://boekingschema.netlify.app.**
Hij bevat de geteste verbeteringen uit `stripe-sandbox`, waaronder factuurbeheer,
herstel van betaalde toegang en sneller sessieherstel. De testsite blijft de
afzonderlijke branch `stripe-sandbox` gebruiken. Echte betalingen vereisen een
livesleutel, een passend productie-serviceaccount en `BILLING_LIVE_ENABLED=true`.
Zie [Stripe activeren op Windows](docs/stripe-activeren-windows.md).

De aangeleverde boekingsapp met prijs- en betrouwbaarheidsverbeteringen en een
nieuwe login via Firebase Authentication. De introductie staat op `/`
(`index.html`) en de beveiligde app op `/app/` (`app/index.html`).
De clientlogica en publieke Firebase-configuratie staan in `app-main.js`;
de aanvullende vormgeving staat in `app.css`.
`boekingen.html` verwijst door naar dezelfde beveiligde app. De visuele
installatie-uitleg voor Android en iPhone staat bij de login en in het appmenu.
Zie [Introductie en app-ingang](docs/introductiepagina.md).

**Activeer deze versie samen met de Firebase-instellingen en databaseregels.**
Alleen de bestanden uploaden naar Netlify is onvoldoende. Zie
[Veilig inloggen activeren](docs/veilig-inloggen.md) voor de volledige procedure,
het behoud van bestaande accounts en het instellen van beheerdersrechten.

Deze versie bevat een proefweek en vier Stripe-betaalopties:
€7,99 per maand, €39,99 per halfjaar, €59,99 per jaar of €99,99 levenslang,
inclusief btw. De vijf bestaande accounts worden gratis vrijgesteld. Deze
functie staat standaard uit en moet met het eigen Stripe-account en de
beveiligde serverinstellingen worden geactiveerd. Zie
[Proefperiode en abonnementen](docs/proefperiode-abonnementen.md).

De ranglijst voor leden, het app-icoon en de vergrendelde kalenderachtergrond
staan beschreven in [Ranglijst en appweergave](docs/ranglijst-en-appweergave.md).

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

`netlify.toml` publiceert de statische bestanden en de serverfuncties.
De eenvoudige lokale server voert Netlify-functies niet uit. Voor die functies
is een Netlify-ontwikkelomgeving of deployment nodig:

- Toegang controleren: `subscription-status`. Dit is nodig bij inloggen, ook als
  proefgebruik nog uitstaat; alleen statische bestanden uploaden is onvoldoende.
- Stripe: `create-checkout-session`, `create-portal-session` en `stripe-webhook`.
  Vereist privé omgevingsvariabelen en een webhook; zie
  [Stripe activeren op Windows](docs/stripe-activeren-windows.md).
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
tokens met publieke certificaten van `www.googleapis.com`; de toegangscontrole
leest Firestore met het token van de gebruiker. Daarvoor is geen
serviceaccountsleutel op Netlify nodig. `FIREBASE_PROJECT_ID` is standaard
`boekingsschema` en moet voor een ander Firebase-project worden aangepast.

## Grenzen van deze eerste verbeterronde

Opslagfouten herstellen nu de lokale boekingen en undo-geschiedenis. Tijdens
opslag worden andere boekingsacties tegengehouden. Een transactie wijzigt alleen
de getroffen documenten en weigert een verouderde wijziging van dezelfde boeking.
Boekingen van een tweede apparaat en oude, niet gewijzigde records blijven staan.
De nieuwe inlogbeveiliging werkt pas op de
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
