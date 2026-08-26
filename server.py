#!/usr/bin/env python3
"""قضية القصر — الخادم.

One file, standard library only. It does two things:

  1. serves the game (index.html and everything beside it);
  2. keeps rooms, so friends can play the same case from different machines.

The relay knows nothing about Cluedo. A room is an ordered list of messages;
every table sends messages to it and reads them back in the same order. That
ordering is the whole guarantee — because every machine runs the same rules and
applies the same messages in the same sequence, the tables cannot drift apart.

Run it:
    python3 server.py            # then open the address it prints
    python3 server.py --port 80  # or wherever you are hosting it
"""

import argparse
import json
import os
import random
import socket
import string
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
# The page may live in a `qasr/` folder next to the mansion's `models/` and
# `textures/`, in which case the site root is one level up; hosted on its own,
# this folder IS the site.
if os.path.basename(HERE) == 'qasr' and os.path.isdir(os.path.join(os.path.dirname(HERE), 'models')):
    ROOT = os.path.dirname(HERE)
    HOME_PAGE = '/qasr/index.html'
else:
    ROOT = HERE
    HOME_PAGE = '/index.html'

# Rooms are held in memory only: nothing about a game is worth writing to disk,
# and nothing survives a restart, which is exactly what you want from a relay.
ROOMS = {}
LOCK = threading.Lock()

ROOM_TTL = 6 * 60 * 60        # a room with nobody in it is forgotten after this
MAX_SEATS = 6
MAX_MESSAGES = 4000           # a very long game is a few hundred
POLL_SECONDS = 25             # how long a poll waits before answering "nothing"
CODE_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY34679'   # no 0/O, 1/I, 5/S, 8/B, 2/Z

MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.obj': 'text/plain; charset=utf-8', '.mtl': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
}


def now():
    return time.time()


def new_code():
    while True:
        code = ''.join(random.choice(CODE_ALPHABET) for _ in range(5))
        if code not in ROOMS:
            return code


def new_token():
    return ''.join(random.choice(string.ascii_letters + string.digits) for _ in range(24))


def sweep():
    """Forget rooms nobody has touched in a long while."""
    cutoff = now() - ROOM_TTL
    for code in [c for c, r in ROOMS.items() if r['touched'] < cutoff]:
        ROOMS.pop(code, None)


ONLINE_AFTER = 18             # a member unheard from for this long is "away"


def is_online(m):
    return now() - m['seen'] < ONLINE_AFTER


def presence_stamp(room):
    """A short signature of who is at the table and who is hosting.

    Polls hold the line open for half a minute at a time, so a change of
    presence has to be able to end one — otherwise a friend closing their laptop
    goes unnoticed for as long as the poll happens to have left to run."""
    return '|'.join('%d:%s:%d:%d' % (m['seat'], m['name'], is_online(m), m['host'])
                    for m in sorted(room['members'].values(), key=lambda m: m['seat']))


def room_peers(room):
    return [{'seat': m['seat'], 'name': m['name'], 'host': m['host'],
             'online': is_online(m), 'pid': m['pid']}
            for m in sorted(room['members'].values(), key=lambda m: m['seat'])]


def promote_host(room):
    """Keep exactly one host, and never a host who has gone away.

    The host is the machine that runs the bots, so a table whose host closed
    their laptop would simply stop. The lowest-numbered seat that is still
    online takes over."""
    members = sorted(room['members'].values(), key=lambda m: m['seat'])
    if not members:
        return
    current = next((m for m in members if m['host']), None)
    if current and is_online(current):
        return
    heir = next((m for m in members if is_online(m)), None)
    if not heir or (current and heir['token'] == current['token']):
        return
    for m in members:
        m['host'] = (m['token'] == heir['token'])
    room['messages'].append({'n': room['next'], 'seat': heir['seat'],
                             'type': 'host', 'data': {'seat': heir['seat']}, 't': now()})
    room['next'] += 1


def member_by_pid(room, pid):
    if not pid:
        return None
    return next((m for m in room['members'].values() if m['pid'] == pid), None)


def member_of(room, token):
    return room['members'].get(token)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'QasrRelay/1.0'

    # ------------------------------------------------------------- plumbing
    def log_message(self, fmt, *args):
        if self.path.startswith('/api/room/poll'):
            return                                   # a poll a second is noise
        super().log_message(fmt, *args)

    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store' if ctype.startswith('application/json') else 'no-cache')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _fail(self, code, msg):
        self._send(code, {'error': msg})

    def _body(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return {}
        if n <= 0 or n > 1_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return {}

    # ------------------------------------------------------------ the files
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path.startswith('/api/'):
            return self._fail(405, 'استخدم POST')
        if path in ('/', ''):
            path = HOME_PAGE
        target = os.path.normpath(os.path.join(ROOT, path.lstrip('/')))
        if not target.startswith(ROOT) or not os.path.isfile(target):
            return self._fail(404, 'غير موجود')
        ext = os.path.splitext(target)[1].lower()
        with open(target, 'rb') as f:
            data = f.read()
        self._send(200, data, MIME.get(ext, 'application/octet-stream'))

    # ------------------------------------------------------------- the relay
    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        if not path.startswith('/api/'):
            return self._fail(404, 'غير موجود')
        route = path[len('/api/'):].strip('/')
        body = self._body()
        handler = {
            'room': self.api_create,
            'room/join': self.api_join,
            'room/send': self.api_send,
            'room/poll': self.api_poll,
            'room/leave': self.api_leave,
        }.get(route)
        if not handler:
            return self._fail(404, 'مسار غير معروف')
        try:
            handler(body)
        except Exception as e:              # never take the server down
            self._fail(500, 'خطأ في الخادم: %s' % e)

    def api_create(self, body):
        name = (body.get('name') or 'المضيف')[:24]
        pid = str(body.get('pid') or '')[:64] or new_token()
        with LOCK:
            sweep()
            code, token = new_code(), new_token()
            ROOMS[code] = {
                'code': code, 'created': now(), 'touched': now(),
                'members': {token: {'seat': 0, 'name': name, 'host': True,
                                    'seen': now(), 'token': token, 'pid': pid}},
                'messages': [], 'next': 1, 'started': False,
            }
        self._send(200, {'code': code, 'token': token, 'seat': 0, 'host': True, 'messages': []})

    def api_join(self, body):
        """Sit down — or sit back down.

        A seat belongs to a PERSON, identified by a `pid` their browser keeps.
        Entering the code again from the same browser (a refresh, a dropped
        connection, coming back after closing the tab) returns them to the seat
        they already had. Without this, one friend pressing join four times
        filled four seats."""
        code = (body.get('code') or '').strip().upper()
        name = (body.get('name') or 'ضيف')[:24]
        pid = str(body.get('pid') or '')[:64]
        with LOCK:
            sweep()
            room = ROOMS.get(code)
            if not room:
                return self._fail(404, 'لا توجد غرفة بهذا الرمز')

            back = member_by_pid(room, pid)
            if back:
                # the same person again: hand back the same seat, and everything
                # that has happened since, so their game can catch up
                room['members'].pop(back['token'], None)
                token = new_token()
                back.update({'token': token, 'seen': now(), 'name': name})
                room['members'][token] = back
                room['touched'] = now()
                promote_host(room)
                return self._send(200, {
                    'code': code, 'token': token, 'seat': back['seat'], 'host': back['host'],
                    'rejoined': True, 'started': room['started'],
                    'messages': list(room['messages']), 'peers': room_peers(room)})

            if room['started']:
                return self._fail(409, 'اللعبة بدأت بالفعل في هذه الغرفة')
            if len(room['members']) >= MAX_SEATS:
                return self._fail(409, 'الغرفة ممتلئة')
            token = new_token()
            seat = max((m['seat'] for m in room['members'].values()), default=-1) + 1
            room['members'][token] = {'seat': seat, 'name': name, 'host': False,
                                      'seen': now(), 'token': token, 'pid': pid or token}
            room['touched'] = now()
            peers = room_peers(room)
        self._send(200, {'code': code, 'token': token, 'seat': seat, 'host': False,
                         'rejoined': False, 'started': False, 'messages': [], 'peers': peers})

    def api_send(self, body):
        code = (body.get('code') or '').strip().upper()
        token = body.get('token') or ''
        mtype = str(body.get('type') or '')[:32]
        data = body.get('data')
        with LOCK:
            room = ROOMS.get(code)
            if not room:
                return self._fail(404, 'الغرفة غير موجودة')
            me = member_of(room, token)
            if not me:
                return self._fail(403, 'لست في هذه الغرفة')
            me['seen'] = now()
            room['touched'] = now()
            if mtype == 'start':
                room['started'] = True
            msg = {'n': room['next'], 'seat': me['seat'], 'type': mtype, 'data': data, 't': now()}
            room['next'] += 1
            room['messages'].append(msg)
            # the tail is all anyone ever needs; the head is already applied
            if len(room['messages']) > MAX_MESSAGES:
                del room['messages'][:len(room['messages']) - MAX_MESSAGES]
        self._send(200, {'ok': True, 'n': msg['n']})

    def api_poll(self, body):
        """Hold the request open until something happens, or time runs out.

        A board game is silent for most of a minute at a time; answering
        immediately would mean a request a second per player for nothing."""
        code = (body.get('code') or '').strip().upper()
        token = body.get('token') or ''
        try:
            since = int(body.get('since') or 0)
        except (TypeError, ValueError):
            since = 0
        seen_stamp = body.get('pv')
        deadline = now() + POLL_SECONDS
        while True:
            with LOCK:
                room = ROOMS.get(code)
                if not room:
                    return self._fail(404, 'الغرفة غير موجودة')
                me = member_of(room, token)
                if not me:
                    return self._fail(403, 'لست في هذه الغرفة')
                me['seen'] = now()
                room['touched'] = now()
                promote_host(room)
                fresh = [m for m in room['messages'] if m['n'] > since]
                stamp = presence_stamp(room)
                if fresh or stamp != seen_stamp or now() >= deadline:
                    return self._send(200, {'messages': fresh, 'peers': room_peers(room),
                                            'pv': stamp})
            time.sleep(0.25)

    def api_leave(self, body):
        """Stand up from the table.

        Once a game is under way the seat is KEPT: the table carries on with the
        house playing that detective, and the same person can come back to it
        with the room code. Only a table that has not started yet loses the
        chair entirely."""
        code = (body.get('code') or '').strip().upper()
        token = body.get('token') or ''
        with LOCK:
            room = ROOMS.get(code)
            if not room or token not in room['members']:
                return self._send(200, {'ok': True})
            left = room['members'][token]
            if room['started']:
                left['seen'] = 0                     # away, but the seat is theirs
            else:
                room['members'].pop(token, None)
            room['touched'] = now()
            room['messages'].append({'n': room['next'], 'seat': left['seat'],
                                     'type': 'left', 'data': {'name': left['name']}, 't': now()})
            room['next'] += 1
            promote_host(room)
            if not room['members']:
                ROOMS.pop(code, None)
        self._send(200, {'ok': True})


def my_addresses(port):
    out = ['http://localhost:%d' % port]
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        out.append('http://%s:%d' % (s.getsockname()[0], port))
        s.close()
    except Exception:
        pass
    return out


def main():
    ap = argparse.ArgumentParser(description='قضية القصر — الخادم')
    ap.add_argument('--port', type=int, default=int(os.environ.get('PORT', 8000)))
    ap.add_argument('--host', default='0.0.0.0')
    args = ap.parse_args()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    print('قضية القصر — الخادم يعمل')
    for a in my_addresses(args.port):
        print('   ', a + HOME_PAGE)
    print('العنوان الثاني هو اللي يفتحه أصدقاؤك على نفس الشبكة.')
    print('اضغط Ctrl+C للإيقاف')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nتم الإيقاف')


if __name__ == '__main__':
    main()
