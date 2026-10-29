/**
 * The admin page, as one self-contained HTML file: served at /admin by
 * adminRoutes.ts, and everything it shows comes from /admin/api with the
 * admin token the person at the keyboard types in. (docs/GO-LIVE.md §17)
 *
 * Every name on it was typed by a player, so every one goes in with
 * `textContent`, never as HTML. No outside scripts, fonts or images: it works
 * wherever the server does.
 */

export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Game admin</title>
<style>
:root {
  --bg: #11131a; --panel: #181c26; --edge: #2a3040; --fg: #dfe4ee; --muted: #8b93a5;
  --accent: #56b4e9; --gold: #f2c14e; --good: #6bbf59; --bad: #e0703a;
  color-scheme: dark;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 17px; margin: 0 0 8px; }
.muted { color: var(--muted); }
nav { display: flex; flex-wrap: wrap; gap: 6px; }
button, input { font: inherit; }
button { background: var(--panel); color: var(--fg); border: 1px solid var(--edge); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:hover { border-color: var(--accent); }
button.on { background: var(--fg); color: var(--bg); border-color: var(--fg); }
button.danger { border-color: var(--bad); color: var(--bad); }
input { background: var(--panel); color: var(--fg); border: 1px solid var(--edge); border-radius: 8px; padding: 6px 10px; min-width: 0; }
.card { background: var(--panel); border: 1px solid var(--edge); border-radius: 10px; padding: 12px 14px; display: grid; gap: 6px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.tile .n { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.pill { font-size: 12px; border: 1px solid currentColor; border-radius: 999px; padding: 0 8px; }
.good { color: var(--good); } .bad { color: var(--bad); } .gold { color: var(--gold); } .acc { color: var(--accent); }
pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: var(--muted); max-height: 220px; overflow: auto; }
details summary { cursor: pointer; color: var(--accent); }
.list { display: grid; gap: 8px; }
.name { font-weight: 600; word-break: break-word; }
#status { min-height: 1.5em; }
</style>
</head>
<body>
<main>
  <div class="row" style="justify-content: space-between">
    <h1>Game admin</h1>
    <button id="signout" hidden>Forget the token</button>
  </div>
  <form id="login" class="card" hidden>
    <label for="token">Admin token (the server's ADMIN_TOKEN)</label>
    <div class="row"><input id="token" type="password" autocomplete="current-password" style="flex: 1"><button>Open</button></div>
  </form>
  <nav id="tabs" hidden></nav>
  <div id="status" class="muted" role="status"></div>
  <section id="view" class="list"></section>
</main>
<script>
(function () {
  'use strict';
  var KEY = 'game-admin-token';
  var token = '';
  try { token = localStorage.getItem(KEY) || ''; } catch (e) {}
  var view = document.getElementById('view');
  var statusLine = document.getElementById('status');
  var tabs = [
    ['overview', 'Overview'], ['reports', 'Name reports'], ['crashes', 'Crashes'],
    ['founders', 'Founders'], ['credits', 'Credits'], ['players', 'Players'], ['backup', 'Backup']
  ];
  var current = 'overview';

  function el(tag, props) {
    var node = document.createElement(tag);
    var children = Array.prototype.slice.call(arguments, 2);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') node.className = props[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), props[k]);
      else node.setAttribute(k, props[k]);
    });
    (function add(list) {
      list.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) return add(c);
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    })(children);
    return node;
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
  function count(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }
  function say(text) { statusLine.textContent = text; }

  function api(path, body) {
    var opts = { headers: { Authorization: 'Bearer ' + token } };
    if (body) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch('/admin/api/' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 || r.status === 503 || r.status === 429) {
          if (r.status === 401) signOut();
          throw new Error(data.error || ('The server said ' + r.status));
        }
        if (!r.ok) throw new Error(data.error || ('The server said ' + r.status));
        return data;
      });
    });
  }

  function signOut() {
    token = '';
    try { localStorage.removeItem(KEY); } catch (e) {}
    start();
  }

  function act(path, body, done) {
    say('Working...');
    api(path, body).then(function () { say('Done.'); show(current); if (done) done(); })
      .catch(function (e) { say(e.message); });
  }

  var screens = {
    overview: function () {
      return api('overview').then(function (d) {
        var tile = function (n, label, cls) { return el('div', { class: 'card tile' }, el('div', { class: 'n ' + (cls || '') }, n), el('div', { class: 'muted' }, label)); };
        return el('div', { class: 'tiles' },
          tile(d.players, 'players the server knows'),
          tile(d.seenToday, 'seen in the last day'),
          tile((d.founders.count - d.founders.left) + ' / ' + d.founders.count, 'Founders so far', 'gold'),
          tile(d.supporters, 'Supporters'),
          tile(d.reports, 'names reported', d.reports ? 'bad' : ''),
          tile(d.hiddenNames, 'names hidden'),
          tile(d.crashesToday, 'crash reports in the last day', d.crashesToday ? 'bad' : 'good'));
      });
    },
    reports: function () {
      return api('reports').then(function (d) {
        if (!d.groups.length) return el('p', { class: 'muted' }, 'No name reports. A name reported by 3 different players is hidden from everyone until you look at it.');
        return el('div', { class: 'list' }, d.groups.map(function (g) {
          var state = g.locked ? el('span', { class: 'pill bad' }, 'every name hidden')
            : g.hidden ? el('span', { class: 'pill bad' }, 'hidden')
            : g.allowed ? el('span', { class: 'pill good' }, 'allowed') : el('span', { class: 'pill gold' }, 'showing');
          return el('div', { class: 'card' },
            el('div', { class: 'row' }, el('span', { class: 'name' }, g.name), state),
            el('div', { class: 'muted' }, 'Reported by ' + count(g.reporters, 'player', 'players') + ', in the ' + g.places.join(' and ') + '. Last ' + when(g.last) + '.'),
            g.nameNow && g.nameNow !== g.name ? el('div', { class: 'muted' }, 'They now play as: ', el('span', { class: 'name' }, g.nameNow)) : null,
            el('div', { class: 'muted' }, 'Player ' + g.playerId),
            el('div', { class: 'row' },
              el('button', { class: 'danger', onclick: function () { act('names', { playerId: g.playerId, name: g.name, action: 'hide' }); } }, 'Hide this name'),
              el('button', { onclick: function () { act('names', { playerId: g.playerId, name: g.name, action: 'allow' }); } }, 'It is fine: allow it'),
              g.locked
                ? el('button', { onclick: function () { act('names', { playerId: g.playerId, action: 'unlock' }); } }, 'Show their names again')
                : el('button', { class: 'danger', onclick: function () { act('names', { playerId: g.playerId, action: 'lock' }); } }, 'Hide every name they choose')));
        }));
      });
    },
    crashes: function () {
      return api('crashes').then(function (d) {
        var clear = el('div', { class: 'row' }, el('button', { class: 'danger', onclick: function () { act('crashes/clear', {}); } }, 'Clear all crash reports'));
        if (!d.groups.length) return el('div', { class: 'list' }, el('p', { class: 'muted' }, 'No crash reports.'));
        return el('div', { class: 'list' }, clear, d.groups.map(function (g) {
          var c = g.latest;
          return el('div', { class: 'card' },
            el('div', { class: 'row' }, el('span', { class: 'pill bad' }, g.kind), el('span', { class: 'name' }, g.message)),
            el('div', { class: 'muted' }, count(g.count, 'time', 'times') + ', last ' + when(g.last) + ' · versions ' + (g.versions.join(', ') || '?') + ' · ' + (g.editions.join(', ') || '?')),
            el('div', { class: 'muted' }, 'On screen: ' + (g.scenes.join(', ') || '?')),
            el('details', null, el('summary', null, 'The latest one'),
              el('pre', null, (c.stack || c.source || '(no stack)') +
                '\\n\\nScreen ' + c.screen + ' · ' + c.agent +
                '\\nBuild ' + (c.build || '?') + ' · ' + when(c.at) +
                '\\nBefore it: ' + (c.trail.join(' > ') || '(nothing)'))));
        }));
      });
    },
    founders: function () {
      return api('founders').then(function (d) {
        var head = el('p', { class: 'muted' }, (d.status.count - d.status.left) + ' of ' + d.status.count + ' Founders so far. They need level ' + d.status.level + ' and ' + count(d.status.onlineMatches, 'online match', 'online matches') + '.');
        return el('div', { class: 'list' }, head, d.founders.map(function (f) {
          return el('div', { class: 'card' },
            el('div', { class: 'row' }, el('span', { class: 'pill gold' }, '#' + f.number), el('span', { class: 'name' }, f.name || '(no name)')),
            el('div', { class: 'muted' }, 'Credits name: ', f.creditName || '(none)', ' · since ' + when(f.at) + ' · player ' + f.playerId));
        }));
      });
    },
    credits: function () {
      return api('credits').then(function (d) {
        if (!d.players.length) return el('p', { class: 'muted' }, 'Nobody has chosen a credits name yet.');
        return el('div', { class: 'list' }, d.players.map(function (p) {
          return el('div', { class: 'card' },
            el('div', { class: 'row' }, el('span', { class: 'name' }, p.creditName || '(removed)'),
              p.founderNumber ? el('span', { class: 'pill gold' }, 'Founder #' + p.founderNumber) : el('span', { class: 'pill acc' }, 'Supporter (' + p.supporter + ')'),
              p.creditBlocked ? el('span', { class: 'pill bad' }, 'blocked') : null),
            el('div', { class: 'muted' }, 'Plays as ', p.name || '(default)', ' · player ' + p.playerId),
            p.creditBlocked ? null : el('div', { class: 'row' }, el('button', { class: 'danger', onclick: function () { act('credits/remove', { playerId: p.playerId }); } }, 'Remove from the credits, for good')));
        }));
      });
    },
    players: function () {
      var box = el('input', { type: 'search', placeholder: 'A name, a credits name or a player id', style: 'flex: 1' });
      var results = el('div', { class: 'list' });
      var find = function () {
        api('players?q=' + encodeURIComponent(box.value)).then(function (d) {
          results.textContent = '';
          if (!d.players.length) results.appendChild(el('p', { class: 'muted' }, 'Nobody found.'));
          d.players.forEach(function (p) {
            var armed = false;
            var del = el('button', { class: 'danger' }, 'Delete this player');
            del.addEventListener('click', function () {
              if (!armed) { armed = true; del.textContent = 'Tap again to delete for good'; return; }
              act('players/delete', { playerId: p.playerId }, find);
            });
            results.appendChild(el('div', { class: 'card' },
              el('div', { class: 'row' }, el('span', { class: 'name' }, p.name || '(default name)'), el('span', { class: 'pill acc' }, 'Lv ' + p.level),
                p.founderNumber ? el('span', { class: 'pill gold' }, 'Founder #' + p.founderNumber) : null,
                p.supporter ? el('span', { class: 'pill acc' }, 'Supporter') : null),
              el('div', { class: 'muted' }, p.xp + ' XP · ' + count(p.onlineMatches, 'online match', 'online matches') + ' · first seen ' + when(p.since) + ' · last ' + when(p.seen)),
              el('div', { class: 'muted' }, 'Player ' + p.playerId),
              el('div', { class: 'row' }, del)));
          });
        }).catch(function (e) { say(e.message); });
      };
      box.addEventListener('keydown', function (e) { if (e.key === 'Enter') find(); });
      return Promise.resolve(el('div', { class: 'list' },
        el('p', { class: 'muted' }, 'For a deletion request: find them, delete them, then reply to their email. Their saved build, reports and credits name go too; a Founder number stays taken but no longer says whose.'),
        el('div', { class: 'row' }, box, el('button', { onclick: find }, 'Find')), results));
    },
    backup: function () {
      var go = el('button', null, 'Download a backup');
      go.addEventListener('click', function () {
        say('Making the backup...');
        fetch('/admin/api/backup', { headers: { Authorization: 'Bearer ' + token } })
          .then(function (r) { if (!r.ok) throw new Error('The server said ' + r.status); return r.blob(); })
          .then(function (blob) {
            var a = el('a', { href: URL.createObjectURL(blob), download: 'game-backup-' + new Date().toISOString().slice(0, 10) + '.json' });
            document.body.appendChild(a); a.click(); a.remove();
            say('Backup downloaded. Keep it somewhere safe: it has every player record.');
          }).catch(function (e) { say(e.message); });
      });
      return Promise.resolve(el('div', { class: 'card' },
        el('p', null, 'Everything the server keeps, in one file: players, Founders, hidden names, reports and saved builds. Crash reports are left out. Download one every week, and before moving to another host.'),
        el('div', { class: 'row' }, go)));
    }
  };

  function show(name) {
    current = name;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
      b.className = b.getAttribute('data-tab') === name ? 'on' : '';
    });
    say('Loading...');
    screens[name]().then(function (node) {
      view.textContent = '';
      view.appendChild(node);
      say('');
    }).catch(function (e) { say(e.message); });
  }

  function start() {
    var login = document.getElementById('login');
    var nav = document.getElementById('tabs');
    var out = document.getElementById('signout');
    view.textContent = '';
    if (!token) {
      login.hidden = false; nav.hidden = true; out.hidden = true;
      return;
    }
    login.hidden = true; nav.hidden = false; out.hidden = false;
    nav.textContent = '';
    tabs.forEach(function (t) {
      nav.appendChild(el('button', { 'data-tab': t[0], onclick: function () { show(t[0]); } }, t[1]));
    });
    show(current);
  }

  document.getElementById('login').addEventListener('submit', function (e) {
    e.preventDefault();
    token = document.getElementById('token').value.trim();
    try { localStorage.setItem(KEY, token); } catch (err) {}
    start();
  });
  document.getElementById('signout').addEventListener('click', signOut);
  start();
})();
</script>
</body>
</html>
`;
