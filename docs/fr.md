# Jenkins

[Jenkins](https://www.jenkins.io/) est le serveur d'automatisation libre et
auto-hébergé qui sert à construire, tester et déployer des logiciels. Cette
intégration suit ses tâches : chacune devient un appareil avec le résultat de sa
dernière exécution, son numéro et sa durée, et le fait qu'une exécution tourne ;
un appareil **Jenkins** résume la file d'attente, les agents hors ligne et les
tâches en échec. Les scènes peuvent réagir à une **exécution terminée**, à une
tâche qui **passe en échec ou revient au vert**, ou à un **agent hors ligne**,
lire une tâche et, si vous l'autorisez, **lancer une tâche** avec ses
paramètres. Un widget du tableau de bord montre toutes les tâches d'un coup
d'œil.

Testée contre un vrai Jenkins 2.580 LTS (Docker) ; pas encore contre une vraie
instance Gladys : vos retours sont les bienvenus dans
[les issues](https://github.com/guim31/gladys-jenkins/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un Jenkins joignable depuis la machine de Gladys, sur le réseau local ou sur
  Internet.
- Un utilisateur Jenkins et son jeton d'API. La lecture demande les droits
  **Overall/Read** et **Job/Read** ; lancer des tâches depuis les scènes demande
  aussi **Job/Build**.

À chaque actualisation (chaque minute par défaut), l'intégration fait trois
requêtes légères : la liste des tâches avec les dix dernières exécutions de
chacune (dossiers compris, sur trois niveaux), la file d'attente et les nœuds.
Lancer une tâche ajoute deux requêtes, seulement quand une scène le demande.

## Mise en route

### 1. Créer un jeton d'API

Dans Jenkins, cliquez sur votre nom en haut à droite, puis **Sécurité → Jeton
d'API → Ajouter un nouveau jeton**, donnez-lui un nom et copiez-le (il n'est
affiché qu'une fois). Un utilisateur dédié, avec les seuls droits ci-dessus,
limite ce que Gladys peut faire.

### 2. Configurer l'intégration

Dans Gladys, ouvrez **Intégrations → Jenkins → Configuration** et remplissez :

- **Adresse de Jenkins** : l'adresse avec laquelle vous ouvrez Jenkins,
  `http://192.168.1.2:8080` ou `https://ci.example.com` (gardez le sous-chemin
  si Jenkins tourne sous l'un d'eux, ex. `https://example.com/jenkins`).
- **Utilisateur** et **Jeton d'API** : l'utilisateur de l'étape 1 et son jeton.
  Les deux vides : accès anonyme, si votre Jenkins autorise la lecture anonyme.
- **Tâches à suivre** : vide pour toutes les tâches (50 au plus), ou des noms ou
  des liens de tâches copiés du navigateur, séparés par des virgules. Un nom de
  dossier suit toutes ses tâches. Exemple : `sauvegarde, infra/deploiement`.
- **Autoriser les scènes à lancer des tâches** : désactivé par défaut.
  Activez-le pour utiliser l'action **Lancer une tâche Jenkins**.
- **Intervalle d'actualisation** et **Langue des noms**.

Cliquez sur **Tester la connexion** : Jenkins et sa version, le nombre de tâches
suivies, en échec ou en file d'attente, le nombre d'agents hors ligne, si les
scènes peuvent lancer des tâches, et les tâches de la liste que Jenkins ne
connaît pas.

### 3. Ajouter les appareils

Dans **Découverte**, ajoutez l'appareil **Jenkins** et les tâches voulues. Leurs
valeurs arrivent aussitôt. Les déclencheurs de scène et le widget fonctionnent
même pour une tâche non ajoutée comme appareil.

## Les appareils

### Un appareil par tâche

Nommé d'après le nom complet de la tâche (`dossier/tâche` dans un dossier).
Jenkins ne donne aucun autre identifiant à une tâche : une tâche renommée
devient un nouvel appareil.

| Fonctionnalité                  | Type     | Valeur                                                                          |
| ------------------------------- | -------- | ------------------------------------------------------------------------------- |
| État                            | texte    | Réussie, En échec, Instable, Annulée, Non construite, En cours ou Jamais lancée |
| Dernière exécution réussie      | binaire  | 1 si la dernière exécution terminée a réussi, 0 si en échec ou instable         |
| En cours                        | binaire  | 1 pendant une exécution                                                         |
| Numéro de la dernière exécution | compteur | numéro de la dernière exécution                                                 |
| Durée de la dernière exécution  | durée    | durée de la dernière exécution terminée, en secondes                            |

Pendant une exécution, l'état indique **En cours** ; **Dernière exécution
réussie** et **Durée de la dernière exécution** gardent les valeurs de
l'exécution précédente. Une exécution annulée ne change pas **Dernière exécution
réussie**.

### L'appareil Jenkins

| Fonctionnalité    | Type     | Valeur                                                             |
| ----------------- | -------- | ------------------------------------------------------------------ |
| File d'attente    | compteur | exécutions en attente                                              |
| Agents hors ligne | compteur | nœuds hors ligne (nœud intégré compris)                            |
| Tâches en échec   | compteur | tâches suivies dont la dernière exécution a échoué ou est instable |
| Tâches en cours   | compteur | tâches suivies en cours d'exécution                                |

## Tableau de bord

Le widget **Tâches Jenkins** affiche une ligne par tâche, avec son état et le
numéro de sa dernière exécution : les tâches en échec d'abord, puis les
instables, puis celles en cours. Une ligne au-dessus indique combien
d'exécutions attendent et combien d'agents sont hors ligne, quand il y en a.
Choisissez des tâches dans ses réglages, ou laissez vide pour toutes.
**Actualiser** relit Jenkins aussitôt.

## Scènes

### Déclencheurs

- **Exécution Jenkins terminée** : une exécution d'une tâche suivie s'est
  terminée, quel que soit son résultat (filtre sur la tâche et le résultat :
  réussie, en échec, instable, annulée). Variables : le nom de la tâche, le
  numéro de l'exécution, le résultat en toutes lettres, la durée en secondes, le
  lien et un résumé prêt pour un message.
- **Tâche Jenkins en échec ou revenue au vert** : une tâche passe en échec (une
  exécution en échec ou instable après une réussite, ou sa première exécution en
  échec), ou réussit de nouveau après un échec (filtre sur la tâche et le
  changement). Variables : le nom de la tâche, le numéro de l'exécution, le
  résultat, le lien et un résumé.
- **Agent Jenkins hors ligne** : un nœud qui était en ligne passe hors ligne
  (filtre sur le nom de l'agent, vide pour tous). Variables : le nom de l'agent,
  la raison donnée par Jenkins et un résumé.

La première lecture d'une tâche ou d'un agent ne fait qu'apprendre son état : le
passé n'est jamais annoncé. Trois exécutions au plus par tâche et par lecture
sont annoncées. Ce qui a été vu est conservé par l'intégration : un redémarrage
ne fait ni manquer ni annoncer deux fois un événement.

### Actions

- **Lancer une tâche Jenkins** : met en file une exécution d'une tâche suivie.
  Paramètres facultatifs, `NOM=valeur` séparés par `&` (ex.
  `TARGET=prod&VERSION=1.2`), ou un objet JSON pour une valeur contenant `&` (`{"MESSAGE": "a & b"}`) ; vide, la tâche prend ses valeurs par défaut. Un
  paramètre que la tâche ne déclare pas est refusé. Exige **Autoriser les scènes
  à lancer des tâches** dans la configuration. Variables : le nom de la tâche,
  si l'exécution a été mise en file et son numéro dans la file. L'exécution se
  poursuit dans Jenkins : utilisez **Exécution Jenkins terminée** pour réagir à
  sa fin.
- **Lire une tâche Jenkins** : l'état d'une tâche suivie en variables pour les
  actions suivantes : état en toutes lettres, dernier résultat, dernière
  exécution réussie, en cours, numéro et durée de la dernière exécution, lien.

### Idées de scènes

- **Tâche Jenkins en échec ou revenue au vert**, changement « En échec » →
  passer la lampe du bureau en rouge et envoyer le résumé ; changement « Revenue
  au vert » → la repasser en blanc.
- Chaque nuit à 3 h, si personne n'est à la maison → **Lancer une tâche
  Jenkins** `sauvegarde` ; **Exécution Jenkins terminée** pour `sauvegarde` avec
  le résultat « En échec » → envoyer un message.
- **Agent Jenkins hors ligne** → vous envoyer un message avec le résumé : la
  machine de l'agent est peut-être éteinte.

## Dépannage

- **Jenkins ne répond pas** : vérifiez l'adresse depuis la machine de Gladys
  (même port, même protocole) ; un Gladys sous Docker joint l'hôte par son
  adresse IP, pas par `localhost`.
- **L'adresse redirige** : saisissez l'adresse en `https://` sur laquelle
  aboutit le navigateur, avec le sous-chemin s'il y en a un.
- **Utilisateur ou jeton d'API refusé** : le jeton a été révoqué ou mal saisi ;
  créez-en un nouveau. Un mot de passe fonctionne aussi, mais un jeton est
  préférable.
- **Accès refusé** : aucun utilisateur n'est saisi alors que Jenkins refuse la
  lecture anonyme, ou l'utilisateur n'a pas le droit **Overall/Read**.
- **Jenkins a refusé : l'utilisateur doit avoir le droit Job/Build** :
  donnez-le-lui, ou laissez le lancement désactivé.
- **Aucune API Jenkins à cette adresse** : l'adresse pointe vers un autre
  service, ou il manque le sous-chemin.
- Une tâche n'apparaît pas : elle est au-delà de trois niveaux de dossiers, ou
  plus de 50 tâches correspondent à la liste : listez moins de tâches ou de
  dossiers.
- **Certificat refusé** : un certificat auto-signé n'est pas accepté ; utilisez
  l'adresse en `http://` sur le réseau local.

## Limites

- Lancer des tâches est la seule commande, et elle est désactivée par défaut.
  Une exécution ne peut pas être arrêtée depuis Gladys.
- 50 tâches au plus, sur trois niveaux de dossiers ; Jenkins est lu au plus
  souvent chaque minute : un événement arrive avec jusqu'à un intervalle de
  retard.
- Une tâche est connue par son nom complet : la renommer ou la déplacer dans un
  autre dossier crée un nouvel appareil.
- Les dix dernières exécutions de chaque tâche sont lues : quand plus de dix
  exécutions se terminent entre deux lectures, les plus anciennes ne sont pas
  annoncées.
- Les étapes des pipelines, les rapports de tests et les journaux d'exécution ne
  sont pas lus.
- Les textes des appareils et des scènes suivent la langue de la configuration ;
  les noms des fonctionnalités sont fixés à l'ajout d'un appareil.
- Développée et testée avec Jenkins 2.580 LTS ; les versions plus anciennes à la
  même API JSON devraient fonctionner, sans garantie.
