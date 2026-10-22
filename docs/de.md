# Jenkins

[Jenkins](https://www.jenkins.io/) ist der freie, selbst gehostete
Automatisierungsserver, mit dem Software gebaut, getestet und ausgeliefert wird.
Diese Integration verfolgt seine Jobs: Jeder wird ein Gerät mit dem Ergebnis
seines letzten Builds, dessen Nummer und Dauer und der Angabe, ob gerade ein
Build läuft; ein Gerät **Jenkins** fasst die Warteschlange, die Agenten offline
und die fehlgeschlagenen Jobs zusammen. Szenen können auf einen **beendeten
Build**, einen Job, der **fehlschlägt oder wieder grün wird**, oder einen
**Agenten, der offline geht**, reagieren, einen Job lesen und, wenn du es
erlaubst, **einen Job starten** – mit seinen Parametern. Ein Widget im Dashboard
zeigt alle Jobs auf einen Blick.

Getestet mit einem echten Jenkins 2.580 LTS (Docker); noch nicht mit einer echten
Gladys-Instanz: Rückmeldungen sind willkommen in
[den Issues](https://github.com/guim31/gladys-jenkins/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Ein Jenkins, das vom Gladys-Rechner aus erreichbar ist, im lokalen Netz oder im
  Internet.
- Einen Jenkins-Benutzer und sein API-Token. Lesen braucht die Rechte
  **Overall/Read** und **Job/Read**; Jobs aus Szenen starten braucht zusätzlich
  **Job/Build**.

Bei jeder Aktualisierung (standardmäßig jede Minute) stellt die Integration drei
leichte Anfragen: die Job-Liste mit den zehn neuesten Builds jedes Jobs (Ordner
eingeschlossen, drei Ebenen tief), die Warteschlange und die Knoten. Einen Job
zu starten kostet zwei weitere Anfragen, nur wenn eine Szene es verlangt.

## Erste Schritte

### 1. Ein API-Token erstellen

Klicke in Jenkins oben rechts auf deinen Namen, dann **Sicherheit → API-Token →
Neues Token hinzufügen**, gib ihm einen Namen und kopiere es (es wird nur einmal
angezeigt). Ein eigener Benutzer mit nur den oben genannten Rechten begrenzt, was
Gladys tun kann.

### 2. Die Integration konfigurieren

Öffne in Gladys **Integrationen → Jenkins → Konfiguration** und fülle aus:

- **Adresse von Jenkins**: die Adresse, mit der du Jenkins öffnest,
  `http://192.168.1.2:8080` oder `https://ci.example.com` (behalte den
  Unterpfad, falls Jenkins unter einem läuft, z. B.
  `https://example.com/jenkins`).
- **Benutzer** und **API-Token**: der Benutzer aus Schritt 1 und sein Token.
  Beide leer: anonymer Zugriff, falls dein Jenkins anonymes Lesen erlaubt.
- **Zu verfolgende Jobs**: leer für alle Jobs (höchstens 50), oder Job-Namen
  oder aus dem Browser kopierte Links, durch Kommas getrennt. Ein Ordnername
  verfolgt alle Jobs darin. Beispiel: `backup, infra/deploy`.
- **Szenen dürfen Jobs starten**: standardmäßig aus. Schalte es ein, um die
  Aktion **Jenkins-Job starten** zu nutzen.
- **Aktualisierungsintervall** und **Sprache der Namen**.

Klicke auf **Verbindung testen**: Jenkins und seine Version, wie viele Jobs
verfolgt werden, fehlgeschlagen oder in der Warteschlange sind, wie viele
Agenten offline sind, ob Szenen Jobs starten dürfen, und die aufgelisteten Jobs,
die Jenkins nicht kennt.

### 3. Die Geräte hinzufügen

Füge unter **Entdeckung** das Gerät **Jenkins** und die gewünschten Jobs hinzu.
Deren Werte kommen sofort. Die Szenen-Auslöser und das Widget funktionieren auch
für einen Job, der nicht als Gerät hinzugefügt ist.

## Die Geräte

### Ein Gerät pro Job

Benannt nach dem vollständigen Namen des Jobs (`ordner/job` in einem Ordner).
Jenkins gibt einem Job keine andere Kennung: Ein umbenannter Job wird ein neues
Gerät.

| Funktion                  | Typ    | Wert                                                                                       |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Status                    | Text   | Erfolgreich, Fehlgeschlagen, Instabil, Abgebrochen, Nicht gebaut, Läuft oder Nie gestartet |
| Letzter Build erfolgreich | binär  | 1, wenn der letzte beendete Build erfolgreich war, 0 bei Fehler oder instabil              |
| Läuft                     | binär  | 1, solange ein Build läuft                                                                 |
| Nummer des letzten Builds | Zähler | Nummer des letzten Builds                                                                  |
| Dauer des letzten Builds  | Dauer  | Dauer des letzten beendeten Builds, in Sekunden                                            |

Während ein Build läuft, zeigt der Status **Läuft**; **Letzter Build
erfolgreich** und **Dauer des letzten Builds** behalten die Werte des vorigen
Builds. Ein abgebrochener Build ändert **Letzter Build erfolgreich** nicht.

### Das Gerät Jenkins

| Funktion             | Typ    | Wert                                                             |
| -------------------- | ------ | ---------------------------------------------------------------- |
| Build-Warteschlange  | Zähler | wartende Builds                                                  |
| Agenten offline      | Zähler | Knoten offline (der eingebaute Knoten eingeschlossen)            |
| Fehlgeschlagene Jobs | Zähler | verfolgte Jobs, deren letzter Build fehlschlug oder instabil ist |
| Laufende Jobs        | Zähler | verfolgte Jobs, die gerade bauen                                 |

## Dashboard

Das Widget **Jenkins-Jobs** zeigt eine Zeile pro Job mit seinem Status und der
Nummer seines letzten Builds: fehlgeschlagene Jobs zuerst, dann die instabilen,
dann die laufenden. Eine Zeile darüber nennt die wartenden Builds und die
Agenten offline, wenn es welche gibt. Wähle in den Einstellungen einige Jobs aus,
oder lass das Feld leer für alle. **Aktualisieren** liest Jenkins sofort neu.

## Szenen

### Auslöser

- **Jenkins-Build beendet**: Ein Build eines verfolgten Jobs ist beendet, egal
  mit welchem Ergebnis (Filter auf den Job und das Ergebnis: erfolgreich,
  fehlgeschlagen, instabil, abgebrochen). Variablen: der Name des Jobs, die
  Build-Nummer, das Ergebnis in Worten, die Dauer in Sekunden, der Link und eine
  Zusammenfassung für eine Nachricht.
- **Jenkins-Job fehlgeschlagen oder wieder grün**: Ein Job schlägt fehl (ein
  fehlgeschlagener oder instabiler Build nach einem Erfolg, oder sein erster
  Build schlägt fehl), oder ist nach einem Fehler wieder erfolgreich (Filter auf
  den Job und die Änderung). Variablen: der Name des Jobs, die Build-Nummer, das
  Ergebnis, der Link und eine Zusammenfassung.
- **Jenkins-Agent offline**: Ein Knoten, der online war, geht offline (Filter
  auf den Namen des Agenten, leer für alle). Variablen: der Name des Agenten, der
  von Jenkins genannte Grund und eine Zusammenfassung.

Das erste Lesen eines Jobs oder Agenten lernt nur seinen Zustand: Die
Vergangenheit wird nie gemeldet. Höchstens drei Builds pro Job und Lesevorgang
werden gemeldet. Was gesehen wurde, behält die Integration: Ein Neustart
verpasst kein Ereignis und meldet keines doppelt.

### Aktionen

- **Jenkins-Job starten**: reiht einen Build eines verfolgten Jobs ein.
  Optionale Parameter, `NAME=Wert` durch `&` getrennt (z. B.
  `TARGET=prod&VERSION=1.2`), oder ein JSON-Objekt für einen Wert mit `&` (`{"MESSAGE": "a & b"}`); leer nimmt der Job seine Standardwerte. Ein
  Parameter, den der Job nicht deklariert, wird abgelehnt. Erfordert **Szenen
  dürfen Jobs starten** in der Konfiguration. Variablen: der Name des Jobs, ob
  der Build eingereiht wurde, und seine Nummer in der Warteschlange. Der Build
  läuft in Jenkins weiter: Nutze **Jenkins-Build beendet**, um auf sein Ende zu
  reagieren.
- **Jenkins-Job lesen**: der Zustand eines verfolgten Jobs als Variablen für die
  nächsten Aktionen: Status in Worten, letztes Ergebnis, letzter Build
  erfolgreich, läuft, Nummer und Dauer des letzten Builds, Link.

### Ideen für Szenen

- **Jenkins-Job fehlgeschlagen oder wieder grün**, Änderung „Fehlgeschlagen“ →
  die Bürolampe rot schalten und die Zusammenfassung senden; Änderung „Wieder
  grün“ → sie wieder weiß schalten.
- Jede Nacht um 3:00 Uhr, wenn niemand zu Hause ist → **Jenkins-Job starten**
  `backup`; **Jenkins-Build beendet** für `backup` mit dem Ergebnis
  „Fehlgeschlagen“ → eine Nachricht senden.
- **Jenkins-Agent offline** → dir eine Nachricht mit der Zusammenfassung
  schicken: Der Rechner des Agenten ist vielleicht aus.

## Fehlerbehebung

- **Jenkins antwortet nicht**: Prüfe die Adresse vom Gladys-Rechner aus (gleicher
  Port, gleiches Protokoll); ein Gladys in Docker erreicht den Host über seine
  IP-Adresse, nicht über `localhost`.
- **Die Adresse leitet um**: Gib die `https://`-Adresse ein, bei der der Browser
  landet, mit dem Unterpfad, falls vorhanden.
- **Benutzer oder API-Token abgelehnt**: Das Token wurde widerrufen oder falsch
  eingegeben; erstelle ein neues. Ein Passwort funktioniert auch, ein Token ist
  aber besser.
- **Zugriff verweigert**: Es ist kein Benutzer eingetragen, obwohl Jenkins
  anonymes Lesen verweigert, oder dem Benutzer fehlt **Overall/Read**.
- **Jenkins hat abgelehnt: Der Benutzer braucht das Recht Job/Build**: Gib es
  ihm, oder lass das Starten aus.
- **Keine Jenkins-API unter dieser Adresse**: Die Adresse zeigt auf einen anderen
  Dienst, oder der Unterpfad fehlt.
- Ein Job erscheint nicht: Er liegt tiefer als drei Ordnerebenen, oder mehr als
  50 Jobs passen zur Liste: Liste weniger Jobs oder Ordner auf.
- **Zertifikat abgelehnt**: Ein selbstsigniertes Zertifikat wird nicht
  akzeptiert; nutze im lokalen Netz die `http://`-Adresse.

## Grenzen

- Jobs starten ist der einzige Befehl, und er ist standardmäßig aus. Builds
  lassen sich aus Gladys nicht stoppen.
- Höchstens 50 Jobs, drei Ordnerebenen tief; Jenkins wird höchstens jede Minute
  gelesen: Ein Ereignis kommt bis zu ein Intervall verspätet.
- Ein Job ist an seinem vollständigen Namen erkannt: Umbenennen oder Verschieben
  in einen anderen Ordner ergibt ein neues Gerät.
- Die zehn neuesten Builds jedes Jobs werden gelesen: Enden mehr als zehn Builds
  zwischen zwei Lesevorgängen, werden die ältesten nicht gemeldet.
- Pipeline-Stufen, Testberichte und Build-Protokolle werden nicht gelesen.
- Die Texte der Geräte und Szenen folgen der Sprache der Konfiguration; die
  Funktionsnamen werden beim Hinzufügen eines Geräts festgelegt.
- Entwickelt und getestet mit Jenkins 2.580 LTS; ältere Versionen mit derselben
  JSON-API sollten funktionieren, ohne Garantie.
