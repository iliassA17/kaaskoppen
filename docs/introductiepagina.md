# Introductie en rechtstreekse app-ingang

De live-versie gebruikt de volgende indeling:

- Introductie: https://boekingschema.netlify.app/
- App en login: https://boekingschema.netlify.app/app/
- Android- en iPhone-uitleg: https://boekingschema.netlify.app/app/#installeren

Dezelfde indeling blijft als proef beschikbaar op
https://boekingsschema-stripe-test.netlify.app/.

## Pagina's en sessies

`index.html` is de openbare introductie. Deze laadt geen Firebase-, Stripe- of
appcode en leest geen gebruikerssessies. De lokale bestanden in `/intro/`
bevatten de opmaak en de demonstratie. Die speelt automatisch af wanneer hij
in beeld komt en herhaalt zolang hij zichtbaar is. Buiten beeld of in een
verborgen tab pauzeert hij. Bij de voorkeur voor minder beweging staan de
stappen stil in beeld.

De demonstratie gebruikt fictieve gegevens. De scanneranimatie toont hoe iemand
zelf een screenshot kiest, het resultaat controleert en de boeking toevoegt.
De introductie verwerkt zelf geen afbeeldingen of gesprekken.

`app/index.html` laadt de bestaande beveiligde app. De appbestanden, Firebase-
configuratie, API-adressen en domeinnaam blijven gelijk. Een andere URL-path
maakt geen nieuw account of nieuwe database. De bestaande Firebase-sessie wordt
op dezelfde origin hersteld volgens de gekozen aanmeldoptie.

Het appmenu heeft een link naar `/#introductie`. Die expliciete link laat ook
binnen een geïnstalleerde app de introductie zien. De knop **Open de app** gaat
weer rechtstreeks naar `/app/`.

## Bestaande links

- `/intro/` en `/intro/index.html` verwijzen tijdelijk door naar `/`.
- `/boekingen.html` verwijst tijdelijk door naar `/app/`.
- Oude rootlinks met `?betaling=` of `?goto=` gaan naar `/app/`, inclusief query
  en fragment. Gewone bezoekers van `/` zien de introductie.
- Oude geïnstalleerde snelkoppelingen naar `/` gaan in standalone-weergave naar
  `/app/`. De expliciete menulink `/#introductie` is daarop een uitzondering.
- Nieuwe Stripe-checkouts en portals keren direct terug naar `/app/`.
- Pushmeldingen openen `/app/` of richten zich op een bestaande apptab. Een tab
  met alleen de introductie wordt daarvoor niet gebruikt.

Netlify gebruikt 302-redirects voor de oude ingangen. De kleine HTML-
doorverwijzingen werken ook op een eenvoudige lokale statische server.

## Op het beginscherm zetten

Het manifest heeft `start_url` en `scope` `/app/`. Het bestaande manifest-ID `/`
blijft behouden, zodat de app geen nieuwe installatie-identiteit krijgt. De
serviceworker blijft op `/sw.js` geregistreerd om bestaande pushregistraties
te behouden. Hij slaat geen HTML-pagina's in een offlinecache op.

De uitleg is toegankelijk vanaf het inlogscherm, het appmenu en de introductie.
Het venster heeft Android- en iPhone-tabbladen met elk drie lokale SVG-
voorbeeldschermen in `images/install/`. Gouden kaders markeren de relevante
knoppen. De afbeeldingen hebben alternatieve tekst en korte bijschriften;
browserdetails kunnen per versie verschillen. Het passende tabblad is op
iPhone/iPad vooraf geselecteerd en blijft met klikken of toetsenbord te wisselen.
De afbeeldingen worden uitgesteld geladen met `loading="lazy"`.

Op Android beschrijft die Chrome → menu → **App installeren** / **Toevoegen aan
startscherm**. Op iPhone beschrijft die Safari → deelmenu → **Zet op beginscherm**.
Als de browser een installatieprompt aanbiedt, verschijnt een extra knop. Een
bezoeker moet die zelf aanklikken; de app vraagt niet vanzelf om installatie.

Een link naar `#installeren` opent het uitlegvenster en verwijdert dat fragment
uit het adres, zodat een opgeslagen snelkoppeling niet telkens het venster opent.
De uitleg toont altijd de rechtstreekse `/app/`-link. Oude gewone webbladwijzers
naar het hoofdadres kunnen door de gebruiker worden vervangen.

## Uitnodigingen en een vaste plek

Nieuwe bezoekers gaan via `#uitnodiging` naar de WhatsApp-aanvraag aan de
beheerder. De link opent een vooraf ingevuld bericht; de bezoeker verstuurt het
zelf. De beheerder beoordeelt de aanvraag en deelt na goedkeuring een code.
Er worden geen aanvragen of codes automatisch verstuurd en geen betalingen
vanuit de introductie gestart.

De testversie houdt `noindex`. De live-versie gebruikt de canonical-URL en
deelmetadata van https://boekingschema.netlify.app/. Houd
de vaste prijsteksten gelijk aan de actuele app. Een eigen hoofddomein met een
apart app-subdomein kan later ook; pas dan alle app-links en gedeelde lokale
assets aan. Een domeinwijziging maakt geen deel uit van deze publicatie.

## Controleren

`npm test` controleert de introductie, app-ingang, redirects, installatie-uitleg,
optionele browserprompt, boekingen en schermbreedtes vanaf 320 pixels.
`npm run test:security` controleert daarnaast sessieherstel, de echte Firebase-
regels in lokale emulators, betaalterugkeeradressen en pushnavigatie. Deze
controles benaderen geen productieaccounts of echte betaalomgevingen.
