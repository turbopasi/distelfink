# Changelog

Alle nennenswerten Änderungen an Distelfink, neueste zuerst.

Der Abschnitt zur jeweiligen Version wird beim Release automatisch in die
GitHub-Release-Notes übernommen (siehe `.github/workflows/release.yml`). Die
Überschrift muss deshalb genau `## <Version>` lauten und zum Tag passen —
ohne passenden Abschnitt bricht der Release-Workflow ab.

Die Versionierung folgt der üblichen Lesart für 0.x: Die mittlere Zahl steigt
bei neuen Funktionen, die letzte bei Fehlerbehebungen.

## 0.13.1 — 2026-09-27

Ein Stabilitäts-Update ohne neue Funktionen: Distelfink verliert keinen Text
mehr beim Schließen und kommt mit Sync über mehrere Rechner besser zurecht.

### Behoben

- **Kein Textverlust mehr beim Schließen.** Wer das Fenster über das X oder
  Alt+F4 schloss, verlor bis zu zwei Sekunden Getipptes, dazu offene Änderungen
  an Mindboards, Personen- und Orts-Dokumenten. Jetzt wird vorher alles
  gesichert und ein Sicherungspunkt gesetzt. Ist noch ein Schreibkonflikt
  offen, fragt Distelfink nach.
- **Update und Projektwechsel sichern vorher.** Das automatische Update beendet
  die App erst, nachdem alles gespeichert ist. Wer über „Letzte Projekte" ein
  anderes Projekt öffnet, verliert ebenfalls nichts mehr.
- **Sync von einem zweiten Rechner.** Änderungen am Binder übernehmen jetzt,
  was ein anderer Rechner inzwischen in der Projektdatei geändert hat. Bisher
  konnten dort angelegte Szenen dabei aus dem Binder verschwinden. Zeitstrahl
  und Mindboards erkennen extern geänderte Dateien und fragen, welche Version
  gelten soll.
- **Sichereres Speichern.** Dateien werden erst vollständig geschrieben und
  dann ausgetauscht. Ein Absturz oder Stromausfall mitten im Speichern
  hinterlässt keine leere oder halbe Szene mehr.
- Ein Eintrag verschwand aus dem Binder, wenn das Verschieben in einen nicht
  mehr vorhandenen Ordner scheiterte.
- Nach einem internen Fehler ließ sich bis zum Neustart nichts mehr speichern.

### Geändert

- **Keine Hänger mehr.** Export (vor allem PDF), Suche, Sicherungspunkte und
  das Öffnen großer Projekte laufen im Hintergrund. Die Oberfläche bleibt
  bedienbar, und Schreiben und Speichern laufen währenddessen weiter.
- **Schnellere Suche** in großen Projekten: der Suchindex entsteht in einem
  Rutsch statt Eintrag für Eintrag.
- **Flüssigeres Tippen in langen Texten**, besonders im Fluss-Modus. Wörter und
  Normseiten in der Statusleiste zählen jetzt einen Augenblick nach dem Tippen.
- **Die Ansicht eines Mindboards** (Ausschnitt und Zoom) merkt sich jeder
  Rechner selbst. Verschieben und Zoomen ändern die Projektdatei nicht mehr –
  kein Sync und kein Verlaufseintrag pro Mausrad.
- Aktualisierte Bibliotheken: Editor (tiptap 3.31) und React 19.3.

## 0.13.0 — 2026-09-26

### Neu

- **Mindboards.** Ein neues Planungsmodul für freies Brainstorming: Notizen
  liegen ohne feste Ordnung auf einer unendlichen Fläche. Ein Doppelklick legt
  eine Notiz an, Strg+Enter gleich die nächste darunter. Wer eine Notiz auf
  eine andere zieht, verbindet beide — mit gedrückter Umschalttaste als Pfeil;
  dasselbe noch einmal löst die Verbindung wieder. Linien lassen sich
  beschriften, Notizen einfärben, umrahmen und in Schriftgröße und Stärke
  ändern.
- Pro Projekt beliebig viele Boards, angelegt, umbenannt und gelöscht über die
  neue Gruppe „Mindboards" in der Planungsleiste. Ihr Text ist über die
  Schnellsuche zu finden.
- **Bilder auf dem Board.** Bilddateien aus dem Explorer einfach auf das Board
  ziehen oder ein Bild aus der Zwischenablage mit Strg+V einfügen — etwa einen
  Bildschirmausschnitt. Bilder lassen sich an der Ecke in der Größe ändern.
- **Personen, Orte und Szenen** aus den Seitenleisten auf das Board ziehen; ein
  Doppelklick öffnet sie nebenan.
- **Hintergrundformen** fassen zusammengehörige Notizen ein und nehmen sie beim
  Verschieben mit. Dazu Rahmenauswahl, Ausrichten und Stapeln, Kopieren und
  Einfügen, Rückgängig/Wiederholen, Zoom mit Strg+Mausrad und Export als
  PNG-Bild in den Farben des aktuellen Themes.

## 0.12.0 — 2026-09-24

### Neu

- **Orte im Zeitstrahl.** Ereigniskarten haben einen Abschnitt „Verknüpfte
  Orte": wo das Ereignis spielt, steht als Liste aus Kartennadel und Namen
  darin — anders als bei den Personen als Text, weil ein Ort selten ein Bild
  hat und an zwei Initialen nicht zu erkennen wäre. Ein Klick öffnet den Ort
  nebenan, ein Rechtsklick löst die Verknüpfung. Verknüpft wird per Drag & Drop
  aus der Planungsleiste oder über das Plus neben der Überschrift — wie schon
  bei Dokumenten und Personen.
- **Vorgefertigte Farbthemes.** Neben Hell, Dunkel, Sepia und Mitternacht steht
  unter „Weitere Themes" eine Auswahl fertiger Farbpaletten nach den Themes von
  daisyUI, nach Hell und Dunkel gruppiert und je mit einer dreifarbigen
  Vorschau. Wer ein eigenes Theme baut, kann eine davon als Ausgangspunkt
  übernehmen.

### Entfernt

- **Notizen.** Das dritte Planungsdokument neben Personen und Orten hatte kein
  eigenes Profil: ein Titel und ein Fließtext, also genau das, was ein Dokument
  im Binder auch kann. Wer etwas notiert, legt es künftig dort ab. Mit den
  Notizen entfallen ihre Gruppe in der Planungsleiste, ihre Einträge in
  Schnellsuche und Papierkorb und der Planungs-Tag „/note" im Fließtext.
- Vorhandene Projekte werden dabei nicht angefasst: der Ordner `notes/` bleibt
  liegen, die Notizen stehen dort weiter als Markdown-Dateien und lassen sich
  in jedem Editor öffnen. Alte `note:`-Tags im Manuskript sind ab jetzt
  gewöhnliche Links — im Export war davon ohnehin nur der sichtbare Text zu
  sehen.

## 0.11.0 — 2026-09-21

### Neu

- **Personen im Zeitstrahl.** Ereigniskarten haben einen Abschnitt
  „Verknüpfte Personen": wer im Ereignis vorkommt, steht als Reihe runder
  Avatare darin — mit Bild, sonst mit Initialen, der Name im Tooltip. Ein Klick
  öffnet die Person nebenan, ein Rechtsklick löst die Verknüpfung.
- **Verknüpfen per Drag & Drop.** Dokumente aus dem Binder und Personen aus
  der Seitenleiste lassen sich einfach auf eine Ereigniskarte ziehen, egal
  wohin auf der Karte. Beim Überfahren zeigt sie eine gestrichelte Kante und
  darunter schon, wie der Eintrag nach dem Loslassen dasteht. Ist er bereits
  verknüpft, verweigert der Zeiger, und der vorhandene Eintrag leuchtet auf.

### Geändert

- **Aufgeräumte Verknüpfungen.** Verknüpfte Dokumente stehen als schlichte,
  linksbündige Liste aus Symbol und Titel statt als Chips. Das Dropdown am
  Fuß ist einem kleinen gestrichelten Plus neben der Überschrift gewichen;
  sein Menü ist aufgebaut wie der Binder, Kapitel klappen als Untermenü auf,
  Verknüpftes trägt ein Häkchen. Das gilt auch bei Personen und Orten.
- **Lange Ereignistitel brechen um,** statt seitlich aus der Karte zu laufen.
- **Kein Browser-Menü mehr auf leeren Flächen.** Ein Rechtsklick neben die
  Inhalte bot bisher „Neu laden" und „Untersuchen" an. In Textfeldern und im
  Editor bleibt das Menü stehen — dort hängen die Rechtschreibvorschläge.

### Behoben

- Ein Untermenü, das über den Nachbarstrang des Zeitstrahls ausklappte, lag
  hinter dessen Karten und wirkte durchsichtig.
- Nachdem man eine Karte in einen anderen Strang gezogen hatte, konnte ein
  späteres Ziehen auf einen leeren Slot die alte Karte noch einmal verschieben.
- Ein ganz geleerter Ereignistitel blieb leer stehen, statt auf den alten
  zurückzuspringen.

## 0.10.0 — 2026-09-19

### Neu

- **Markierten Text per Rechtsklick verknüpfen.** Ein Planungs-Tag entstand
  bisher nur über „/person " und Verwandte: Tag leer eröffnen, Label tippen,
  ENTER. Für ein Wort, das längst dasteht, war das der falsche Weg herum.
  Jetzt reicht markieren, Rechtsklick, „Verlinken mit" — die Auswahl im
  Suchfeld legt sich sofort über die Markierung, samt „neu anlegen", wenn es
  die Person, den Ort oder die Notiz noch nicht gibt. Über einem fertigen Tag
  bietet dasselbe Menü „Öffnen" und „Verknüpfung lösen" an, die bisher nur die
  Vorschau beim Überfahren kannte.

  Das Menü erscheint bewusst nicht bei jedem Rechtsklick im Editor: über einem
  Wort mit blinkendem Cursor bleibt das native Menü stehen, weil dort die
  Rechtschreibvorschläge hängen.

### Geändert

- **Der Status hängt als Fähnchen an der Oberkante der Karte.** In der
  Ordnerübersicht teilte sich die Statuspille die Kopfzeile mit dem Titel. Auf
  schmalen Karten ging das nicht auf — „ÜBERARBEITUNG" ist fast so breit wie
  eine Karte und quetschte den Titel zu einer Wortsäule. Die Pille sitzt jetzt
  halb über der Kartenkante, der Titel hat die volle Breite, und der Zustand
  einer Karte ist zu sehen, bevor man ihren Namen liest. Das Symbol im Titel
  bleibt dabei auf der ersten Zeile, statt neben einem umbrochenen Titel mittig
  zu schweben.

## 0.9.1 — 2026-09-18

### Geändert

- **Distelfink hat ein eigenes Signet.** Bisher trug die Anwendung nur die
  Wortmarke und ein Platzhalter-Icon aus der Gesabbel-Zeit. Der Stieglitz-Kopf
  steckt jetzt im Programm-Icon, in der Taskleiste, im Installer, auf dem
  Startbildschirm, im Fenster „Über Distelfink“ sowie auf der Website und im
  Repository. Quelle aller Größen ist `public/brand/distelfink-icon.svg`.

## 0.9.0 — 2026-09-10

### Geändert

- **Die Anwendung heißt jetzt Distelfink.** Der bisherige Name Gesabbel war als
  Arbeitstitel gedacht; „Distelfink" ist der volkstümliche Name des Stieglitz
  und trägt den Vogel- und Österreichbezug, der zum Projekt passen sollte.
  Umbenannt wurden Fenstertitel, Wortmarke, Repository, Website und alle
  internen Bezeichner.
- **Neuer Anwendungs-Identifier** (`io.github.turbopasi.distelfink`). Damit ist
  Distelfink für das Betriebssystem ein eigenständiges Programm: Bestehende
  Gesabbel-Installationen erhalten kein Update mehr, bleiben parallel
  installiert und müssen von Hand deinstalliert werden. Einstellungen und die
  Liste zuletzt geöffneter Projekte beginnen leer, weil sie am Identifier
  hängen. **Projekte selbst sind nicht betroffen** — sie liegen unverändert im
  Dateisystem und lassen sich normal öffnen.

## 0.8.0 — 2026-09-09

### Neu

- **Zeitstrahl mit mehreren Handlungssträngen.** Ein Zeitstrahl war bisher eine
  einzige Kette von Ereignissen; die meisten Geschichten laufen aber in mehreren
  Strängen parallel. Jeder Strang trägt jetzt einen Namen und eine Farbe aus der
  Palette des Binders, jedes Ereignis hängt an einem Strang. Die Ansicht kippt
  zwischen Spalten (Stränge nebeneinander, die Zeit läuft nach unten) und Zeilen
  (untereinander, die Zeit läuft nach rechts). Ein Datum gibt es weiterhin
  bewusst nicht — „Wann?" bleibt Freitext, damit auch erfundene Kalender
  funktionieren. Bestehende Zeitstrahlen wandern beim Öffnen in den Strang
  „Haupthandlung".
- **Slots und Lücken.** Die Karten standen nur in ihrer eigenen Reihenfolge
  nebeneinander: dass zwei Ereignisse zur selben Zeit passieren, ließ sich nicht
  zeigen, und dass in einem Strang gerade nichts geschieht, erst recht nicht.
  Alle Stränge teilen sich jetzt ein Raster aus Slots — gleicher Slot heißt „zur
  selben Zeit", und ein ausgelassener Slot ist eine gewollte Lücke, die als
  gestrichelter Rahmen im Bild stehen bleibt. Eine Lücke lässt sich in einen
  einzelnen Strang einfügen, der sich damit sichtbar gegen die anderen
  verschiebt, oder über alle Stränge gemeinsam. Gezogen wird auf einen Slot:
  ein freier nimmt die Karte auf, ein belegter schiebt die dortige Karte und
  alles danach einen Slot weiter. Die Pfeiltasten rücken slotweise und tauschen
  nur dann, wenn der Nachbarplatz belegt ist.
- **Griff an den Ereigniskarten.** Wo man eine Karte anfassen muss, war nicht zu
  sehen. Jetzt sitzt links in der Kopfzeile ein Griff — und nur er zieht, sodass
  das Markieren im Text die Karte nicht mehr mitreißt.

### Behoben

- **Am automatischen Zeilenumbruch hing ein Leerzeichen.** Es belegte Breite,
  statt über den Rand zu hängen: im Blocksatz endete die Zeile sichtbar vor dem
  rechten Rand, und passte das Leerzeichen nicht mehr in die Zeile, rückte es
  die nächste ein.

## 0.7.0 — 2026-09-05

### Neu

- **Absatzformat.** Wie viel Luft zwischen zwei Absätzen liegt, hat bisher der
  Browser entschieden — einstellbar war es nicht, und der deutsche Romansatz
  mit eingezogener erster Zeile ließ sich gar nicht herstellen. Jetzt steht in
  den Editor-Einstellungen beides zur Wahl: Abstand zwischen den Absätzen oder
  Erstzeileneinzug, jeweils mit eigenem Maß. Der Einzug entfällt dort von
  selbst, wo es keinen vorigen Absatz gibt, an den er anschließen könnte —
  nach Überschriften, Linien, Szenentrennern und in Aufzählungen. Wer nichts
  ändert, sieht nichts Neues: die Voreinstellung ist genau das bisherige Bild.
- **Sprache des Manuskripts.** Sie war fest auf Deutsch verdrahtet, und daran
  hängen zwei Dinge, die man beim Schreiben in einer anderen Sprache sofort
  merkt: das Trennwörterbuch und die Rechtschreibprüfung. Beides folgt jetzt
  einer Einstellung mit acht Sprachen. Die Rechtschreibprüfung lässt sich
  außerdem abschalten — die roten Wellen unter jedem Eigennamen sind nicht
  jedermanns Sache.
- **Ausrichtung und Sprache im Export.** Die Export-Vorlage kennt jetzt eine
  Grundausrichtung, eine Silbentrennung fürs ePub und eine Sprache.

### Behoben

- **Die Silbentrennung tat auf macOS und Linux nichts.** Dort versteht die
  WebView nur die Schreibweise mit `-webkit-`-Präfix, und die fehlte. Der
  Haken in den Einstellungen ließ sich setzen, blieb aber folgenlos.
- **Die Trennung zerlegte Wörter an unleserlichen Stellen**, weil ihr keine
  Mindestlänge vorgegeben war. Jetzt wird erst ab sechs Zeichen getrennt und
  nie mit weniger als drei Zeichen vor oder nach dem Strich — bei deutschen
  Komposita macht das den Unterschied zwischen ruhigem und zappeligem Satz.
- **Eine lange URL ohne Leerzeichen lief über den Blattrand hinaus**, im
  Blocksatz riss sie zusätzlich Löcher in die Zeile. Sie bricht jetzt um.
- **Am Absatzende blieb schon mal ein einzelnes Wort allein in der Zeile.**
  Der Umbruch achtet jetzt darauf, das zu vermeiden.
- **Die Absatzausrichtung ging beim Export verloren** — in jedem Format, nicht
  nur in einem. Ein zentrierter Absatz kam als gewöhnlicher Fließtext im DOCX,
  PDF und ePub an. Sie wird jetzt durchgereicht; im PDF mit einer Einschränkung:
  die verwendete Bibliothek kennt keinen Blocksatz, dort bleibt es bei
  Flattersatz.
- **E-Reader trennten in exportierten ePubs nicht**, weil dem Buchtext die
  Sprachangabe und die Trennungsregel fehlten. Beides steht jetzt drin.

## 0.6.0 — 2026-09-04

### Neu

- **Papierkorb.** Gelöschtes wanderte zwar schon in einen versteckten Ordner,
  aber nur die Datei — Titel, Ordner und Platz im Baum gingen verloren.
  Zurückholen ließ sich damit nichts, und nachsehen, was drin liegt, auch
  nicht. Jetzt merkt sich der Papierkorb, was ein Eintrag war und wohin er
  gehört, bei Ordnern samt allem, was darin lag. Im Binder steht er als feste
  Zeile ganz unten; sein Inhalt öffnet sich wie der Zeitstrahl in einem eigenen
  Bereich, mit Wiederherstellen, endgültig Löschen und Leeren. Personen, Orte
  und Notizen sind mit drin. Wiederhergestellt wird erst, wenn alle Zieldateien
  geprüft sind — ein Eintrag soll nicht halb zurückkommen; fehlt der alte
  Ordner, landet er auf oberster Ebene.
- **Farbe für Ordner.** Die Farbkante gab es bisher nur für Dokumente. Ordner
  tragen sie jetzt auch — im Corkboard wie im Binder.
- **„Neu" im Corkboard fragt nach Dokument oder Ordner** statt immer ein
  Dokument anzulegen. Wer in einem Ordner steckt, kommt über einen Pfeil links
  vom Titel eine Ebene höher.

### Geändert

- **Karteikarten sind aufgeräumt.** Der Fuß mit Statusauswahl, Bildknopf und
  aufklappbarem Farb- und Tag-Feld ist weg. Von oben nach unten bleiben
  Farbkante, Titel mit Ordner- oder Dokumentsymbol und Statuspille, Bild und
  Synopsis — die Karte zeigt wieder, was auf ihr steht, statt was man mit ihr
  tun kann. Gesetzt wird alles über das Rechtsklick-Menü der Karte: Umbenennen,
  Duplizieren, Status, Farbe, Bild wählen oder entfernen, Löschen. Ein Bild aus
  der Zwischenablage einzufügen bleibt, wie es war. Tags haben damit vorerst
  keine Oberfläche mehr; die Daten bleiben im Projekt stehen.
- **Der Hinweis auf eine neue Version sitzt oben in der Leiste** statt als
  Balken über dem Startbildschirm, wo sein Knopf unter dem Einstellungsknopf
  durchlief. Er trägt jetzt die Akzentfarbe des Programms — eine neue Version
  ist kein Störfall — und zeigt beim Laden einen Fortschrittsbalken.

## 0.5.0 — 2026-09-04

### Neu

- **Rechtsklick-Menü im Binder und in der Planung.** Die Aktionen zu einem
  Eintrag stehen jetzt dort, wo man sie sucht: am Eintrag selbst. Ordner und
  Dokumente bieten Umbenennen, Duplizieren und Löschen, Ordner zusätzlich
  „Neues Dokument" und Ein-/Ausklappen. Für Dokumente lassen sich Status
  (Entwurf, Überarbeitung, Fertig) und Farbe direkt im Menü setzen — bisher
  ging das nur über die Karteikarte im Corkboard. Personen, Orte und Notizen
  haben dasselbe Menü mit Umbenennen, Duplizieren und Löschen. Das Menü ist so
  gebaut, dass weitere Stellen es später ohne Umbau übernehmen können.
- **Duplizieren.** Gab es bisher nirgends. Kopiert wird nicht nur der Eintrag,
  sondern auch, was an Dateien daran hängt: ein Ordner samt Unterbaum und allen
  Dokumenttexten, eine Person oder ein Ort samt Freitext und Bild, eine Notiz
  samt Text. Die Kopie steht direkt hinter dem Original und trägt „(Kopie)" im
  Namen.
- **Ordner im Binder ein- und ausklappen.** Ordner mit Inhalt tragen einen
  Klapp-Pfeil; welche Ordner zu sind, merkt sich die App je Projekt bis zum
  nächsten Start. Ein neues Dokument im geschlossenen Ordner und alles, was per
  Drag & Drop hineinwandert, klappt ihn von selbst auf — sonst verschwände es
  ungesehen.

### Geändert

- **Personen und Orte lassen sich in der Liste umbenennen.** Der Doppelklick
  auf eine Zeile in der Planung öffnete das Namensfeld bisher nur bei Notizen;
  jetzt bei allen drei Arten.

## 0.4.0 — 2026-09-04

### Neu

- **Anwendungsmenü „Datei" und „Hilfe".** Eine eigene Zeile ganz oben im
  Fenster — dort, wo unter Windows das native Menü säße, aber in der App
  gebaut, damit es Themes und Schriften mitläuft. Unter „Datei" liegen
  Projekt öffnen, die zuletzt geöffneten Projekte als Untermenü,
  Sicherungspunkt, Speichern unter, Exportieren, Projekt schließen und
  Beenden; unter „Hilfe" ein Dialog „Über Distelfink" mit Version, Lizenz und
  Projektadresse. Die Einträge lösen dieselben Aktionen aus wie die Knöpfe in
  der Titelleiste.
- **„Speichern unter".** Legt eine vollständige Kopie des Projekts an einem
  gewählten Ort an und arbeitet ab sofort in der Kopie weiter; das Original
  bleibt auf dem Stand, den es beim Kopieren hatte. Der interne Verlauf wandert
  mit, der Such-Cache nicht — der baut sich in der Kopie neu auf.

### Geändert

- **Ordner und Dokumente statt Kapitel und Szenen.** Die Baumstruktur wird
  längst nicht nur für Prosa genutzt; die Oberfläche spricht deshalb überall
  von Ordnern und Dokumenten. Am Dateiformat ändert sich nichts, bestehende
  Projekte öffnen unverändert.
- **Statusleiste bricht nicht mehr um.** Wird der Bereich schmal, sprangen die
  Angaben bisher ohne erkennbare Ordnung in weitere Zeilen. Jetzt stehen sie in
  drei festen Blöcken, und es fällt der Reihe nach weg, was am ehesten
  verzichtbar ist — zuerst die Gesamtzahlen, zuletzt die Normseiten. Wortzahl
  und Schalter bleiben immer sichtbar; die ausgeblendeten Werte stehen
  vollständig im Tooltip der Zahlengruppe. Maßstab ist die Breite des Bereichs,
  nicht die des Fensters, damit es auch im geteilten Layout stimmt.

### Behoben

- **Umbenennen im Binder verlor den Fokus.** Der Doppelklick löste zuerst den
  Einzelklick aus, der das Dokument neu lud — der neu aufgebaute Editor zog
  sich den Fokus aus dem gerade geöffneten Eingabefeld. Im Fluss-Modus war das
  besonders auffällig.

## 0.3.0 — 2026-08-31

### Neu

- **Gesamtwerte des Manuskripts in der Statusleiste.** Neben Wörtern, Zeichen
  und Normseiten des offenen Dokuments steht jetzt die Summe über alle Szenen
  des Binders. Sie läuft beim Schreiben mit; die gewählte Normseiten-Zählweise
  gilt für beide Werte.
- **Fluss-Modus.** Ein neuer Schalter in der Statusleiste (neben dem
  Schreibmaschinen-Modus) zeigt in einem Bereich alle Szenen des Kapitels am
  Stück statt nur die ausgewählte — mit einer Trennlinie samt Szenentitel
  dazwischen, und voll bearbeitbar. Die Szenen bleiben dabei einzelne Dateien:
  gespeichert wird szenenweise, ebenso Verlauf und Konflikterkennung. Ein
  Klick auf eine andere Szene desselben Kapitels springt im Fluss dorthin,
  ohne den Widerrufen-Verlauf zu verlieren. Die Zahlen in der Statusleiste
  gelten dann fürs Kapitel, „Verlauf" für die Szene am Cursor.

### Geändert

- **Recherche-Auswahl nur noch über die Sidebar.** Die Kopfzeile im
  Recherche-Bereich und die Schnellzugriff-Buttons im leeren Bereich sind
  entfallen; beides gab es in der Recherche-Sidebar bereits.

## 0.2.0 — 2026-08-30

### Neu

- **Hintergrundbild für Dokumente.** Unter „Einstellungen → Darstellung" lässt
  sich ein Bild als Hintergrund der Dokumentenfläche wählen — wahlweise
  proportional füllend oder in Originalgröße gekachelt. Über einen eigenen
  Regler bestimmt die Deckkraft des Bildes, wie stark der Theme-Hintergrund
  darunter durchscheint.
- **Deckkraft der Schreibfläche.** Die Manuskriptseite lässt sich durchsichtig
  stellen, so dass das Hintergrundbild hinter dem Text sichtbar wird.
  Voreinstellung bleibt 100 % — am Schriftbild ändert sich ohne bewusste
  Entscheidung nichts.
- **Landing Page** unter `docs/` für GitHub Pages, mit Impressum,
  ECG-Offenlegung, Datenschutz- und KI-Hinweis.

### Hinweise

Das Hintergrundbild gehört zur App, nicht zum Projekt: Es liegt im
App-Config-Verzeichnis neben der `settings.json` und gilt daher für alle
Projekte. Bestehende Einstellungen bleiben gültig; die neuen Schlüssel werden
beim Laden aus den Voreinstellungen ergänzt.

## 0.1.1 — 2026-08-30

### Neu

- Die Versionsnummer steht jetzt im Startbildschirm — ohne sie ließ sich nicht
  feststellen, welcher Stand installiert ist.

### Dokumentation

- README: Workflow-Rechte als Voraussetzung fürs Release ergänzt.

## 0.1.0 — 2026-08-30

Erste veröffentlichte Fassung.

### Schreiben

- Editor auf TipTap-Basis mit Markdown als Speicherformat, Auszeichnungen,
  Überschriften, Textausrichtung und Bildern im Fließtext.
- Manuskriptseite mit einstellbarer Satzbreite, Schrift, Zeilenabstand,
  Blocksatz und automatischer Silbentrennung.
- Fokusmodus und Schreibmaschinen-Modus.

### Ordnen

- Projektformat `.autorproj` mit Binder aus Kapiteln und Szenen, per
  Drag & Drop umsortierbar.
- Corkboard mit Kurzfassungen, Status, Farben, Schlagworten und Kartenbildern.
- Schnellnavigation und Volltextsuche über das ganze Projekt.

### Planen

- Personen, Orte und Notizen als eigene Dokumente, mit Zeitstrahl.
- Planungs-Tags verlinken diese Einträge im Fließtext und zeigen alle
  Fundstellen zurück.
- Split-Layouts: bis zu vier Bereiche nebeneinander.

### Sichern und Ausgeben

- Interne Versionierung über Git mit Verlauf, Vergleich und Wiederherstellen
  einzelner Fassungen.
- Export nach DOCX, PDF, ePub, Markdown und TXT über Formatierungsvorlagen.

### Einrichten

- Themes (Papier, Nachtpapier, Sepia, Mitternacht, eigenes Theme), Editor- und
  Layout-Einstellungen sowie frei belegbare Tastaturkürzel.
- Selbst-Update über GitHub Releases.
