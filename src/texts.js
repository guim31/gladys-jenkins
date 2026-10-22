// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, job statuses, the "Test the connection" report,
// scene summaries. Four languages, the four of the Gladys interface; German
// says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, RESULTS } from './jenkins/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Jenkins in the configuration.',
    fr: "Saisissez l'adresse de votre Jenkins dans la configuration.",
    de: 'Gib die Adresse deines Jenkins in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Jenkins en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:8080',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:8080',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:8080',
  },
};

// One short explanation per error kind (src/jenkins/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Jenkins does not answer',
    fr: 'Jenkins ne répond pas',
    de: 'Jenkins antwortet nicht',
    es: 'Jenkins no responde',
  },
  [ERROR_KINDS.TIMEOUT]: {
    en: 'Jenkins did not answer in time',
    fr: "Jenkins n'a pas répondu à temps",
    de: 'Jenkins hat nicht rechtzeitig geantwortet',
    es: 'Jenkins no ha respondido a tiempo',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user or API token refused: check them (your name → Security)',
    fr: "utilisateur ou jeton d'API refusé : vérifiez-les (votre nom → Sécurité)",
    de: 'Benutzer oder API-Token abgelehnt: Prüfe sie (dein Name → Sicherheit)',
    es: 'usuario o token de API rechazado: compruébelos (su nombre → Seguridad)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'access denied: enter a user and its API token, with the Read permission',
    fr: "accès refusé : saisissez un utilisateur et son jeton d'API, avec le droit Read",
    de: 'Zugriff verweigert: Gib einen Benutzer und sein API-Token mit dem Recht Read ein',
    es: 'acceso denegado: introduzca un usuario y su token de API, con el permiso Read',
  },
  [ERROR_KINDS.NOT_JENKINS]: {
    en: 'no Jenkins API at this address',
    fr: 'aucune API Jenkins à cette adresse',
    de: 'keine Jenkins-API unter dieser Adresse',
    es: 'no hay ninguna API de Jenkins en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'job not found: renamed or deleted in Jenkins',
    fr: 'tâche introuvable : renommée ou supprimée dans Jenkins',
    de: 'Job nicht gefunden: in Jenkins umbenannt oder gelöscht',
    es: 'tarea no encontrada: renombrada o eliminada en Jenkins',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The status of a job, in words (src/devices.js STATUSES).
export const STATUS_TEXT = {
  [RESULTS.SUCCESS]: { en: 'Success', fr: 'Réussie', de: 'Erfolgreich', es: 'Correcta' },
  [RESULTS.FAILURE]: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallida' },
  [RESULTS.UNSTABLE]: { en: 'Unstable', fr: 'Instable', de: 'Instabil', es: 'Inestable' },
  [RESULTS.ABORTED]: { en: 'Aborted', fr: 'Annulée', de: 'Abgebrochen', es: 'Cancelada' },
  [RESULTS.NOT_BUILT]: {
    en: 'Not built',
    fr: 'Non construite',
    de: 'Nicht gebaut',
    es: 'No construida',
  },
  running: { en: 'Running', fr: 'En cours', de: 'Läuft', es: 'En curso' },
  never: { en: 'Never built', fr: 'Jamais lancée', de: 'Nie gestartet', es: 'Nunca ejecutada' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    anonymous: 'without a user: anonymous access',
    jobs: (shown, total) => `${shown} jobs followed out of ${total}`,
    failing: 'failing',
    queue: 'in the queue',
    offline: 'agents offline',
    build: (allowed) =>
      allowed ? 'Running jobs from scenes: allowed' : 'Running jobs from scenes: off',
    missing: (names) => `Not found in Jenkins: ${names}`,
    tooMany: (max) => `Only the first ${max} jobs are followed.`,
  },
  fr: {
    ok: 'Connecté',
    anonymous: 'sans utilisateur : accès anonyme',
    jobs: (shown, total) => `${shown} tâches suivies sur ${total}`,
    failing: 'en échec',
    queue: "en file d'attente",
    offline: 'agents hors ligne',
    build: (allowed) =>
      allowed
        ? 'Lancement depuis les scènes : autorisé'
        : 'Lancement depuis les scènes : désactivé',
    missing: (names) => `Introuvables dans Jenkins : ${names}`,
    tooMany: (max) => `Seules les ${max} premières tâches sont suivies.`,
  },
  de: {
    ok: 'Verbunden',
    anonymous: 'ohne Benutzer: anonymer Zugriff',
    jobs: (shown, total) => `${shown} von ${total} Jobs verfolgt`,
    failing: 'fehlgeschlagen',
    queue: 'in der Warteschlange',
    offline: 'Agenten offline',
    build: (allowed) =>
      allowed ? 'Jobs aus Szenen starten: erlaubt' : 'Jobs aus Szenen starten: aus',
    missing: (names) => `In Jenkins nicht gefunden: ${names}`,
    tooMany: (max) => `Nur die ersten ${max} Jobs werden verfolgt.`,
  },
  es: {
    ok: 'Conectado',
    anonymous: 'sin usuario: acceso anónimo',
    jobs: (shown, total) => `${shown} tareas seguidas de ${total}`,
    failing: 'fallidas',
    queue: 'en cola',
    offline: 'agentes desconectados',
    build: (allowed) =>
      allowed
        ? 'Lanzar tareas desde las escenas: permitido'
        : 'Lanzar tareas desde las escenas: desactivado',
    missing: (names) => `No encontradas en Jenkins: ${names}`,
    tooMany: (max) => `Solo se siguen las ${max} primeras tareas.`,
  },
};

// Errors and messages of the scene actions and the widget (shown in Gladys).
export const ACTION_TEXT = {
  notFollowed: {
    en: 'This job is not followed (not found in Jenkins, or not in the list of the configuration).',
    fr: "Cette tâche n'est pas suivie (absente de Jenkins, ou de la liste de la configuration).",
    de: 'Dieser Job wird nicht verfolgt (nicht in Jenkins oder nicht in der Liste der Konfiguration).',
    es: 'Esta tarea no se sigue (no está en Jenkins, o no está en la lista de la configuración).',
  },
  buildDisabled: {
    en: 'Running jobs is off: turn on "Allow scenes to run jobs" in the configuration.',
    fr: 'Le lancement est désactivé : activez « Autoriser les scènes à lancer des tâches » dans la configuration.',
    de: 'Das Starten ist aus: Aktiviere „Szenen dürfen Jobs starten“ in der Konfiguration.',
    es: 'El lanzamiento está desactivado: active «Permitir que las escenas lancen tareas» en la configuración.',
  },
  notBuildable: {
    en: 'This job is disabled in Jenkins.',
    fr: 'Cette tâche est désactivée dans Jenkins.',
    de: 'Dieser Job ist in Jenkins deaktiviert.',
    es: 'Esta tarea está desactivada en Jenkins.',
  },
  badParameters: {
    en: 'Parameters not understood: NAME=value, one per line or separated by &.',
    fr: 'Paramètres incompris : NOM=valeur, un par ligne ou séparés par &.',
    de: 'Parameter nicht verstanden: NAME=Wert, einer pro Zeile oder durch & getrennt.',
    es: 'Parámetros no válidos: NOMBRE=valor, uno por línea o separados por &.',
  },
  unknownParameters: {
    en: (names) => `Unknown parameters for this job: ${names}`,
    fr: (names) => `Paramètres inconnus de cette tâche : ${names}`,
    de: (names) => `Diesem Job unbekannte Parameter: ${names}`,
    es: (names) => `Parámetros desconocidos para esta tarea: ${names}`,
  },
  buildForbidden: {
    en: 'Jenkins refused: the user needs the Job/Build permission.',
    fr: 'Jenkins a refusé : l’utilisateur doit avoir le droit Job/Build.',
    de: 'Jenkins hat abgelehnt: Der Benutzer braucht das Recht Job/Build.',
    es: 'Jenkins lo ha rechazado: el usuario necesita el permiso Job/Build.',
  },
  refreshed: {
    en: 'Jobs read again.',
    fr: 'Tâches relues.',
    de: 'Jobs neu gelesen.',
    es: 'Tareas leídas de nuevo.',
  },
};

// The `summary` variable of the scene events: ready for a message.
export const SUMMARY_TEXT = {
  en: {
    finished: (job, number, status) => `${job} #${number}: ${status}`,
    failure: (job, number) => `${job} is failing (build #${number})`,
    success: (job, number) => `${job} is back to green (build #${number})`,
    offline: (agent) => `Jenkins agent ${agent} is offline`,
  },
  fr: {
    finished: (job, number, status) => `${job} #${number} : ${status}`,
    failure: (job, number) => `${job} est en échec (exécution #${number})`,
    success: (job, number) => `${job} est revenue au vert (exécution #${number})`,
    offline: (agent) => `L'agent Jenkins ${agent} est hors ligne`,
  },
  de: {
    finished: (job, number, status) => `${job} #${number}: ${status}`,
    failure: (job, number) => `${job} schlägt fehl (Build #${number})`,
    success: (job, number) => `${job} ist wieder grün (Build #${number})`,
    offline: (agent) => `Der Jenkins-Agent ${agent} ist offline`,
  },
  es: {
    finished: (job, number, status) => `${job} #${number}: ${status}`,
    failure: (job, number) => `${job} está fallando (ejecución #${number})`,
    success: (job, number) => `${job} vuelve a estar en verde (ejecución #${number})`,
    offline: (agent) => `El agente de Jenkins ${agent} está desconectado`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
