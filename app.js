/* Playden Library Check: compares a Steam library with Playden's COMPATIBILITY.md. */
(() => {
  'use strict';

  const COMPAT_URL = 'https://raw.githubusercontent.com/leolobato/playden-ps5/refs/heads/main/COMPATIBILITY.md';
  // Relative links in the markdown resolve against the file's page on GitHub.
  const COMPAT_BASE = 'https://github.com/leolobato/playden-ps5/blob/main/COMPATIBILITY.md';

  const DEFAULT_PROXIES = [
    'https://api.codetabs.com/v1/proxy/?quest={url}',
    'https://api.allorigins.win/raw?url={url}',
    'https://corsproxy.io/?url={url}',
  ];

  const STATUSES = [
    { key: 'works', label: 'Works', emoji: '✅' },
    { key: 'partial', label: 'Partial', emoji: '🟡' },
    { key: 'broken', label: 'Broken', emoji: '❌' },
    { key: 'refused', label: 'Refused', emoji: '⛔' },
  ];
  const STATUS_ORDER = { works: 0, partial: 1, broken: 2, refused: 3, other: 4 };

  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
  };

  const $ = (id) => document.getElementById(id);

  // ---------- Parsing COMPATIBILITY.md ----------

  function splitRow(line) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '')
      .replace(/\\\|/g, '\u0000')
      .split('|')
      .map((c) => c.replace(/\u0000/g, '|').trim());
    return cells;
  }

  function statusKey(text) {
    const t = text.toLowerCase();
    if (t.includes('✅') || t.includes('works')) return 'works';
    if (t.includes('🟡') || t.includes('partial')) return 'partial';
    if (t.includes('❌') || t.includes('broken')) return 'broken';
    if (t.includes('⛔') || t.includes('refused')) return 'refused';
    return 'other';
  }

  function parseCompat(md) {
    const lines = md.split(/\r?\n/);
    const entries = [];
    let inGames = false;
    let header = null;
    const updated = (md.match(/Last updated (\d{4}-\d{2}-\d{2})/) || [])[1] || null;

    for (const line of lines) {
      if (/^#{1,6}\s/.test(line)) {
        inGames = /^##\s+Games\b/i.test(line);
        header = null;
        continue;
      }
      if (!inGames || !line.trim().startsWith('|')) continue;
      const cells = splitRow(line);
      if (!header) { header = cells.map((c) => c.toLowerCase()); continue; }
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;

      const col = (name) => {
        const i = header.findIndex((h) => h.startsWith(name));
        return i >= 0 ? (cells[i] || '') : '';
      };
      const gameCell = col('game');
      const link = gameCell.match(/^\[(.+)\]\(([^)\s]+)\)$/);
      const name = link ? link[1] : gameCell;
      const url = link ? link[2] : null;
      const appMatch = url && url.match(/store\.steampowered\.com\/app\/(\d+)/);
      const status = col('status');

      entries.push({
        name,
        url,
        appid: appMatch ? Number(appMatch[1]) : null,
        status,
        statusKey: statusKey(status),
        kit: col('kit'),
        tech: col('engine'),
        notes: col('notes'),
        norm: normName(name),
      });
    }
    return { entries, updated };
  }

  // ---------- Names ----------

  function normName(s) {
    return String(s)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[™®©]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // ---------- Minimal inline markdown ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function safeUrl(href) {
    try {
      const u = new URL(href, COMPAT_BASE);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch { return null; }
  }

  function inlineMd(src) {
    // Pull out code spans first so their contents are left alone.
    const codes = [];
    let s = String(src).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0001`; });
    const links = [];
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
      links.push({ text, href });
      return `\u0002${links.length - 1}\u0002`;
    });
    s = esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/\u0002(\d+)\u0002/g, (_, i) => {
      const { text, href } = links[i];
      const url = safeUrl(href);
      const inner = inlineMd(text);
      return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>` : inner;
    });
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }

  // ---------- Steam input ----------

  function parseProfileInput(raw) {
    const s = raw.trim();
    if (!s) return null;
    let m = s.match(/steamcommunity\.com\/(id|profiles)\/([^/?#\s]+)/i);
    if (m) return { kind: m[1].toLowerCase(), id: decodeURIComponent(m[2]) };
    if (/^7656\d{13}$/.test(s)) return { kind: 'profiles', id: s };
    m = s.match(/^(?:https?:\/\/)?s\.team\/p\//i);
    if (m) return { error: 'Short s.team links can’t be read. Open the link and paste the full steamcommunity.com address.' };
    if (/^[A-Za-z0-9_-]{2,32}$/.test(s)) return { kind: 'id', id: s };
    return { error: 'That doesn’t look like a Steam profile. Try https://steamcommunity.com/id/yourname or /profiles/7656…' };
  }

  // ---------- Extracting owned games from any Steam response ----------

  function decodeEntities(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }

  /** Returns { games: [{appid, name}], profileName?, private? } or null if nothing recognisable. */
  function extractGames(text) {
    const out = { games: [], profileName: null, private: false, source: null };
    const add = (appid, name) => {
      const id = Number(appid);
      if (!Number.isFinite(id) || id <= 0) return;
      out.games.push({ appid: id, name: name ? String(name) : null });
    };
    const trimmed = text.trim();

    // 1. GetOwnedGames JSON (or anything with a games/rgGames array).
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed);
        const list = Array.isArray(j) ? j : (j.response && j.response.games) || j.rgGames || j.games;
        if (Array.isArray(list)) {
          list.forEach((g) => add(g.appid ?? g.appID ?? g.app_id, g.name));
          out.source = 'json';
          return dedupe(out);
        }
      } catch { /* not JSON, keep going */ }
    }

    // 2. Current games page: <template data-profile-gameslist="{…}">
    const attr = text.match(/data-profile-gameslist\s*=\s*"([^"]*)"/);
    if (attr) {
      try {
        const j = JSON.parse(decodeEntities(attr[1]));
        out.profileName = j.strProfileName || null;
        (j.rgGames || []).forEach((g) => add(g.appid, g.name));
        out.source = 'gameslist';
        if (!out.games.length) out.private = true;
        return dedupe(out);
      } catch { /* fall through */ }
    }

    // 3. Older games page: var rgGames = [...];
    const rg = text.match(/var\s+rgGames\s*=\s*(\[[\s\S]*?\]);\s*\n/);
    if (rg) {
      try {
        JSON.parse(rg[1]).forEach((g) => add(g.appid, g.name));
        out.source = 'rgGames';
        return dedupe(out);
      } catch { /* fall through */ }
    }

    // 4. Games XML (?xml=1).
    if (/<gamesList[\s>]/.test(text)) {
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      out.profileName = doc.querySelector('steamID')?.textContent || null;
      doc.querySelectorAll('games > game').forEach((g) => add(g.querySelector('appID')?.textContent, g.querySelector('name')?.textContent));
      out.source = 'xml';
      if (!out.games.length && /private/i.test(text)) out.private = true;
      return dedupe(out);
    }

    if (/profile_private_info|This profile is private/i.test(text)) {
      out.private = true;
      return out;
    }

    // 5. Loose appids in JSON-ish text or store/app links.
    let m;
    const re = /"appid"\s*:\s*(\d+)(?:[^{}]*?"name"\s*:\s*"((?:[^"\\]|\\.)*)")?/g;
    while ((m = re.exec(text))) add(m[1], m[2] ? JSON.parse(`"${m[2]}"`) : null);
    const linkRe = /(?:store\.steampowered\.com|steamcommunity\.com)\/app\/(\d+)/g;
    while ((m = linkRe.exec(text))) add(m[1], null);
    if (out.games.length) { out.source = 'loose'; return dedupe(out); }

    return null;
  }

  function dedupe(out) {
    const seen = new Map();
    for (const g of out.games) {
      const prev = seen.get(g.appid);
      if (!prev || (!prev.name && g.name)) seen.set(g.appid, g);
    }
    out.games = [...seen.values()];
    return out;
  }

  // ---------- Network ----------

  function getProxies() {
    const saved = LS.get('proxies');
    const list = (saved ?? DEFAULT_PROXIES.join('\n')).split('\n').map((s) => s.trim()).filter(Boolean);
    return list.length ? list : DEFAULT_PROXIES;
  }

  function proxied(template, url) {
    if (template.includes('{rawurl}')) return template.replace('{rawurl}', url);
    if (template.includes('{url}')) return template.replace('{url}', encodeURIComponent(url));
    return template + encodeURIComponent(url);
  }

  async function fetchText(url, timeoutMs = 20000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch a Steam URL through the proxies, returning the first response that `accept` returns truthy for. */
  async function viaProxies(steamUrl, accept, onTry) {
    const errors = [];
    for (const p of getProxies()) {
      const host = (() => { try { return new URL(p.replace(/\{(raw)?url\}/, '')).host; } catch { return p; } })();
      onTry && onTry(host);
      try {
        const text = await fetchText(proxied(p, steamUrl));
        const result = accept(text);
        if (result) return result;
        errors.push(`${host}: unexpected response`);
      } catch (e) {
        errors.push(`${host}: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
      }
    }
    const err = new Error('All proxies failed');
    err.details = errors;
    throw err;
  }

  async function loadFromSteam(profile, setStatus) {
    const base = `https://steamcommunity.com/${profile.kind}/${encodeURIComponent(profile.id)}`;
    const tried = [];

    const notFound = (t) => /The specified profile could not be found|error_ctn/i.test(t) && !/data-profile-gameslist/.test(t);
    const acceptGames = (t) => {
      if (notFound(t)) return { notFound: true };
      return extractGames(t);
    };

    // 1. Games page (HTML with the embedded JSON list).
    try {
      const r = await viaProxies(`${base}/games/?tab=all`, acceptGames, (h) => setStatus(`Reading your games page via ${h}…`, true));
      if (r.notFound) throw Object.assign(new Error('Steam says that profile doesn’t exist. Check the name or link.'), { final: true });
      if (r.games.length || r.private) return r;
    } catch (e) {
      if (e.final) throw e;
      tried.push(...(e.details || [e.message]).map((d) => `Games page · ${d}`));
    }

    // 2. Legacy games XML.
    try {
      const r = await viaProxies(`${base}/games/?tab=all&xml=1`, (t) => {
        const x = extractGames(t);
        return x && (x.games.length || x.private) ? x : null;
      }, (h) => setStatus(`Trying the XML games list via ${h}…`, true));
      return r;
    } catch (e) {
      tried.push(...(e.details || [e.message]).map((d) => `Games XML · ${d}`));
    }

    // 3. Steam Web API, only when the user gave a key.
    const key = ($('apikey').value || '').trim();
    if (key) {
      let steamid = profile.kind === 'profiles' ? profile.id : null;
      if (!steamid) {
        const r = await viaProxies(
          `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(profile.id)}`,
          (t) => { try { return JSON.parse(t).response; } catch { return null; } },
          (h) => setStatus(`Looking up your SteamID via ${h}…`, true),
        );
        if (r.success !== 1) throw Object.assign(new Error('Steam couldn’t find that custom URL name.'), { final: true });
        steamid = r.steamid;
      }
      const r = await viaProxies(
        `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1`,
        (t) => {
          try {
            const j = JSON.parse(t);
            if (!j.response) return null;
            const x = extractGames(t) || { games: [] };
            if (!x.games.length) x.private = true;
            return x;
          } catch { return null; }
        },
        (h) => setStatus(`Asking the Steam Web API via ${h}…`, true),
      );
      return r;
    }

    const err = new Error('Couldn’t read your Steam games through any proxy.');
    err.details = tried;
    throw err;
  }

  // ---------- Comparison ----------

  function compare(compat, owned) {
    const byApp = new Map();
    const byName = new Map();
    for (const e of compat.entries) {
      if (e.appid) {
        if (!byApp.has(e.appid)) byApp.set(e.appid, []);
        byApp.get(e.appid).push(e);
      }
      if (e.norm && !byName.has(e.norm)) byName.set(e.norm, []);
      if (e.norm) byName.get(e.norm).push(e);
    }

    const matches = [];
    const untested = [];
    const usedEntries = new Set();

    for (const g of owned) {
      let hits = g.appid ? byApp.get(g.appid) : null;
      let by = 'appid';
      if (!hits && g.name) {
        // Name fallback, only to rows without a Steam link (imported copies, odd store links).
        const cand = (byName.get(normName(g.name)) || []).filter((e) => !e.appid || !g.appid);
        if (cand.length) { hits = cand; by = 'name'; }
      }
      if (hits) {
        for (const e of hits) {
          if (usedEntries.has(e)) continue;
          usedEntries.add(e);
          matches.push({ entry: e, owned: g, by });
        }
      } else {
        untested.push(g);
      }
    }

    matches.sort((a, b) => (STATUS_ORDER[a.entry.statusKey] - STATUS_ORDER[b.entry.statusKey])
      || a.entry.name.localeCompare(b.entry.name, undefined, { sensitivity: 'base' }));
    untested.sort((a, b) => (a.name || `~${a.appid}`).localeCompare(b.name || `~${b.appid}`, undefined, { sensitivity: 'base' }));
    return { matches, untested };
  }

  // ---------- Rendering ----------

  const view = { matches: [], untested: [], filter: 'all', text: '' };

  function badge(e) {
    const s = STATUSES.find((x) => x.key === e.statusKey);
    const label = s ? `${s.emoji} ${s.label}` : (e.status || '—');
    return `<span class="badge ${e.statusKey}">${esc(label)}</span>`;
  }

  function renderStats() {
    const counts = { all: view.matches.length };
    for (const s of STATUSES) counts[s.key] = view.matches.filter((m) => m.entry.statusKey === s.key).length;
    const tiles = [
      { key: 'all', n: counts.all, l: 'on the list' },
      ...STATUSES.map((s) => ({ key: s.key, n: counts[s.key], l: s.label.toLowerCase() })),
      { key: 'untested', n: view.untested.length, l: 'not tested yet' },
    ];
    $('stats').innerHTML = tiles.map((t) => `<button type="button" class="stat ${t.key}" data-key="${t.key}" aria-pressed="${view.filter === t.key}">
      <span class="n">${t.n}</span><span class="l">${esc(t.l)}</span></button>`).join('');

    $('chips').innerHTML = [{ key: 'all', label: `All (${counts.all})` },
      ...STATUSES.filter((s) => counts[s.key]).map((s) => ({ key: s.key, label: `${s.emoji} ${s.label} (${counts[s.key]})` }))]
      .map((c) => `<button type="button" class="chip" data-key="${c.key}" aria-pressed="${view.filter === c.key}">${esc(c.label)}</button>`)
      .join('');
  }

  function renderMatches() {
    const q = normName(view.text);
    const rows = view.matches.filter((m) => (view.filter === 'all' || view.filter === 'untested' || m.entry.statusKey === view.filter)
      && (!q || m.entry.norm.includes(q) || normName(m.entry.notes).includes(q) || normName(m.entry.tech).includes(q)));

    $('matches').innerHTML = rows.map(({ entry: e, owned, by }) => {
      const url = e.url ? safeUrl(e.url) : null;
      const name = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${inlineMd(e.name)}</a>` : inlineMd(e.name);
      const sub = by === 'name' ? `<span class="by">matched by name${owned.name && owned.name !== e.name ? `: ${esc(owned.name)}` : ''}</span>` : '';
      return `<tr>
        <td class="game">${name}${sub}</td>
        <td class="status">${badge(e)}</td>
        <td class="kit">${esc(e.kit || '—')}</td>
        <td class="tech">${inlineMd(e.tech || '—')}</td>
        <td class="notes">${inlineMd(e.notes || '')}</td>
      </tr>`;
    }).join('');
    $('matches-empty').hidden = rows.length > 0;
    if (!view.matches.length) $('matches-empty').textContent = 'None of your games are on the compatibility list yet.';
    else $('matches-empty').textContent = 'No games match the filter.';
  }

  function renderUntested() {
    const q = normName($('untested-filter').value);
    const list = view.untested.filter((g) => !q || normName(g.name || String(g.appid)).includes(q));
    $('untested-title').textContent = `Not on the list yet (${view.untested.length})`;
    $('untested-list').innerHTML = list.map((g) => {
      const label = g.name ? esc(g.name) : `App ${g.appid}`;
      return g.appid
        ? `<li><a href="https://store.steampowered.com/app/${g.appid}" target="_blank" rel="noopener">${label}</a></li>`
        : `<li>${label}</li>`;
    }).join('');
  }

  function renderProfile(info) {
    const parts = [];
    if (info.avatar) parts.push(`<img src="${esc(info.avatar)}" alt="">`);
    const who = info.profileName ? esc(info.profileName) : (info.label ? esc(info.label) : 'Your library');
    const link = info.profileUrl ? `<a href="${esc(info.profileUrl)}" target="_blank" rel="noopener">${who}</a>` : who;
    parts.push(`<div><div class="who">${link}</div><div class="sub">${info.total} game${info.total === 1 ? '' : 's'} in library · ${view.matches.length} on the compatibility list · checked against ${info.compatCount} reports</div></div>`);
    $('profile-line').innerHTML = parts.join('');
  }

  function setFilter(key) {
    view.filter = key;
    renderStats();
    renderMatches();
    if (key === 'untested') {
      $('untested').open = true;
      $('untested').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ---------- Status line ----------

  function setStatus(msg, busy = false, isError = false, details = null) {
    const el = $('status');
    el.className = `status${isError ? ' error' : ''}`;
    el.innerHTML = msg ? `${busy ? '<span class="spinner" aria-hidden="true"></span>' : ''}${esc(msg)}` : '';
    if (details && details.length) {
      el.innerHTML += `<details class="hint"><summary>Details</summary><ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>`;
    }
  }

  // ---------- Compat loading (cached per page load) ----------

  let compatPromise = null;
  function loadCompat() {
    if (!compatPromise) {
      compatPromise = fetchText(COMPAT_URL, 20000).then((md) => {
        const c = parseCompat(md);
        if (!c.entries.length) throw new Error('The compatibility list had no games table.');
        if (c.updated) $('compat-updated').textContent = `List last updated ${c.updated}.`;
        return c;
      }).catch((e) => { compatPromise = null; throw e; });
    }
    return compatPromise;
  }

  // ---------- Flow ----------

  function showResults(compat, data, info) {
    const { matches, untested } = compare(compat, data.games);
    view.matches = matches;
    view.untested = untested;
    view.filter = 'all';
    view.text = '';
    $('filter-text').value = '';
    $('untested-filter').value = '';
    $('untested').open = false;
    renderProfile({ ...info, profileName: data.profileName || info.profileName, total: data.games.length, compatCount: compat.entries.length });
    renderStats();
    renderMatches();
    renderUntested();
    $('results').hidden = false;
  }

  async function runProfile(raw) {
    const profile = parseProfileInput(raw);
    if (!profile) { setStatus('Paste your Steam profile link first.', false, true); return; }
    if (profile.error) { setStatus(profile.error, false, true); return; }

    const btn = $('go');
    btn.disabled = true;
    try {
      setStatus('Loading the compatibility list…', true);
      const compat = await loadCompat();
      const data = await loadFromSteam(profile, setStatus);
      if (data.private || !data.games.length) {
        $('results').hidden = true;
        setStatus('That profile’s game list is private or empty. Set Profile and Game details to Public in Steam › Edit Profile › Privacy Settings, then try again.', false, true);
        return;
      }
      LS.set('profile', raw.trim());
      const url = new URL(location.href);
      url.searchParams.set('profile', raw.trim());
      history.replaceState(null, '', url);
      setStatus('');
      showResults(compat, data, {
        label: profile.id,
        profileUrl: `https://steamcommunity.com/${profile.kind}/${encodeURIComponent(profile.id)}`,
      });
    } catch (e) {
      setStatus(`${e.message}${e.final ? '' : ' You can use “Paste manually” instead.'}`, false, true, e.details);
    } finally {
      btn.disabled = false;
    }
  }

  async function runPaste(text) {
    if (!text.trim()) { setStatus('Paste your games page source or a list of games first.', false, true); return; }
    try {
      setStatus('Loading the compatibility list…', true);
      const compat = await loadCompat();
      let data = extractGames(text);
      if (data && data.private) {
        setStatus('That page says the profile’s game list is private. Make Game details public, or paste the page while signed in as yourself.', false, true);
        return;
      }
      if (!data || !data.games.length) {
        // Plain list of names, one per line.
        const names = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s.length < 200);
        if (!names.length) { setStatus('Couldn’t find any games in that text.', false, true); return; }
        data = { games: names.map((n) => ({ appid: null, name: n })), profileName: null };
      }
      setStatus('');
      showResults(compat, data, { label: 'Pasted library' });
    } catch (e) {
      setStatus(e.message, false, true, e.details);
    }
  }

  // ---------- Wiring ----------

  function selectTab(which) {
    const profile = which === 'profile';
    $('tab-profile').setAttribute('aria-selected', String(profile));
    $('tab-paste').setAttribute('aria-selected', String(!profile));
    $('panel-profile').hidden = !profile;
    $('panel-paste').hidden = profile;
  }

  function init() {
    $('tab-profile').addEventListener('click', () => selectTab('profile'));
    $('tab-paste').addEventListener('click', () => selectTab('paste'));

    $('proxies').value = getProxies().join('\n');
    $('proxies').addEventListener('change', () => {
      const v = $('proxies').value.trim();
      if (!v || v === DEFAULT_PROXIES.join('\n')) LS.del('proxies'); else LS.set('proxies', v);
    });
    $('reset-proxies').addEventListener('click', () => { LS.del('proxies'); $('proxies').value = DEFAULT_PROXIES.join('\n'); });

    $('apikey').value = LS.get('apikey') || '';
    $('apikey').addEventListener('change', () => {
      const v = $('apikey').value.trim();
      if (v) LS.set('apikey', v); else LS.del('apikey');
    });

    $('panel-profile').addEventListener('submit', (ev) => { ev.preventDefault(); runProfile($('profile').value); });
    $('panel-paste').addEventListener('submit', (ev) => { ev.preventDefault(); runPaste($('pasted').value); });

    const onFilterClick = (ev) => {
      const b = ev.target.closest('[data-key]');
      if (b) setFilter(b.dataset.key === view.filter && b.dataset.key !== 'all' ? 'all' : b.dataset.key);
    };
    $('stats').addEventListener('click', onFilterClick);
    $('chips').addEventListener('click', onFilterClick);
    $('filter-text').addEventListener('input', () => { view.text = $('filter-text').value; renderMatches(); });
    $('untested-filter').addEventListener('input', renderUntested);

    const fromUrl = new URLSearchParams(location.search).get('profile');
    const initial = fromUrl || LS.get('profile') || '';
    $('profile').value = initial;
    if (fromUrl) runProfile(fromUrl);
    else loadCompat().catch(() => { /* reported when the user compares */ });
  }

  // Exposed for testing in the console.
  window.PlaydenCheck = { parseCompat, extractGames, parseProfileInput, compare, inlineMd, normName };

  init();
})();
