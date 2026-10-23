# Losse introductiepagina

De eerste versie staat op `/intro/` van de testsite:
https://boekingsschema-stripe-test.netlify.app/intro/

De bestaande ingang `/` blijft de app met het inlogscherm. De introductiepagina
laadt geen Firebase-, Stripe- of appcode en leest geen gebruikerssessies. Het is
een statische pagina met eigen opmaak en een korte, afspeelbare demonstratie.
De demonstratie gebruikt fictieve gegevens en toont handmatige invoer na een
klantgesprek; er is geen automatische WhatsApp-koppeling.

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

Registratie vereist momenteel een uitnodigingscode. De pagina noemt dit bij
de proefweek; de knoppen openen de app en starten zelf geen betaling.

## Controleren

`npx playwright test tests/intro.spec.cjs` controleert de afzonderlijke
inlogroute, externe verzoeken, demo, pauzeren en hervatten, mobiel menu,
veelgestelde vragen, schermbreedtes vanaf 320 pixels en minder beweging.
