# Losse introductiepagina

De eerste versie staat op `/intro/` van de testsite:
https://boekingsschema-stripe-test.netlify.app/intro/

De bestaande ingang `/` blijft de app met het inlogscherm. De introductiepagina
laadt geen Firebase-, Stripe- of appcode en leest geen gebruikerssessies. Het is
een statische pagina met eigen opmaak en een korte demonstratie. Die speelt
automatisch af zodra hij in beeld komt en herhaalt zolang hij zichtbaar is.
Buiten beeld of in een verborgen tab pauzeert de animatie. Bij de voorkeur
voor minder beweging staan alle stappen stil in beeld, zonder bedienknoppen.
De demonstratie gebruikt fictieve gegevens en toont hoe een gebruiker na een
klantgesprek zelf een screenshot kiest, de gevonden datum en tijd controleert
en de boeking toevoegt; er is geen automatische WhatsApp-koppeling. Het is een
animatie van het proces en verwerkt zelf geen afbeeldingen.

## Een vaste plek kiezen

Een logische indeling voor later is een openbare website op een eigen
hoofddomein en de app op een apart app-adres, bijvoorbeeld een subdomein `app`.
Zo kunnen bezoekers eerst kennismaken met Boekingsschema, terwijl bestaande
gebruikers rechtstreeks hun app blijven openen. Er is nog geen nieuw domein
gekozen of ingesteld. `/intro/` kan ondertussen als aparte, deelbare pagina
blijven bestaan.

Bij verplaatsing naar een andere website:

- Pas de links met `href="/"` in `intro/index.html` aan naar het definitieve
  app-adres. De overige links verwijzen naar onderdelen binnen de pagina.
- Neem de gebruikte bestanden uit `/fonts/`, `/icon-192.png` en `/favicon.ico`
  mee, of pas de verwijzingen aan. De pagina heeft geen bouwstap nodig.
- Verwijder `noindex, nofollow` pas als de openbare website definitief is.
- Voeg dan de definitieve canonical-URL en deelmetadata toe.
- Houd de prijsteksten en voorwaarden gelijk aan de actuele app. Deze pagina
  toont vaste teksten en haalt geen prijzen uit de betaalomgeving op.

Registratie vereist momenteel een uitnodigingscode. Nieuwe bezoekers gaan
via `#uitnodiging` naar een WhatsApp-aanvraag aan de beheerder. De link opent
een vooraf ingevuld bericht aan het door de beheerder opgegeven nummer;
de bezoeker verstuurt het zelf. Er wordt geen aanvraag automatisch verstuurd,
opgeslagen of goedgekeurd en er wordt geen code automatisch uitgegeven.
Na goedkeuring deelt de beheerder de code. Bestaande gebruikers kunnen direct
naar de app. Geen van deze knoppen start een betaling.

## Controleren

`npx playwright test tests/intro.spec.cjs` controleert de afzonderlijke
inlogroute, externe verzoeken, starten bij scrollen, herhalen en pauzeren
buiten beeld, mobiel menu, veelgestelde vragen, de uitnodigingslink,
schermbreedtes vanaf 320 pixels en minder beweging.
