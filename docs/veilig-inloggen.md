# Veilig inloggen activeren

Deze wijziging is voorbereid en lokaal getest. Productieaccounts, Firebase-
instellingen, regels en de live Netlify-site zijn tijdens ontwikkeling niet
gewijzigd. Voer de onderstaande stappen als eigenaar van het Firebase-project
uit voordat je de nieuwe site beschikbaar maakt voor gebruikers.

## Wat verandert voor gebruikers?

- Inloggen met het bestaande **e-mailadres**, met behoud van de gebruikersnaam
  en alle bestaande boekingen. Er wordt geen nieuw account geregistreerd om
  bestaande boekingen terug te krijgen.
- Firebase Authentication verwerkt wachtwoorden, sessies, verificatiemails en
  resetmails. De app bewaart geen eigen wachtwoordhash of resetcode meer.
- E-mailverificatie is verplicht. Nieuwe registraties gebruiken een eenmalige
  uitnodiging en een wachtwoord van minimaal 12 tekens.
- Het gedeelde beheerderswachtwoord vervalt. Alleen persoonlijke accounts met
  een door de projecteigenaar toegekende `admin`- of `beheerder`-claim krijgen
  toegang. Een veld in het gebruikersprofiel geeft geen beheerrechten.
- De oude URL `/boekingen.html` verwijst door naar de beveiligde hoofdpagina.

## 1. Firebase Authentication instellen

Open project **boekingsschema** in de Firebase-console:

1. Authentication → Sign-in method: schakel **Email/Password** in.
2. Authentication → Settings → Authorized domains: voeg
   **boekingschema.netlify.app** toe. Voeg ook een eigen productiedomein toe als
   je dat gebruikt. Autoriseer alleen domeinen die je daadwerkelijk gebruikt.
3. Stel het wachtwoordbeleid in op minimaal **12 tekens** en kies afdwingen.
   Daarmee geldt de eis ook voor herstel en rechtstreekse API-verzoeken.
4. Controleer de templates voor e-mailverificatie en wachtwoordherstel. Gebruik
   voor deze eerste versie de standaard Firebase-actiepagina's, die de
   eenmalige codes controleren. Laat e-mailenumeratiebescherming ingeschakeld.

De frontend bevat de bestaande publieke Firebase-projectconfiguratie. Deze is
geen beheerderscredential. Gebruik je een ander project, pas dan de configuratie
in `index.html` én `FIREBASE_PROJECT_ID` in Netlify aan.

## 2. Bestaande accounts veilig overzetten

Plan een kort onderhoudsmoment en maak eerst een databaseback-up. Gebruik een
vertrouwde computer met Node 22+ en
Google Application Default Credentials die bevoegd zijn om gebruikers en
Firestore-gegevens in dit project te beheren. Deel geen sleutels of
wachtwoorden in de chat en bewaar serviceaccountbestanden buiten de appmap.

Installeer de afhankelijkheden en start eerst de controle zonder wijzigingen:

```sh
npm ci
node scripts/migrate-auth.cjs --project boekingsschema --admin JOUW_GEBRUIKERSNAAM
```

Vervang `JOUW_GEBRUIKERSNAAM` door het bestaande gebruikersnaam-document van de
eigenaar. Met `--staff ANDERE_GEBRUIKERSNAAM` kun je een medewerker aanwijzen.
Deze vlaggen verlenen echte rechten: neem geen lijst uit oude profielvelden
over zonder te controleren wie deze personen zijn.

De controle behoudt bestaande namen precies zoals ze zijn, ook korte namen,
hoofdletters, spaties en accenten. De strengere naamregels gelden alleen voor
nieuwe registraties. Bestaande namen mogen voor een veilige weergave maximaal
128 tekens bevatten: letters, accenten, cijfers, spaties, punten, `@`, `_` en
`-`, met minstens een letter of cijfer. Gereserveerde namen zijn uitgesloten.
Bij niet ondersteunde namen toont de controle de betreffende namen. Hernoem of
verwijder zulke accounts niet zelf: bestaande boekingen verwijzen naar die namen.

De controle stopt ook bij dubbele e-mailadressen of bestaande conflicterende
Firebase-identiteiten. Los die op met behoud van alle gekoppelde boekingen;
het script voegt dergelijke accounts niet zomaar samen.
Bij dubbele e-mailadressen worden alle groepen betrokken gebruikersnamen
getoond, zonder de e-mailadressen zelf af te drukken. Hoofdletters en spaties
rond een e-mailadres maken er geen ander adres van. Deze controle gebeurt
voordat Firebase Authentication wordt benaderd, ook met `--apply`.
Voor inloggen met e-mail en wachtwoord heeft elk account in dit project een
uniek, bereikbaar e-mailadres van de eigenaar nodig. Controleer eerst welke
accounts bij wie horen en welke behouden moeten blijven. Gebruik geen
verzonnen adressen en verwijder of hernoem geen accounts om de melding te
omzeilen: boekingen zijn aan de bestaande gebruikersnamen gekoppeld.
Controleer ook dat de bestaande e-mailadressen aan de juiste personen behoren:
zij krijgen straks via hun inbox toegang.

Maak na een geslaagde controle een lokale Firestore-back-up:

```sh
node scripts/backup-firestore.cjs --project boekingsschema
```

Dit gebruikt dezelfde Google Application Default Credentials, leest alle
collecties en subcollecties en verandert niets in Firebase. Het schrijft pas
een bestand als alle gegevens zijn gelezen en controleert het opgeslagen
bestand met een checksum. Eerdere back-ups worden niet overschreven. Op
Windows wordt het bestand automatisch in `%LOCALAPPDATA%\KaaskoppenBackups`
opgeslagen, buiten de appmap. Het bevat persoonsgegevens en mogelijk oude
wachtwoordhashes: bewaar het privé en upload het niet naar GitHub, Netlify of
de chat. De terminal toont alleen het bestandspad en aantallen.

Houd de app tijdens het maken van deze back-up ongebruikt en vraag andere
gebruikers hetzelfde te doen. De uitlezing is geen atomaire database-export:
wijzigingen tijdens het uitlezen kunnen een inconsistent beeld geven. Deze
back-up bewaart veldtypen, maar bevat geen Firebase Authentication-gebruikers,
regels of projectinstellingen. Het is een app-specifiek JSON-formaat, geen
bestand voor de beheerde Firestore-import. Voor herstel kunnen de documenten
met `decodeValue` uit het script door een beheerder worden teruggezet. De
tests controleren dit op een lokale emulator. Bewaar ook de oorspronkelijke
appversie en regels voor herstel; zet oude open regels niet publiek terug.
Bij een nog niet ondersteund veldtype of een verwijzing naar een andere
database stopt het script zonder een complete back-up te melden.

Op Windows gebruik je `npm.cmd ci` in PowerShell. Kopieer de bestaande
gebruikersnaam bij `--admin` exact, inclusief eventuele hoofdletters. Voer eerst
alleen de controle zonder `--apply` uit. Een geslaagde controle toont bijvoorbeeld
`{"accounts":5,"codes":3,"applied":false}`; de aantallen verschillen per project.

Het script weigert verbinding als `NODE_TLS_REJECT_UNAUTHORIZED` op `0` staat.
Herstel de certificaatcontrole in het huidige PowerShell-venster met:

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

Als deze onveilige instelling in je persoonlijke Windows-omgevingsvariabelen is
opgeslagen, verwijder haar ook daar met:

```powershell
[Environment]::SetEnvironmentVariable('NODE_TLS_REJECT_UNAUTHORIZED', $null, 'User')
```

Verschijnt daarna een certificaatfout, los dan de oorzaak in de vertrouwde
certificaten op. Schakel de certificaatcontrole niet opnieuw uit.

Voer tijdens het onderhoudsmoment eerst de nieuwe Firestore-regels uit stap 3
door. Daardoor kunnen oude clients geen onbeveiligde wijzigingen meer doen.
Voer vervolgens de gecontroleerde migratie expliciet uit:

```sh
node scripts/migrate-auth.cjs --project boekingsschema --admin JOUW_GEBRUIKERSNAAM --apply
```

Het script maakt Firebase-gebruikers zonder het oude wachtwoord te importeren,
koppelt hun UID aan hun bestaande naam, verwijdert oude hashes en resetcodes en
normaliseert de uitnodigingscodes. Boekingen en instellingen blijven staan.
Een herhaalde uitvoering behoudt dezelfde koppelingen. Het script verzendt geen
e-mails en toont geen wachtwoorden of resetlinks.

Als de uitvoering tussentijds mislukt, houd de oude client afgesloten, los de
gemelde oorzaak op en voer dezelfde migratie opnieuw uit. Een databaseback-up
herstelt geen wijzigingen in Firebase Authentication. Publiceer daarom niet de
oude open regels om een migratiefout te omzeilen.

## 3. Databaseregels publiceren

Publiceer de inhoud van `firestore.rules` via Firestore Database → Rules in de
Firebase-console, of met de Firebase CLI op de vertrouwde computer:

```sh
npx firebase deploy --only firestore:rules --project boekingsschema
```

Deze publicatie is een aparte handeling. Een GitHub-push of Netlify-deployment
publiceert de Firebase-regels niet. Met deze regels zijn boekingen, instellingen
en pushabonnementen alleen toegankelijk voor de eigenaar en voor expliciet
bevoegde beheerders. Oude resetcodes en onbekende verzamelingen zijn afgesloten.

## 4. Netlify en eerste login

Deploy de branch `veilig-inloggen` via de GitHub-koppeling van Netlify, zodat de
serverfuncties en hun afhankelijkheden ook worden verwerkt. Alleen Netlify Drop
is onvoldoende voor deze functies. De bestaande `netlify.toml` bevat de
publicatiemap en functiesmap.

De Netlify-functies controleren voortaan Firebase ID-tokens. Filmzoeken vereist
een geverifieerd account; push naar alle gebruikers vereist daarnaast een
beheerdersclaim. De bestaande API- en VAPID-instellingen blijven voor die
optionele functies nodig. Zet `FIREBASE_AUTH_EMULATOR_HOST` en
`FIRESTORE_EMULATOR_HOST` **niet** in de productieomgeving.

Voor ieder gemigreerd account:

1. Kies op de nieuwe site **Wachtwoord vergeten?** met het bestaande e-mailadres,
   of stuur vanuit Firebase Authentication een resetmail aan de gebruiker.
2. Stel via de ontvangen Firebase-mail een nieuw wachtwoord in.
3. Log in. Als de e-mail nog niet bevestigd is, vul het wachtwoord opnieuw in en
   kies **Verificatiemail opnieuw versturen**. Bevestig via de mail en log in.
4. Controleer de eigen bestaande boekingen, een wijziging, herladen en uitloggen.
   Controleer met een tweede account dat de boekingen van de eerste gebruiker
   niet toegankelijk zijn. Controleer beheer met het aangewezen beheerdersaccount.

De lokale emulator-tests dekken deze paden, maar vervangen deze productiecontrole
met de werkelijk gepubliceerde instellingen niet.

## Later beheerdersrechten wijzigen

Alleen een vertrouwde projecteigenaar voert dit met Admin-bevoegdheden uit:

```sh
node scripts/set-role.cjs --project boekingsschema --user GEBRUIKERSNAAM --role beheerder
node scripts/set-role.cjs --project boekingsschema --user GEBRUIKERSNAAM --role beheerder --apply
```

Gebruik `admin` voor volledig beheer en `user` om beheerrechten in te trekken.
De eerste opdracht controleert alleen; `--apply` wijzigt claims en trekt
refresh-tokens in. Laat de gebruiker opnieuw inloggen. Reeds afgegeven
ID-tokens kunnen tot hun verloop, doorgaans maximaal ongeveer een uur, de oude
claims bevatten. Bij het verwijderen van een profiel in de app moet de eigenaar
het bijbehorende Firebase Authentication-account ook via de console verwijderen.

## Functionele beperkingen van deze versie

De gewone ranglijst is verborgen omdat deze alle privéboekingen las. Beheerders
kunnen die gegevens voor hun beheertaak wel bekijken. Een ranglijst voor gewone
gebruikers kan later op een beperkte openbare gegevensbron worden aangesloten.
Een gewone gebruiker kan een melding plaatsen, maar geen push naar alle
abonnees versturen. Beheerders kunnen wel algemene updates en push publiceren.

Deze wijziging lost het afzonderlijke probleem van gelijktijdige wijzigingen
van de volledige boekingenlijst vanaf meerdere apparaten nog niet op.
