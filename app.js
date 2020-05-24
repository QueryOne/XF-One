
const port = Number(process.env.PORT || 3000) + Number(process.env.NODE_APP_INSTANCE || 0);

const http       = require('http');
const express    = require('express');
const superagent = require('superagent');

const spoofAgent = require('./namegen.js');

const colyseus   = require('colyseus');

const matchMaker = colyseus.matchMaker
const Room       = colyseus.Room

const colors     = require('colors/safe');

const app = express();
app.use(express.json());

const debug = false;

rpad = function(str, len, ch) { if (typeof str == 'number') { str = str.toString() }; if (ch == null) { ch = ' ' }; var r = len - str.length; if (r < 0) { r = 0 }; return str + ch.repeat(r) };

GateKeeper = async function(context, token, client) {
  var c = await superagent.head('https://api.github.com/user')
                          .set('User-Agent', spoofAgent.make())
                          .set('Authorization', 'token ' + token)
                          .catch(err => {
                            console.log('Authorization for token (' + token + ') failed in connection to ' + context.roomName + '.')
                            return false
                          })
  if (!c) {} else {
    c = c.headers || {}
    c = c['x-oauth-scopes'] || ''
    if (c == 'read:user' || c == 'notifications, read:user') {
       c = await superagent.get('https://api.github.com/user')
                           .set('User-Agent', spoofAgent.make())
                           .set('Authorization', 'token ' + token)
                           .catch(err => {
                              console.log('Authorization for token (' + token + ') failed in connection to ' + context.roomName + '.')
                              return false
                           })
    }
    c = JSON.parse(c.text)
    // Check if this user is already logged in
    var h = context.clientHash || {}
    if (!(typeof h[c.id] == 'undefined')) { 
      console.log('Duplicate token login attempt with ' + token + '.')
      c = 'Duplicate'
    }
  }
  return c
}

Ungate = async function(context, client) {
  for (var id in context.clientHash) {
    if (context.clientHash[id].session == client.id) {
      console.log(colors.yellow('[P:' + colors.cyan(context.roomName) + ']') + ' ' + colors.white(client.id) + colors.red(' logged out') + colors.gray(' using Github ID ' + colors.white(context.clientHash[id].githubId) +  '.'))
      delete context.clientHash[id]
    }
  }
}

class GameWorld extends Room {
  constructor() { super() }

  onCreate() {
    console.log('Created: ' + rpad(this.roomName, 11, ' ') + ' (' + this.roomId + ')')
    this.onMessage("action", (client, message) => {
        // broadcast a message to all clients
        this.broadcast("action-taken", "an action has been taken!");
    });
  }
}

class PersistentGameWorld extends GameWorld {
  constructor() {
    super()
    this.autoDispose = false
  }
}

class PermissionedWorld extends PersistentGameWorld {
  constructor() {
    super()
    this.permitted = [
      {key: 'dxdxdy', user: 'queryone'},
    ]
  }

  onCreate() {
    console.log('Created: ' + rpad(this.roomName, 11, ' ') + ' (' + this.roomId + ')')
  }

  async onAuth (client, options, request) {
    console.log('(xf): ' + client.id + ' requesting permission to join ' + this.roomName + '.')
    var oauth = await GateKeeper(this, options.token, client)
    if (oauth == 'Duplicate') {
      throw new Error(9333)
      oauth = false
    }
    return (oauth) ? oauth : false
  }

  onJoin(e,v,f) {
    console.log(colors.yellow('[P:' + colors.cyan(this.roomName) + ']') + ' ' + colors.white(e.sessionId) + colors.green(' logged in') + colors.gray(' using Github ID ' + colors.white(e.auth.id) +  '.'))
    this.clientHash = this.clientHash || {}
    this.clientHash[e.auth.id] = {user: e.auth.login, session: e.sessionId, token: v.token, githubId: e.auth.id}
    if (debug) { console.log(this.clientHash) }
  }

  onLeave(client, consent) {
    Ungate(this, client)
  }
}

matchMaker.createPermissionedRoom = async function(name, options) {
  var r = await matchMaker.createRoom(name, options)
  // r.permitted = ['']
  return r
}

reboot = async function() {
  const g = await matchMaker.createRoom('XF-Galaxy') /* Public Universe */
  const w = await matchMaker.createPermissionedRoom('XF-ONE')    /* Competitive Universe One */
}

setup = function(app, server) {
  const cs = new colyseus.Server({
    server: server,
  })

  cs.define('XF-Lobby', colyseus.LobbyRoom)
  cs.define('XF-Galaxy', PersistentGameWorld).enableRealtimeListing()
  cs.define('XF-ONE', PermissionedWorld).enableRealtimeListing()
  reboot()
}

const server = http.createServer(app);
setup(app, server);
server.listen(port, () => console.log(`Listening on http://localhost:${port}`));

process.env.NODE_ENV = 'production'
if (process.env.NODE_ENV === 'production') {

  httpsWorker = function(glx) {
    var server = glx.httpsServer()
    var proxy  = require('http-proxy').createProxyServer({xfwd: true})
    proxy.on('error', function(err, req, res) {
      console.error(err)
      res.statusCode = 500
      res.end()
      return
    })
    server.on('upgrade', function(req, socket, head) {
      proxy.ws(req, socket, head, {
        ws: true,
        target: 'ws://localhost:3000'
      })
    })
    glx.serveApp(function(req, res) {
      proxy.web(req, res, {
        target: 'http://localhost:3000'
      })
    })
  }

  require('greenlock-express')
    .init(function () {
      return {
        // greenlock: require('./greenlock'),
        packageRoot    : __dirname,
        configDir      : './greenlock.d',
        maintainerEmail: 'query.non@gmail.com',
        cluster        : false
      };
    })
    .ready(httpsWorker);
}

/*
server.listen(port);

console.log(`Listening on http://localhost:${ port }`);
*/
