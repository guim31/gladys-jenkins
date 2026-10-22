// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `jobs`.
//
// The use case: from the wall tablet, see at a glance whether the followed
// jobs pass, which one runs, and whether builds wait in the queue or an agent
// is offline. One row per job — failed and unstable first, then running —
// and a Refresh button.
//
// Every followed job by default, or the ones chosen in the widget settings
// (devices added to Gladys). The figures are sent as values, not bound to
// device features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): one text when Jenkins does not answer, one
// text for the queue and the offline agents, one status list, the button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { STATUSES, jobIds, statusOf } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, STATUS_TEXT, pick } from './texts.js';

export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  empty: {
    en: 'No job in Jenkins, or none matches the list of the configuration.',
    fr: 'Aucune tâche dans Jenkins, ou aucune ne correspond à la liste de la configuration.',
    de: 'Kein Job in Jenkins, oder keiner passt zur Liste der Konfiguration.',
    es: 'Ninguna tarea en Jenkins, o ninguna coincide con la lista de la configuración.',
  },
  queue: {
    en: (count) => `Queued: ${count}`,
    fr: (count) => `En attente : ${count}`,
    de: (count) => `Wartend: ${count}`,
    es: (count) => `En cola: ${count}`,
  },
  offline: {
    en: (count) => `Offline agents: ${count}`,
    fr: (count) => `Agents hors ligne : ${count}`,
    de: (count) => `Agenten offline: ${count}`,
    es: (count) => `Agentes desconectados: ${count}`,
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otras' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
};

const ROW_STYLE = {
  [STATUSES.FAILURE]: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  [STATUSES.UNSTABLE]: { icon: 'alert-triangle', color: WIDGET_COLORS.WARNING },
  [STATUSES.RUNNING]: { icon: 'clock', color: WIDGET_COLORS.INFO },
  [STATUSES.SUCCESS]: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
};
const NEUTRAL = { icon: 'minus-circle', color: WIDGET_COLORS.NEUTRAL };

// Row order: what needs attention first.
const RANK = { [STATUSES.FAILURE]: 0, [STATUSES.UNSTABLE]: 1, [STATUSES.RUNNING]: 2 };

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The jobs the widget shows: the chosen devices, or every followed one. */
export function selectJobs(hub, settings) {
  const chosen = [settings?.jobs ?? []].flat().filter((id) => typeof id === 'string' && id);
  const all = [...hub.jobs.values()];
  if (chosen.length === 0) {
    return all;
  }
  const ids = new Set(chosen);
  return all.filter((job) => ids.has(jobIds(hub.gladys, job.fullName).device));
}

export function sortJobs(jobs) {
  return jobs
    .map((job) => ({ job, status: statusOf(job) }))
    .sort(
      (a, b) =>
        (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) ||
        a.job.fullName.localeCompare(b.job.fullName),
    );
}

function rowOf({ job, status }, language) {
  const parts = [pick(STATUS_TEXT[status], language)];
  if (job.builds[0]) {
    parts.push(`#${job.builds[0].number}`);
  }
  return {
    label: fit(job.fullName, 40),
    value: fit(parts.join(' · '), 40),
    ...(ROW_STYLE[status] ?? NEUTRAL),
  };
}

async function get(hub, { settings, language = 'en' }) {
  const status = hub.connectionStatus();
  if (!hub.client) {
    return message(status.message ?? CONNECTION_TEXT.noUrl, language);
  }
  const components = [];
  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }
  const rows = sortJobs(selectJobs(hub, settings));
  if (!hub.error && hub.readAt > 0 && hub.jobs.size === 0) {
    return message(TEXT.empty, language);
  }
  const summary = hub.summary();
  const notes = [];
  if (summary.queue) {
    notes.push(pick(TEXT.queue, language)(summary.queue));
  }
  if (summary.offlineAgents) {
    notes.push(pick(TEXT.offline, language)(summary.offlineAgents));
  }
  if (notes.length > 0 && !hub.error) {
    components.push({ type: 'text', variant: 'muted', text: notes.join(' · ') });
  }
  if (rows.length > 0) {
    const shown = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS - 1) : rows;
    const items = shown.map((row) => rowOf(row, language));
    if (rows.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${rows.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }
  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });
  // A build running moves: look again sooner.
  const moving = hub.error || rows.some((row) => row.status === STATUSES.RUNNING) || summary.queue;
  return { ttl_seconds: moving ? 60 : 300, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  return { message: hub.error ? ERROR_TEXT[hub.error.kind] : ACTION_TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
