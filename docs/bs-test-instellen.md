# BS test instellen

Deze branch **stripe-sandbox** is uitsluitend bestemd voor de nieuwe testsite.
Firebase-project: **bs-test-b94c7**. De publieke webconfiguratie is al ingevuld
en gecontroleerd bij Firebase. Bovenaan de app staat **TESTOMGEVING — BS test**.

De productiecode blijft op **proefperiode-abonnementen**. Maak een nieuwe
Netlify-site voor deze testbranch. Gebruik een serviceaccount van **BS test**
en een Stripe Sandbox-sleutel. De server weigert andere cloudprojecten en
Stripe-livesleutels.

## Wat in Firebase al is voorbereid

- Project BS test is aangemaakt.
- Authentication: Email/Password is ingeschakeld.
- Firestore (default) is aangemaakt en de appregels zijn gepubliceerd.
- De webapp is geregistreerd.

## Privé serviceaccount downloaden

1. Klik op **Continue to console** in het registratiescherm.
2. Open links **Settings → Project settings**.
3. Open **Service accounts** en zo nodig **Firebase Admin SDK**.
4. Controleer dat je nog in project **BS test** bent.
5. Klik **Generate new private key** en bevestig met **Generate key**.
6. Bewaar het gedownloade JSON-bestand privé, buiten de uitgepakte appmap.

Dit bestand wordt alleen lokaal en in de geheime Netlify Functions-instellingen
gebruikt. Upload het niet naar GitHub, de openbare site of de chat.

## Nieuwe bestanden downloaden

1. Open de GitHub-branch **stripe-sandbox**.
2. Kies **Code → Download ZIP** en pak de zip uit in een nieuwe map.
3. Open de map waarin package.json staat.
4. Klik in de adresbalk van Verkenner, typ powershell en druk op Enter.
5. Voer uit:

~~~powershell
npm ci
~~~

Gebruik daarna dezelfde PowerShell-sessie voor de privé instellingen en scripts.
Een variabele in een ander PowerShell-venster is hier niet automatisch ingesteld.

## Privé instellingen in PowerShell

Gebruik je bestaande Stripe-testsleutel uit de Sandbox:

~~~powershell
$env:STRIPE_SECRET_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Plak je Stripe-testsleutel en druk Enter" -AsSecureString)).Password
~~~

Kies één testwachtwoord van minimaal 12 tekens voor de fictieve testaccounts.
Gebruik letters, cijfers en een leesteken. Onthoud dit wachtwoord privé:

~~~powershell
$env:SANDBOX_PASSWORD = [System.Net.NetworkCredential]::new("", (Read-Host "Kies je testwachtwoord en druk Enter" -AsSecureString)).Password
~~~

Stel GOOGLE_APPLICATION_CREDENTIALS in op het werkelijke pad naar het nieuwe
JSON-bestand van **BS test**, bijvoorbeeld:

~~~powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\JOUW-NAAM\Downloads\JOUW-BS-TEST-BESTAND.json"
Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS
~~~

Vervang de voorbeeldnaam en het pad. De controle hoort True te tonen.
Het script weigert een serviceaccount van je productieproject.

## Testaccounts en prijzen voorbereiden

Controleer eerst zonder iets op te slaan:

~~~powershell
node .\scripts\setup-sandbox.cjs
~~~

De uitvoer bevat project bs-test-b94c7 en applied false. Sla daarna op:

~~~powershell
node .\scripts\setup-sandbox.cjs --apply
~~~

Het script maakt de vier afgesproken prijzen in Stripe Sandbox aan. Het maakt
vijf fictieve bestaande accounts met gratis toegang en daarna een afzonderlijke
proefgebruiker. Je echte accounts en boekingen worden niet gekopieerd.

Inloggen op de testsite:

| Rol | E-mailadres | Wachtwoord |
| --- | --- | --- |
| Beheerder | beheerder@example.test | Je zelfgekozen SANDBOX_PASSWORD |
| Nieuwe proefgebruiker | proef@example.test | Hetzelfde testwachtwoord |

Deze fictieve accounts zijn door het privéscript al als bevestigd gemarkeerd.
Er worden geen verificatiemails naar deze testadressen verstuurd. Het script
reset bestaande wachtwoorden niet wanneer je het opnieuw uitvoert.

## Afzonderlijke Netlify-testsite

1. Maak in Netlify een **nieuw project** via importeren van GitHub.
2. Kies iliassA17/kaaskoppen en branch **stripe-sandbox**.
3. Laat de buildopdracht leeg en gebruik publicatiemap **.**.
   netlify.toml bevat de Functions-map en Node-versie al.
4. Noteer de nieuwe testsite-URL.
5. Voeg bij de nieuwe Netlify-site de omgevingsvariabelen uit .env.example toe:
   FIREBASE_PROJECT_ID is bs-test-b94c7 en APP_URL is je nieuwe testsite-URL.
6. Stel STRIPE_SECRET_KEY privé in op de testsleutel. Stel
   FIREBASE_SERVICE_ACCOUNT in op de volledige privé JSON-inhoud van BS test.
   Laat BILLING_LIVE_ENABLED false.
7. Maak in **Stripe Sandbox** een webhook naar de nieuwe testsite:
   https://JOUW-TESTSITE.netlify.app/api/stripe-webhook.
8. Gebruik de gebeurtenissen uit de Stripe-handleiding en zet het signing
   secret van dit Sandbox-endpoint als STRIPE_WEBHOOK_SECRET op de testsite.
9. Publiceer opnieuw na het instellen van de variabelen.
10. Voeg in Firebase **BS test → Authentication → Settings → Authorized domains**
    de nieuwe testsite-hostnaam toe, zonder https:// of een pad.
11. Activeer het klantenportaal in Stripe Sandbox volgens de Stripe-handleiding.

## Proefweek inschakelen en verlopen testen

Als de testsite, geheime instellingen en webhook gereed zijn:

~~~powershell
node .\scripts\setup-sandbox.cjs --enable --apply
~~~

Log op de nieuwe testsite in als proef@example.test. De eerste bevestigde login
start zeven dagen proefgebruik. De beheerder blijft vrijgesteld.

Om de proefweek in deze testomgeving direct als verlopen te testen:

~~~powershell
node .\scripts\setup-sandbox.cjs --expire --apply
~~~

Het script zet alleen de proefdatum van de fictieve proefgebruiker op acht dagen
geleden. Het overschrijft geen betaalde of gratis toegang en verwijdert geen
boekingen. Kies daarna een optie in het centrale venster. Gebruik uitsluitend
Stripe Sandbox-testbetaalgegevens, zoals kaart 4242 4242 4242 4242 met een
toekomstige vervaldatum en een willekeurige CVC.

Voor meerdere betaaltests met dezelfde proefgebruiker moet een eerder
Sandbox-abonnement volledig zijn beëindigd en de bijbehorende testbetaling
zijn terugbetaald voordat een nieuwe optie kan worden gekozen. Laat de
webhooks verwerken. Je kunt levenslang als laatste optie testen.

## Automatische tests

~~~sh
npm test
npm run test:security
~~~

Deze tests gebruiken lokale emulators met project demo-kaaskoppen. Deze lokale
uitzondering werkt alleen wanneer beide vaste emulatorhosts zijn ingesteld.
Er worden vanuit deze werkomgeving geen gebruikers in BS test aangemaakt:
dat gebeurt pas wanneer de eigenaar het privéscript lokaal uitvoert.
