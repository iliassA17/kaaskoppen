# Stripe activeren op Windows

De code staat op GitHub in de branch **proefperiode-abonnementen**.
De abonnementsfunctie staat nog uit. De onderstaande stappen verbinden jouw
eigen Stripe-account en activeren de nieuwe versie.

| Per maand | Per halfjaar | Per jaar | Voor altijd |
| --- | --- | --- | --- |
| €7,99 | €39,99 | €59,99 | €99,99 eenmalig |

Alle prijzen zijn inclusief btw. De drie abonnementen verlengen tot de
gebruiker opzegt. De proefweek gaat nooit vanzelf over in een betaling.
De vijf oorspronkelijke accounts krijgen gratis blijvende toegang.

## 1. Open de nieuwe bestanden op je computer

1. Open [de nieuwe GitHub-branch](https://github.com/iliassA17/kaaskoppen/tree/proefperiode-abonnementen).
2. Klik **Code → Download ZIP**.
3. Open in Windows de map **Downloads**.
4. Klik met de rechtermuisknop op de zip en kies **Alles uitpakken**.
5. Open de uitgepakte map en de eventuele map die daarin staat, tot je
   **index.html**, **package.json** en de map **scripts** ziet.
6. Klik in de adresbalk bovenaan Verkenner, typ **powershell** en druk op Enter.
7. Plak deze opdracht en druk op Enter:

~~~powershell
npm ci
~~~

Wacht tot je opnieuw de PowerShell-prompt ziet. Dit is dezelfde soort map
als bij de eerdere migratie, maar nu met de nieuwe bestanden.

## 2. Maak je Stripe-account gereed

1. Open [dashboard.stripe.com](https://dashboard.stripe.com/).
2. Maak een account aan of log in.
3. Rond de gevraagde bedrijfs- en bankgegevens af voor echte betalingen.
4. Gebruik eerst een **Sandbox/testomgeving** om betalingen te controleren.
   Een testsleutel begint met **sk_test_**; een livesleutel met **sk_live_**.

Een Netlify Preview Deploy heeft op zichzelf geen aparte database. Gebruik
voor Stripe Sandbox een **apart Firebase-testproject en een aparte Netlify-testsite**
met fictieve accounts. Geef geen accounts in je echte database betaalde toegang
via Stripe-testbetalingen.

De automatische tests gebruiken lokale Firebase-emulators en een nagebootste
Stripe API. Ze vervangen een controle in jouw eigen Stripe Sandbox niet.
Voor een volledige Sandbox-test moet de Firebase-configuratie in **index.html**
naar het testproject wijzen. De servervariabelen en het serviceaccount moeten
datzelfde testproject gebruiken. Het inrichtingsscript verwacht bij de eerste
inrichting vijf gekoppelde accounts; gebruik daar vijf fictieve accounts.

Hieronder staan de waarden voor productie: Firebase-project **boekingsschema**
en site **boekingschema.netlify.app**. Voor een testsite gebruik je de bij elkaar
horende testwaarden. Laat BILLING_LIVE_ENABLED daar op false staan.

## 3. Stel de Stripe-sleutel privé in PowerShell in

1. Zoek in Stripe via **Developers / Ontwikkelaars → API keys** de **Secret key**.
   Afhankelijk van de weergave staat dit bij **Workbench**.
2. Kopieer de secret key van de juiste omgeving. De sleutel met **pk_** is
   een publieke sleutel; die gebruik je voor deze stap niet.
3. Plak onderstaande opdracht in PowerShell en druk op Enter:

~~~powershell
$env:STRIPE_SECRET_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Plak je Stripe secret key en druk Enter" -AsSecureString)).Password
~~~

4. Plak daarna de secret key en druk op Enter. De tekens worden verborgen.
   Dat je tijdens invoeren niets leesbaars ziet is hier de bedoeling.

De sleutel staat alleen in deze terminalsessie. Plak hem niet in GitHub,
de appbestanden, screenshots of de chat.

Voor het script gebruik je ook het privé Firebase-serviceaccountbestand
van de eerdere migratie. Controleer of de verwijzing nog werkt:

~~~powershell
if ($env:GOOGLE_APPLICATION_CREDENTIALS) { Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS } else { Write-Host "Niet ingesteld" }
~~~

De uitkomst hoort True te zijn. Als dit nog niet is ingesteld, gebruik dan
deze opdracht met het werkelijke pad naar jouw privé JSON-bestand:

~~~powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\PAD-NAAR-JOUW-PRIVE-BESTAND\service-account.json"
~~~

Vervang het voorbeeldpad volledig. Bewaar dit bestand buiten de appmap.
Schakel certificaatcontrole niet uit.

## 4. Maak een back-up en bereid de prijzen voor

Maak eerst een nieuwe privéback-up:

~~~powershell
node .\scripts\backup-firestore.cjs --project boekingsschema
~~~

Wacht op **BACK-UP GESLAAGD** en bewaar het bestand op je computer.
Voer daarna eerst alleen de controle uit:

~~~powershell
node .\scripts\setup-subscriptions.cjs --project boekingsschema
~~~

In het antwoord horen **"existingAccounts":5** en **"applied":false** te staan.
Controleer de vier bedragen en of **stripeMode** de juiste omgeving noemt.
Bij de eerste inrichting hoort **enabled** nog false te zijn.

Sla vervolgens de voorbereiding op:

~~~powershell
node .\scripts\setup-subscriptions.cjs --project boekingsschema --apply
~~~

Nu verschijnen **"applied":true** en **"enabled":false**. Het script maakt de
vier Stripe-prijzen aan en geeft de vijf bestaande UID's gratis blijvende
toegang. De proefperiode is nog niet actief.

Als het script meldt dat er geen vijf accounts zijn, verwijder dan geen
accounts om dit passend te maken. Laat de afwijking eerst controleren.

## 5. Publiceer de bijgewerkte Firebase-regels

1. Open [console.firebase.google.com](https://console.firebase.google.com/).
2. Kies project **boekingsschema**.
3. Open **Build → Firestore Database → Rules / Regels**.
4. Open op je computer het nieuwe bestand **firestore.rules** in Kladblok.
5. Selecteer met **Ctrl+A** alle inhoud en kopieer met **Ctrl+C**.
6. Klik in Firebase in het grote tekstvak met regels. Selecteer daar met
   **Ctrl+A** alle oude tekst en plak met **Ctrl+V** de nieuwe inhoud.
7. Klik op **Publish / Publiceren** en wacht op de bevestiging.

Omdat de functie nog uitstaat, houden bestaande gebruikers hun toegang.

## 6. Vul de privé instellingen in Netlify in

1. Open [app.netlify.com](https://app.netlify.com/) en kies je bestaande site.
2. Open **Project configuration / Site configuration → Environment variables**.
3. Klik voor iedere regel hieronder op **Add a variable → Add a single variable**.
4. Vul bij **Key** de naam in en bij **Value** de bijbehorende waarde.
5. Kies de scope **Functions** als je scopes kunt kiezen.
6. Gebruik livesleutels en BILLING_LIVE_ENABLED=true uitsluitend bij het
   deploycontext **Production**, niet bij Preview Deploys.

| Key | Value voor jouw productieomgeving |
| --- | --- |
| FIREBASE_PROJECT_ID | boekingsschema |
| APP_URL | https://boekingschema.netlify.app |
| STRIPE_SECRET_KEY | Jouw privé livesleutel uit Stripe |
| FIREBASE_SERVICE_ACCOUNT | De volledige JSON-inhoud van jouw privé Firebase-serviceaccountbestand |
| BILLING_LIVE_ENABLED | true, uitsluitend voor productie |

Open voor FIREBASE_SERVICE_ACCOUNT het privé JSON-bestand in Kladblok. Kopieer
de volledige inhoud, inclusief de eerste en laatste accolade, rechtstreeks
naar de geheime Netlify-waarde. Upload het bestand niet naar de publieke site.
De project_id in dat bestand moet **boekingsschema** zijn.

Bij stap 8 komt STRIPE_WEBHOOK_SECRET erbij. Een wijziging van variabelen
vereist daarna een nieuwe gepubliceerde deployment.

## 7. Publiceer de nieuwe code op Netlify

1. Open **Project configuration → Build & deploy → Continuous deployment**.
2. Zoek **Branches and deploy contexts / Production branch**.
3. Kies **proefperiode-abonnementen** als productiebranch en sla op.
4. Controleer dat de publicatiemap **.** is en Functions uit
   **netlify/functions** komen. Dit staat al in **netlify.toml**.
   Er is geen aparte frontend-buildopdracht nodig.
5. Open **Deploys** en start zo nodig een nieuwe build via **Trigger deploy**.
6. Wacht op een geslaagde build. Als je site nog op handmatig publiceren
   staat, open de nieuwe productie-deploy en klik **Publish deploy**.
7. Controleer dat deze deployment werkelijk **Published** is. Alleen een
   geslaagde build betekent niet dat je bezoekers al de nieuwe versie zien.

Je bestaande accounts kunnen nog steeds inloggen. De functie staat nog uit.
Upload niet uitsluitend de losse HTML: ook de vier nieuwe Netlify Functions
moeten bij de deployment aanwezig zijn.

## 8. Verbind de Stripe-webhook

1. Open in Stripe **Developers / Workbench → Webhooks**.
2. Klik **Add destination / Add endpoint** en kies een **Webhook endpoint**
   voor gebeurtenissen op jouw eigen Stripe-account.
3. Vul als endpoint-URL in:

~~~text
https://boekingschema.netlify.app/api/stripe-webhook
~~~

4. Kies bij een API-versiekeuze **2026-09-30.endive**.
5. Selecteer deze gebeurtenissen:

~~~text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
invoice.paid
invoice.payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
charge.refunded
charge.dispute.created
charge.dispute.closed
~~~

6. Sla het endpoint op. Open bij dat endpoint **Signing secret / Reveal**.
   Kopieer de waarde die begint met **whsec_**.
7. Voeg die in Netlify toe als geheime variabele **STRIPE_WEBHOOK_SECRET**,
   met scope Functions en hetzelfde deploycontext.
8. Start en publiceer een nieuwe productie-deploy.

Een testwebhook en een live webhook hebben verschillende geheimen.
Gebruik steeds het geheim van het endpoint bij dezelfde omgeving als de sleutel.

## 9. Zet het Stripe-klantenportaal aan

1. Open in Stripe **Settings → Billing → Customer portal**.
2. Activeer het portaal en stel je bedrijfsnaam in.
3. Zet betaalgegevens aanpassen en facturen bekijken aan.
4. Zet opzeggen aan en kies **at the end of the billing period**.
5. Laat abonnementstype/prijs en aantallen wijzigen via het portaal uitstaan
   voor deze versie. Na afloop kan een gebruiker een andere optie kiezen.
6. Sla op. Controleer dit in zowel de testomgeving als de live omgeving.

Checkout gebruikt de vaste bedragen inclusief btw. Vanuit deze code worden
geen extra belastingen of toeslagen toegevoegd. Automatische btw-berekening
en een btw-specificatie via Stripe Tax worden niet door dit script ingericht.

## 10. Controleer de Sandbox en activeer daarna productie

Controleer op de aparte testsite met de bijbehorende testdatabase en Stripe Sandbox:

- Een bevestigde nieuwe gebruiker krijgt zeven dagen proefgebruik.
- Een trial die in de testdatabase ouder dan zeven dagen is toont vier juiste prijzen.
- Afrekenen en terugkeren naar de app werken voor alle opties.
- Een geannuleerde of mislukte betaling geeft geen betaalde toegang.
- Dubbele webhooks verwerken dezelfde betaling niet nogmaals.
- Opzeggen laat toegang bestaan tot het einde van de betaalde periode.
- De vijf vrijgestelde accounts houden toegang.

In de Sandbox werkt testkaart **4242 4242 4242 4242**, met een toekomstige
vervaldatum en een willekeurige CVC. Deze kaart werkt niet in live mode.
Gebruik de activeringsopdrachten hieronder voor het testproject met diens
project-ID en testsleutel. Pas een trialdatum alleen in de testdatabase aan.

Als de productie-instellingen, webhook en gepubliceerde code gereed zijn,
ga je terug naar PowerShell met je productiecredentials en controleer je:

~~~powershell
node .\scripts\setup-subscriptions.cjs --project boekingsschema --enable
~~~

Dit zet nog niets aan. Als de controle geslaagd is, activeer je met:

~~~powershell
node .\scripts\setup-subscriptions.cjs --project boekingsschema --enable --apply
~~~

Het antwoord hoort **"enabled":true** en **"applied":true** te bevatten.
Open daarna je site met **Ctrl+F5**. Bestaande accounts blijven vrijgesteld;
nieuwe gebruikers beginnen hun proefweek bij hun eerste bevestigde login.
Registreren werkt in deze versie nog steeds met uitnodigingscodes.

Verwijder na het inrichten de Stripe-sleutel uit de terminalsessie:

~~~powershell
Remove-Item Env:STRIPE_SECRET_KEY
~~~

Dit verwijdert de instelling uit je terminal, niet uit Netlify.

## Als iets niet werkt

- **Betalen is nog niet ingesteld**: controleer de privé Netlify-variabelen,
  juiste deploycontext en of je opnieuw hebt gepubliceerd.
- **Live betalingen zijn uitsluitend…**: gebruik een aparte testomgeving voor
  een Preview Deploy of open de echte productie-deploy.
- **Prijscontrole mislukt**: controleer de omgeving en de afgesproken bedragen
  in Firebase en Stripe. Wijzig geen prijzen in de browser.
- **Betaling voltooid maar venster blijft staan**: kies **Opnieuw controleren**.
  Kijk bij het Stripe-webhook-endpoint of de aflevering HTTP 200 kreeg. Stripe
  probeert HTTP 503 opnieuw; HTTP 400 duidt vaak op een verkeerd signing secret.
- **Je hebt al een abonnement**: kies **Abonnement beheren** voor betaalgegevens
  of opzeggen, zodat er geen tweede abonnement ontstaat.
- **Login op preview mislukt**: controleer de bijgewerkte Firebase-regels en
  gepubliceerde Netlify Functions. Alleen statische bestanden zijn onvoldoende.

Deel bij hulp alleen de zichtbare foutmelding of de veilige scriptuitvoer.
Deel geen sleutels, volledige serviceaccountbestanden of back-ups.
