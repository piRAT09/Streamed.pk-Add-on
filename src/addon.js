#!/usr/bin/env node

'use strict';

const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch');

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://streamed.pk/api';
const IMAGE_BASE = 'https://streamed.pk/api/images';

// Maps streamed.pk sport IDs → Stremio catalog IDs & display names
const SPORTS_MAP = {
  football:    { name: 'Football / Soccer', emoji: '⚽' },
  basketball:  { name: 'Basketball',        emoji: '🏀' },
  'american-football': { name: 'American Football', emoji: '🏈' },
  baseball:    { name: 'Baseball',          emoji: '⚾' },
  hockey:      { name: 'Ice Hockey',        emoji: '🏒' },
  tennis:      { name: 'Tennis',            emoji: '🎾' },
  mma:         { name: 'MMA / UFC',         emoji: '🥊' },
  boxing:      { name: 'Boxing',            emoji: '🥊' },
  motorsport:  { name: 'Motorsport / F1',   emoji: '🏎️' },
  golf:        { name: 'Golf',              emoji: '⛳' },
  cricket:     { name: 'Cricket',           emoji: '🏏' },
  rugby:       { name: 'Rugby',             emoji: '🏉' },
  darts:       { name: 'Darts',             emoji: '🎯' },
  billiards:   { name: 'Billiards',         emoji: '🎱' },
};

// ─── Manifest ─────────────────────────────────────────────────────────────────

const CATALOGS = [
  // "Live Now" catalog across all sports
  {
    type: 'tv',
    id: 'streamed-live',
    name: '🔴 Live Now',
    extra: [{ name: 'search', isRequired: false }],
  },
  // "Today's Matches" catalog
  {
    type: 'tv',
    id: 'streamed-today',
    name: "📅 Today's Matches",
    extra: [{ name: 'search', isRequired: false }],
  },
  // Per-sport catalogs
  ...Object.entries(SPORTS_MAP).map(([sportId, meta]) => ({
    type: 'tv',
    id: `streamed-sport-${sportId}`,
    name: `${meta.emoji} ${meta.name}`,
    extra: [{ name: 'search', isRequired: false }],
  })),
];

const manifest = {
  id: 'community.streamed.pk.addon',
  version: '1.0.0',
  name: 'Streamed.pk',
  description:
    'Live sports streams powered by streamed.pk. Watch football, basketball, UFC, F1, cricket, and more — all in one place.',
  logo: 'https://streamed.pk/favicon.ico',
  background: 'https://streamed.pk/og-image.jpg',
  resources: ['catalog', 'meta', 'stream'],
  types: ['tv'],
  idPrefixes: ['streamed:'],
  catalogs: CATALOGS,
  behaviorHints: {
    adult: false,
    p2p: false,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generic fetch wrapper with error handling & timeout.
 */
async function apiFetch(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StremioStreamedAddon/1.0' },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[streamed.pk] API error (${path}):`, err.message);
    return null;
  }
}

/**
 * Convert a streamed.pk APIMatch into a Stremio MetaPreview.
 */
function matchToMeta(match) {
  const id = `streamed:${match.id}`;
  const date = match.date ? new Date(match.date) : null;
  const releaseInfo = date ? date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '';

  // Build a poster URL from the match poster field if available
  const poster = match.poster
    ? `${IMAGE_BASE}/poster/medium/${match.poster}.webp`
    : null;

  // Fallback poster using team badges
  const homeThumb = match.teams?.home?.badge
    ? `${IMAGE_BASE}/badge/small/${match.teams.home.badge}.webp`
    : null;

  const sportInfo = SPORTS_MAP[match.category] || { name: match.category, emoji: '🎮' };

  return {
    id,
    type: 'tv',
    name: match.title,
    poster: poster || homeThumb || null,
    background: poster,
    posterShape: 'landscape',
    description: [
      match.teams?.home?.name && match.teams?.away?.name
        ? `${match.teams.home.name} vs ${match.teams.away.name}`
        : '',
      `${sportInfo.emoji} ${sportInfo.name}`,
      releaseInfo ? `🕐 ${releaseInfo}` : '',
      match.popular ? '🔥 Popular' : '',
    ]
      .filter(Boolean)
      .join('\n'),
    releaseInfo,
    genre: [sportInfo.name],
    // Stash raw match data so the stream handler can read sources
    _matchData: match,
  };
}

/**
 * Filter a list of MetaPreviews by a search query.
 */
function filterBySearch(metas, query) {
  if (!query) return metas;
  const q = query.toLowerCase();
  return metas.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q)
  );
}

// ─── Builder & Handlers ───────────────────────────────────────────────────────

const builder = new addonBuilder(manifest);

// ── Catalog Handler ──────────────────────────────────────────────────────────

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== 'tv') return { metas: [] };

  const search = extra && extra.search;

  let matches = [];

  if (id === 'streamed-live') {
    matches = (await apiFetch('/matches/live')) || [];
  } else if (id === 'streamed-today') {
    matches = (await apiFetch('/matches/all-today')) || [];
  } else if (id.startsWith('streamed-sport-')) {
    const sportId = id.replace('streamed-sport-', '');
    matches = (await apiFetch(`/matches/${sportId}`)) || [];
  } else {
    return { metas: [] };
  }

  // Sort: live/upcoming by date ascending, already-started last
  const now = Date.now();
  matches.sort((a, b) => {
    const aIsLive = a.date && a.date <= now;
    const bIsLive = b.date && b.date <= now;
    if (aIsLive && !bIsLive) return -1;
    if (!aIsLive && bIsLive) return 1;
    return (a.date || 0) - (b.date || 0);
  });

  let metas = matches.map(matchToMeta);

  if (search) {
    metas = filterBySearch(metas, search);
  }

  // Stremio expects MetaPreview without private fields
  const cleanMetas = metas.map(({ _matchData, ...rest }) => rest);

  return { metas: cleanMetas };
});

// ── Meta Handler ─────────────────────────────────────────────────────────────

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== 'tv' || !id.startsWith('streamed:')) return { meta: null };

  const matchId = id.replace('streamed:', '');

  // Fetch all matches to find the one we need (no single-match endpoint in API)
  const allMatches = (await apiFetch('/matches/all')) || [];
  const match = allMatches.find((m) => m.id === matchId);

  if (!match) {
    // Return minimal meta if not found
    return {
      meta: {
        id,
        type: 'tv',
        name: matchId,
      },
    };
  }

  const meta = matchToMeta(match);
  const { _matchData, ...cleanMeta } = meta;

  // Enrich: add links / trailers placeholders
  cleanMeta.links = [
    {
      name: 'View on Streamed.pk',
      category: 'source',
      url: `https://streamed.pk`,
    },
  ];

  return { meta: cleanMeta };
});

// ── Stream Extraction ─────────────────────────────────────────────────────────

/**
 * Fetch an embed page HTML with spoofed browser headers.
 */
async function fetchEmbed(embedUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(embedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://streamed.pk/',
        'Origin': 'https://streamed.pk',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return res.text();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Extract an m3u8 URL from embed page HTML.
 * Handles both plain URLs in JS source and basic P.A.C.K.E.R. obfuscation.
 */
function extractM3u8(html, embedUrl) {
  if (!html) return null;

  // 1. Direct m3u8 URL in source
  const direct = html.match(/["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)/);
  if (direct) return direct[1];

  // 2. Common JS variable patterns: file:"...", source:"...", src:"..."
  const varPatterns = [
    /(?:file|source|src|hls|stream|url)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)/i,
    /["'`](https?:\/\/[^"'`\s]+\/(?:index|master|playlist|live|stream)[^"'`\s]*\.m3u8[^"'`\s]*)/i,
  ];
  for (const pat of varPatterns) {
    const m = html.match(pat);
    if (m) return m[1];
  }

  // 3. Relative m3u8 path — resolve against embed origin
  const rel = html.match(/["'`](\/[^"'`\s]+\.m3u8[^"'`\s]*)/);
  if (rel) {
    try {
      const base = new URL(embedUrl);
      return `${base.origin}${rel[1]}`;
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Get the origin of a URL string, safe fallback to full URL.
 */
function originOf(url) {
  try { return new URL(url).origin; } catch { return url; }
}

// ── Stream Handler ────────────────────────────────────────────────────────────

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== 'tv' || !id.startsWith('streamed:')) return { streams: [] };

  const matchId = id.replace('streamed:', '');

  // Find the match to get its sources
  const allMatches = (await apiFetch('/matches/all')) || [];
  const match = allMatches.find((m) => m.id === matchId);

  if (!match || !match.sources || match.sources.length === 0) {
    return { streams: [] };
  }

  // Fetch stream metadata for every source in parallel
  const streamResults = await Promise.allSettled(
    match.sources.map(async (src) => {
      const streams = await apiFetch(`/stream/${src.source}/${src.id}`);
      return { source: src.source, streams: streams || [] };
    })
  );

  const stremioStreams = [];

  // For each stream, scrape the embed page to get the real m3u8 URL
  const extractionJobs = [];
  for (const result of streamResults) {
    if (result.status !== 'fulfilled') continue;
    const { source, streams } = result.value;
    for (const stream of streams) {
      if (!stream.embedUrl) continue;
      extractionJobs.push({ source, stream });
    }
  }

  // Scrape all embeds in parallel (limit to first 6 to avoid hammering)
  const jobs = extractionJobs.slice(0, 6);
  const scraped = await Promise.allSettled(
    jobs.map(async ({ source, stream }) => {
      const html = await fetchEmbed(stream.embedUrl);
      const m3u8 = extractM3u8(html, stream.embedUrl);
      return { source, stream, m3u8 };
    })
  );

  for (const result of scraped) {
    if (result.status !== 'fulfilled') continue;
    const { source, stream, m3u8 } = result.value;

    const quality = stream.hd ? 'HD' : 'SD';
    const lang = stream.language || 'Unknown';
    const srcLabel = source.charAt(0).toUpperCase() + source.slice(1);

    if (m3u8) {
      // We got a direct m3u8 — pass it to Stremio with required headers
      const embedOrigin = originOf(stream.embedUrl);
      stremioStreams.push({
        url: m3u8,
        name: `Streamed.pk\n${srcLabel} #${stream.streamNo}`,
        description: `${quality} · ${lang} · Source: ${srcLabel}`,
        behaviorHints: {
          notWebReady: false,
          // Pass headers so Stremio (and MediaFlow Proxy users) can authenticate
          headers: {
            'Referer': `${embedOrigin}/`,
            'Origin': embedOrigin,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        },
      });
    } else {
      // Fallback: couldn't extract m3u8, offer the embed as external URL
      stremioStreams.push({
        externalUrl: stream.embedUrl,
        name: `Streamed.pk (web)\n${srcLabel} #${stream.streamNo}`,
        description: `${quality} · ${lang} · Opens in browser`,
      });
    }
  }

  return { streams: stremioStreams };
});

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = builder.getInterface();
