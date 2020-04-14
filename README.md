# Self-hosted multiplayer web-based Scrabble

This repository was cloned from https://github.com/hanshuebner/html-scrabble

### Features

**From the original:**

* Two to four players
* Czech, English, Estonian, French, German, Hungarian and Dutch letter sets
* Written in JavaScript, runs in browser
* Scalable user interface
* Desktop notification support
* Moderate sound effects
* Tile placement by clicking, drag&drop or keyboard entry
* Chat
* Standard Scrabble rules including "Challenge" with simple penalty
* No dictionary enforced
* Player online status display
* Participation in multiple games from one browser possible
* Uses node.js on the server
* No database required, no deployment complexities

**Additions:**

* Users log-in via a HTTP header from a reverse-proxy header, such as from nginx's auth\_basic or auth\_request.
* Users can only play as their own users. No arbitrary players. Email feature removed.
* Able to delete games and see finished games.
* There are now clocks for the game, each player, and each turn.
* Game can be paused and resumed by a player. It also automatically pauses when all players leave.

### Limitations

* Human players only.  No computer players are available.
* No dictionary.  Any word can be entered.
* No security.  The server uses sufficiently long random numbers as keys for
  games and players to make guessing a key impossible.  The game and player
  keys are enough to join the game and make moves, though.
* Limited browser support.  We're using Chrome and Firefox and I am not
  testing on other browsers.
* Unlicensed.  "Scrabble" is a registered trademark by Hasbro and Spear, and
  the word is used in this program without permission.
* Bugs.  There are some minor (and maybe even some major) bugs which I have
  not come around to fix yet, and maybe never will.
* Ugly code.  I did not understand much of the original code when I started
  adding features, and did not refactor thoroughly in the course of action.
  There are several things in the code that I'd do differently now, but as
  the game works well enough as it is, I'm not doing it.  If you want to
  hack this code, expect a high WTF rate.
* Ugly UI.  Daniel's original work was very nice-looking, and my additions
  to the user interface can't compete with what he did.
* UI not translated.  The user interface is available in English, only.
* Simple database.  All game data is kept in memory and serialized to a JSON
  log using the node-dirty database system.  This works well, but has limited
  capacity and the database file grows without bounds.

## Installing

The game uses node.js as server and depends on some npm packages.  To install
dependencies:

```
$ npm install
```

## Configuration

Create a `workdir` (defaults to the application directory) where you store 
`config.json` and the game database files. 

The game reads `config.default.json` and updates it with any changes in 
`config.json`. At a minimum `config.json` must include `adminUsers`
(a comma-separated list of admin users): 

    $ cat workdir/config.json
    {
        "adminUsers": "user1, user2"
    }

## Reverse Proxy

A reverse proxy must be configured to set a header (specified as the 
`usernameHeader` in `config-default.json`) to the username. This defaults to
`X-WEBAUTH-USER`. Websocket proxying must also be enabled. 

An example Nginx config: 

    upstream scrabbleWeb { server 127.0.0.1:9093; }
    server {
            listen 80;
            server_name scrabble.example.com;
            return 301 https://$host$request_uri;
    }
    server {
            listen 443 ssl http2;
            server_name scrabble.example.com;

            ssl_certificate           /etc/letsencrypt/live/scrabble.example.com/fullchain.pem;
            ssl_certificate_key       /etc/letsencrypt/live/scrabble.example.com/privkey.pem;

            auth_basic             "Restircted access";
            auth_basic_user_file   "/etc/nginx/passwords.htpasswd";

            location / {
                proxy_pass          http://scrabbleWeb;
                proxy_http_version  1.1;
                proxy_set_header    Host $host;
                proxy_set_header    X-WEBAUTH-USER $remote_user;
                proxy_set_header    Upgrade $http_upgrade;
                proxy_set_header    Connection "upgrade";
                proxy_set_header    X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header    X-Forwarded-Proto $scheme;
                proxy_set_header    X-Forwarded-Protocol $scheme;
                proxy_set_header    X-Forwarded-Host $http_host;
            }
    }

## Running

Once you're satisfied with the configuration, you can start the game
server using

```
$ node server.js
```

Open your web browser on the configured game URL to create a new game.
