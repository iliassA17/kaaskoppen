# Ranglijst, app-icoon en vergrendelde planning

De ranglijst is bereikbaar voor alle bevestigde gebruikers met geldige
toegang, inclusief nieuwe gebruikers in hun proefweek. Een openbare gebruiker
kwalificeert na een boeking met een planningsdatum in de laatste zeven
Amsterdamse kalenderdagen, inclusief vandaag. Alleen toekomstige afspraken
kwalificeren niet. De dag-, week- en maandfilters bepalen de getoonde scores.

`POST /api/ranking` geeft alleen openbare actieve profielen en hun aantallen,
omzet en toegestane profielfoto terug. Een eigen inactief of privéprofiel
wordt toegevoegd als ongerangschikte grijze rij. Geen andere inactieve of
privéprofielen, e-mailadressen, UID's, uitnodigingscodes of afzonderlijke
boekingen worden teruggestuurd. Het beheerdersoverzicht Top Seller behoudt
de bestaande afzonderlijke beheerdersrechten. De Firestore-regels blijven
ongewijzigd; gewone gebruikers kunnen geen andere accounts of boekingen
rechtstreeks ophalen.

Bij verlopen toegang toont de betaalkeuze een verduisterde kalenderachtergrond.
`POST /api/schedule-preview` verifieert de Firebase-sessie en de eigen
accountkoppeling en maakt een SVG met uitsluitend dagen en tijdstippen uit
de eigen planning. Het is een niet-bedienbare illustratie, zonder klantnamen,
notities, prijzen of document-ID's. Hij toont de huidige week als daarin
boekingen staan, anders de eerstvolgende of meest recente geplande week.
De werkelijke app wordt verborgen en de lokale boekingslijst gewist.
De product-API's en database blijven verlopen toegang weigeren.

Beide functies gebruiken het bestaande privé `FIREBASE_SERVICE_ACCOUNT` voor
het ingestelde project; livesleutels of nieuwe regels zijn hiervoor niet nodig.
Antwoorden worden niet gecachet. De achtergrondafbeelding bestaat alleen
in het geheugen van de huidige sessie en wordt bij uitloggen verwijderd.
Een storing van de achtergrondweergave verandert niets aan de toegangscontrole.

De vier betaalopties staan op brede schermen in één rij en onder 850 pixels
in één kolom. Het venster blijft met toetsenbord en op telefoon bedienbaar.
Facturen en abonnementsbeheer blijven bereikbaar na het verlopen van toegang.

Het gouden kalendericoon is gegenereerd voor deze app en geëxporteerd als
192/512-pixel app-iconen, een 180-pixel Apple-touch-icoon en een favicon met
16/32/48-pixel varianten. Het webmanifest verwijst naar de startpagina en
opent een vastgezette app zonder browserbalk waar de browser dat ondersteunt.
Een bestaande snelkoppeling moet soms opnieuw aan het beginscherm worden
toegevoegd om het nieuwe icoon te gebruiken. Dit voegt geen offline toegang
tot privéboekingen toe.
