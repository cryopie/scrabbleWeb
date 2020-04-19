var _ = require('underscore');
var repl = require('repl');
var http = require('http');
var util = require('util');
var os = require('os');
var fs = require('fs');
var io = require('socket.io');
var express = require('express');
var methodOverride = require('method-override');
var cookieParser = require('cookie-parser');
var errorhandler = require('errorhandler');
var basicAuth = require('basic-auth-connect');
var crypto = require('crypto');
var negotiate = require('express-negotiate');
var scrabble = require('./client/javascript/scrabble.js');
var icebox = require('./client/javascript/icebox.js');
var DB = require('./db.js');
var gamelabels = require('./labels.js');
var EventEmitter = require('events').EventEmitter;
var argv = require('optimist')
  .options('w', {
    alias: 'workdir',
    'default': './workdir'
  })
  .options('d', {
    alias: 'database',
    'default': 'data.db'
  })
  .options('c', {
    alias: 'config',
    'default': 'config.json'
  })
  .options('l', {
    alias: 'loglevel',
    'default': 'info'
  })
  .argv;

// Config ////////////////////////////////////////////////////////////////////

function maybeLoadConfig() {
  var config = {};
  function readConfig(filename) {
    try {
      return JSON.parse(fs.readFileSync(filename));
    }
    catch (e) {
      console.log('error reading configuration from ' + filensame + '\n' + e);
      process.exit(1);
    }            
  }
  var defaultConfig = readConfig(__dirname + "/config-default.json");
  var configFile = argv.workdir + "/" + argv.config;
  if (fs.existsSync(configFile)) {
    userConfig = readConfig(configFile);
  }
  config = Object.assign(defaultConfig, userConfig)
  return config;
}

var config = maybeLoadConfig();
console.log('config', config);

// Logging ////////////////////////////////////////////////////////////////////

function logger(level, message, game, player) { // message is mandatory
  date = new Date().toLocaleDateString('en-GB', {
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  var levels = ['debug', 'info', 'warn', 'error'];
  if (levels.indexOf(level) >= levels.indexOf(config.loglevel)) {
    if (typeof message !== 'string') {
      message = JSON.stringify(message);
    };
    m = "["+date+"] " + level +': ';
    m += game == null? "" : "(Game: " + game.label + ") ";
    m += player == null? "" : "(Player: " + player.name + ") ";
    m += message;
    console.log(m);
    }
}

var log = {
  debug: function(m, g, p) { logger("debug", m, g, p);},
  info: function(m, g, p) { logger("info", m, g, p);},
  warn: function(m, g, p) { logger("warn", m, g, p);},
  error: function(m, g, p) { logger("error", m, g, p); }
};

// Database //////////////////////////////////////////////////////////////////////

var db = new DB.DB(argv.workdir + "/" + argv.database);
db.on('load', function() {
  log.info('Database loaded from ' + argv.database);
});

db.registerObject(scrabble.Tile);
db.registerObject(scrabble.Square);
db.registerObject(scrabble.Board);
db.registerObject(scrabble.Rack);
db.registerObject(scrabble.LetterBag);

function makeKey() {
  return crypto.randomBytes(8).toString('hex');
}

function joinProse(array)
{
  var length = array.length;
  switch (length) {
    case 0:
      return "";
    case 1:
      return array[0];
    default:
      return _.reduce(array.slice(1, length - 1), function (word, accu) { return word + ", " + accu }, array[0]) + " and " + array[length - 1];
  }
}

// Middleware //////////////////////////////////////////////////////////////

var app = express();
app.use(methodOverride());
app.use(express.urlencoded({extended: true})); 
app.use(express.json());   
app.use(cookieParser());
app.use(errorhandler({
  dumpExceptions: true, 
  showStack: true
}));

// Users and Auth //////////////////////////////////////////////////////////
var userlist = {};
var adminUsers = config.adminUsers.split(",").map(function(x) { return x.trim(); });

app.use(function (req, res, next) {
  var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  var username = req.header(config.usernameHeader);
  if (username == null) {
    err = new Error('Request missing header: ' + config.usernameHeader);
    err.statusCode = 403;
    return next(err);
  } 
  else if (username.length < 1 ) {
    err = new Error('Username is empty');
    err.statusCode = 403;
    return next(err);
  }
  else { 
    req['username'] = username;
    if (username in userlist) {
      userlist[username].lastseen = Date.now();
      userlist[username].lastip = ip;
    }
    else {
      userlist[username] = { 
        lastip: null,
        lastseen: Date.now(),
        me: false,
        isAdmin: adminUsers.includes(username)
      };
    }
  }
  next()
});

app.use(express.static(__dirname + '/client'));
// Game //////////////////////////////////////////////////////////////////

function Game() {
}

util.inherits(Game, EventEmitter);

db.registerObject(Game);

Game.create = function(language, players, owner) {
  var game = new Game();
  game.language = language;
  game.players = players;
  game.key = makeKey();
  game.letterBag = scrabble.LetterBag.create(language);
  for (var i = 0; i < players.length; i++) {
    var player = players[i];
    player.index = i;
    player.rack = new scrabble.Rack(8);
    for (var j = 0; j < 7; j++) {
      player.rack.squares[j].tile = game.letterBag.getRandomTile();
    }
    player.score = 0;
    player.duration = 0;
  }
  game.board = new scrabble.Board();
  game.turns = [];
  game.whosTurn = 0;
  game.passes = 0;
  game.owner = owner;
  game.finished = false;
  game.winners = [];
  game.createTime = Date.now();
  game.duration = 0;
  game.startTime = -1;
  game.paused = true;
  game.pausedBy = players.map((player) => player.name);
  game.pausedWhy = "Waiting for players to join ... ";
  game.label = gamelabels.getRandomLabel();
  game.save();
  return game;
}

Game.prototype.otherPlayers = function(player)
{
  return _.pluck(_.without(this.players, player), 'name');
}

Game.prototype.makeLink = function(player)
{
  var url = "/game/" + this.key;
  if (player) {
    url += "/" + player.key;
  }
  return url;
}

Game.prototype.save = function(key) {
  // These objects were undefined and were causing errors in icebox
  delete this._events;
  delete this._maxListeners;
  db.set(this.key, this);
}

Game.prototype.nuke = function() {
  log.info("Deleting game.", this);
  db.nuke(this.key);
}

function patchUpFinishedGame(game) {
  return;
  var maxscore = 0;
  var winners = [];
  game.players.forEach(function(player) {
    if (player.score > maxscore) {
      winners = [player.name];
      maxscore = player.score;
    }
  })
  game.winners = winners;
  game.save();
}

Game.load = function(key) {
  if (!this.games) {
    this.games = {};
  }
  if (!this.games[key]) {
    var game = db.get(key);
    if (!game) {
      return null;
    }
    patchUpFinishedGame(game);
    EventEmitter.call(game);
    game.connections = [];
    Object.defineProperty(game, 'connections', { enumerable: false }); // makes connections non-persistent
    this.games[key] = game;
  }
  return this.games[key];
}

Game.prototype.notifyListeners = function(message, data) {
  this.connections.forEach(function (socket) {
    socket.emit(message, data);
  });
}

Game.prototype.lookupPlayer = function(req, suppressException) {
  var playerKey = req.cookies[this.key];
  for (var i in this.players) {
    if (this.players[i].key == playerKey) {
      return this.players[i];
    }
  }
  if (!suppressException) {
    throw "invalid player key " + playerKey + " for game " + this.key;
  }
}

Game.prototype.ensurePlayerAndGame = function(player) {
  var game = this;

  if (game.ended()) {
    throw "this game has ended: " + game.endMessage.reason;
  }

  // determine if it is this player's turn
  if (player !== game.players[game.whosTurn]) {
    throw "not this player's turn";
  }
}

Game.prototype.pauseGame = function(player, message) {
  var game = this;
  if (game.finished) {
    return;
  }
  if (game.pausedBy.includes(player.name)) {
    log.warn("Cannot pause twice");
    return;
  }
  game.pausedBy.push(player.name);
  log.debug(message == null? "Player paused game" : message, game, player);
  if (!game.paused) {
    game.pauseTime = Date.now();
    game.paused = true;
    game.pausedWhy = (message == null? "" : message);
    log.debug("Game paused", game);
  }
  game.save();
  game.notifyListeners('reload');
}

Game.prototype.resumeGame = function(player) {
  var game = this;
  if (!game.pausedBy.includes(player.name)) {
    log.warn("Cannot resume without pausing", game, player);
    return;
  }
  game.pausedBy = game.pausedBy.filter((x) => x != player.name);
  log.debug("Player resumed game", game, player);
  if (game.pausedBy.length == 0) { // Resume game.
    if (game.turns.length == 0) {
      if (!(game.startTime > 0)) {
        game.startTime = Date.now();
        game.pauseDuration = 0;
      } else {
        game.pauseDuration = (Date.now() - game.startTime);
      }
    } else {
      game.pauseDuration += (Date.now() - game.pauseTime);
    }
    game.pauseTime = 0;
    game.paused = false;
    game.pausedWhy = "";
    log.debug("Game resumed", game);
  }
  game.save();
  game.notifyListeners('reload');
}
  
Game.prototype.makeMove = function(player, placementList) {
  //console.log('makeMove', placementList);
  var game = this;
  // validate the move (i.e. does the user have the tiles placed, are the tiles free on the board
  var rackSquares = player.rack.squares.slice();          // need to clone
  var turn;
  var placements = placementList.map(function (placement) {
    var fromSquare = null;
    for (var i = 0; i < rackSquares.length; i++) {
      var square = rackSquares[i];
      if (square && square.tile &&
        (square.tile.letter == placement.letter
          || (square.tile.isBlank() && placement.blank))) {
        if (placement.blank) {
          square.tile.letter = placement.letter;
        }
        fromSquare = square;
        delete rackSquares[i];
        break;
      }
    }
    if (!fromSquare) {
      throw 'cannot find letter ' + placement.letter + ' in rack of player ' + player.name;
    }
    placement.score = fromSquare.tile.score;
    var toSquare = game.board.squares[placement.x][placement.y];
    if (toSquare.tile) {
      throw 'target tile ' + placement.x + '/' + placement.y + ' is already occupied';
    }
    return [fromSquare, toSquare];
  });
  placements.forEach(function(squares) {
    var tile = squares[0].tile;
    squares[0].placeTile(null);
    squares[1].placeTile(tile);
  });
  var move = scrabble.calculateMove(game.board.squares);
  if (move.error) {
    // fixme should be generalized function -- wait, no rollback? :|
    placements.forEach(function(squares) {
      var tile = squares[1].tile;
      squares[1].placeTile(null);
      squares[0].placeTile(tile);
    });
    throw move.error;
  }
  placements.forEach(function(squares) {
    squares[1].tileLocked = true;
  });

  // add score
  player.score += move.score;

  // get new tiles
  var newTiles = game.letterBag.getRandomTiles(placements.length);
  for (var i = 0; i < newTiles.length; i++) {
    placements[i][0].placeTile(newTiles[i]);
  }

  game.previousMove = { placements: placements,
    newTiles: newTiles,
    score: move.score,
    player: player };
  game.passes = 0;

  return [ newTiles,
    { type: 'move',
      player: player.index,
      score: move.score,
      move: move,
      placements: placementList } ];
}

Game.prototype.challengeOrTakeBackMove = function(type, player) {
  game = this;
  if (!game.previousMove) {
    throw 'cannot challenge move - no previous move in game';
  }
  var previousMove = game.previousMove;
  delete game.previousMove;

  var returnLetters = [];
  previousMove.placements.map(function(placement) {
    var rackSquare = placement[0];
    var boardSquare = placement[1];
    if (rackSquare.tile) {
      returnLetters.push(rackSquare.tile.letter);
      game.letterBag.returnTile(rackSquare.tile);
      rackSquare.placeTile(null);
    }
    rackSquare.placeTile(boardSquare.tile);
    boardSquare.placeTile(null);
  });
  previousMove.player.score -= previousMove.score;

  return [ [],
    { type: type,
      challenger: player.index,
      player: previousMove.player.index,
      score: -previousMove.score,
      whosTurn: ((type == 'challenge') ? game.whosTurn : previousMove.player.index),
      placements: previousMove.placements.map(function(placement) {
        return { x: placement[1].x,
          y: placement[1].y }
      }),
      returnLetters: returnLetters } ];
}

Game.prototype.pass = function(player) {
  var game = this;
  delete game.previousMove;
  game.passes++;

  return [ [],
    { type: 'pass',
      score: 0,
      player: player.index } ];
}

Game.prototype.returnPlayerLetters = function(player, letters) {
  var game = this;
  // return letter squares from the player's rack
  var lettersToReturn = new scrabble.Bag(letters);
  game.letterBag.returnTiles(_.reduce(player.rack.squares,
    function(accu, square) {
      if (square.tile && lettersToReturn.contains(square.tile.letter)) {
        lettersToReturn.remove(square.tile.letter);
        accu.push(square.tile);
        square.placeTile(null);
      }
      return accu;
    },
    []));
  if (lettersToReturn.contents.length) {
    throw "could not find letters " + lettersToReturn.contents + " to return on player " + player + "'s rack";
  }
}

Game.prototype.swapTiles = function(player, letters) {
  var game = this;

  if (game.letterBag.remainingTileCount() < 7) {
    throw 'cannot swap, letterbag contains only ' + game.letterBag.remainingTileCount() + ' tiles';
  }
  delete game.previousMove;
  game.passes++;
  var rackLetters = new scrabble.Bag(player.rack.letters());
  letters.forEach(function (letter) {
    if (rackLetters.contains(letter)) {
      rackLetters.remove(letter);
    } else {
      throw 'cannot swap, rack does not contain letter "' + letter + '"';
    }
  });

  // The swap is legal.  First get new tiles, then return the old ones to the letter bag
  var newTiles = game.letterBag.getRandomTiles(letters.length);
  game.returnPlayerLetters(player, letters);

  var tmpNewTiles = newTiles.slice();
  player.rack.squares.forEach(function(square) {
    if (!square.tile) {
      square.placeTile(tmpNewTiles.pop());
    }
  });

  return [ newTiles,
    { type: 'swap',
      score: 0,
      count: letters.length,
      player: player.index } ];
}

Game.prototype.remainingTileCounts = function() {
  var game = this;

  return { letterBag: game.letterBag.remainingTileCount(),
    players: game.players.map(function(player) {
      var count = 0;
      player.rack.squares.forEach(function(square) {
        if (square.tile) {
          count++;
        }
      });
      return count;
    })
  };
}

Game.prototype.finishTurn = function(player, newTiles, turn) {
  var game = this;
  // Calculate turn duration
  var now = Date.now();
  turn.endtime = now;
  if (game.turns.length == 0) {  // First turn
    turn.duration = now - game.startTime;
    player.duration = 0;
    game.duration = 0;
  } else {
    turnStartTime = game.turns[game.turns.length - 1].endtime
    turn.duration = now - turnStartTime;
  }
  if (game.pauseDuration != null && game.pauseDuration > 0) {
    turn.duration -= game.pauseDuration;
    game.pauseDuration = 0;
  }
  player.duration = turn.duration + (player.duration == null ? 0 : player.duration)
  game.duration = turn.duration + (game.duration == null ? 0 : game.duration)

  // store turn log
  game.turns.push(turn);

  // determine whether the game's end has been reached
  if (game.passes == (game.players.length * 2)) {
    game.finish('all players passed two times');
  } else if (_.every(player.rack.squares, function(square) { return !square.tile; })) {
    game.finish('player ' + game.whosTurn + ' ended the game');
  } else if (turn.type != 'challenge') {
    // determine who's turn it is now
    game.whosTurn = (game.whosTurn + 1) % game.players.length;
    turn.whosTurn = game.whosTurn;
  }

  // store new game data
  game.save();

  // notify listeners
  turn.remainingTileCounts = game.remainingTileCounts();
  game.notifyListeners('turn', 
    { turn: turn, 
      playerDuration: player.duration,
      gameDuration: game.duration
    });

  // if the game has ended, send extra notification with final scores
  if (game.ended()) {
    endMessage = icebox.freeze(game.endMessage);
    game.connections.forEach(function (socket) {
      socket.emit('gameEnded', endMessage);
    });
  }

  return { newTiles: newTiles };
}

Game.prototype.createFollowonGame = function(startPlayer, owner) {
  if (this.nextGameKey) {
    throw 'followon game already created: old ' + this.key + ' new ' + this.nextGameKey;
  }
  var oldGame = this;
  var playerCount = oldGame.players.length;
  var newPlayers = [];
  for (var i = 0; i < playerCount; i++) {
    var oldPlayer = oldGame.players[(i + startPlayer.index) % playerCount];
    newPlayers.push({ name: oldPlayer.name,
      key: oldPlayer.key });
  }
  var newGame = Game.create(oldGame.language, newPlayers, owner);
  oldGame.endMessage.nextGameKey = newGame.key;
  oldGame.save();
  newGame.save();

  oldGame.notifyListeners('nextGame', newGame.key);
}

Game.prototype.finish = function(reason) {
  var game = this;

  delete game.whosTurn;

  // Tally scores  
  var playerWithNoTiles;
  var pointsRemainingOnRacks = 0;
  var winners = [];
  var winningScore = 0;
  game.players.forEach(function(player) {
    var tilesLeft = false;
    var rackScore = 0;
    player.rack.squares.forEach(function (square) {
      if (square.tile) {
        rackScore += square.tile.score;
        tilesLeft = true;
      }
    });
    if (tilesLeft) {
      player.score -= rackScore;
      player.tallyScore = -rackScore;
      pointsRemainingOnRacks += rackScore;
    } else {
      if (playerWithNoTiles) {
        throw "unexpectedly found more than one player with no tiles when finishing game";
      }
      playerWithNoTiles = player;
    }
    if (player.score >= winningScore) {
      if (player.score > winningScore) {
        winners = [];
        winningScore = player.score;
      }
      winners.push(player.name);
    }
  });

  if (playerWithNoTiles) {
    playerWithNoTiles.score += pointsRemainingOnRacks;
    playerWithNoTiles.tallyScore = pointsRemainingOnRacks;
  }

  var endMessage = { reason: reason,
    players: game.players.map(function(player) {
      return { name: player.name,
        score: player.score,
        duration: player.duration,
        tallyScore: player.tallyScore,
        rack: player.rack };
    })
  };
  game.endMessage = endMessage;
  game.finished = true;
}

Game.prototype.ended = function() {
  return this.endMessage;
}

Game.prototype.newConnection = function(socket, player) {
  var game = this;
  if (!game.connections) {
    game.connections = [];
  }
  game.connections.push(socket);
  socket.game = game;
  if (player) {
    socket.player = player;
    game.notifyListeners('join', player.index);
  }
  // On disconnect, notify. If everyone leaves, pauseGame after 30 seconds
  socket.on('disconnect', function () {
    game.connections = _.without(game.connections, this);
    if (player) {
      game.notifyListeners('leave', player.index);
    }
    if (game.connections.length == 0) {
      setTimeout(function() {
        if (game.connections.length == 0 && !game.paused) {
          game.pauseGame(player, "Autopause: all players left");
          game.pausedBy = game.players.map((player) => player.name);
        }
      }, 10 * 1000);
    }
  });
}

// Handlers //////////////////////////////////////////////////////////////////
function gameHandler(handler) {
  return function(req, res) {
    var gameKey = req.params.gameKey;
    var game = Game.load(gameKey);
    if (!game) {
      console.log("Game " + req.params.gameKey + " does not exist");
      res.send(404);
    } else {
      handler(game, req, res);
    }
  }
}

function playerHandler(handler) {
  return gameHandler(function(game, req, res) {
    var player = game.lookupPlayer(req);
    handler(player, game, req, res);
  });
}

function adminHandler(handler) {
  return (function(req, res) {
    if (adminUsers.includes(req.username)) {
      handler(req, res);
    } else {
      log.warn("Non-admin user called " + handler);
      res.send(401);
    }
  })
}

app.get("/", function(req, res) {
  res.redirect("/games.html");
});

app.get("/title", function(req, res) {
  res.send(config.title);
});

app.get("/userlist", function(req, res) {
  ans = JSON.parse(JSON.stringify(userlist));
  ans[req.username].me = true;
  res.send(ans);
});

app.get("/games", function(req, res) {
  var showFinished = (req.query["showFinishedGames"] || "yes") == "yes" ? true : false
  res.send(db
    .all()
    .filter(function(game) {
      ans = true;
      ans &= (game.finished ? showFinished : true);
      return ans;
    })
    .map(function (game) {
      return { key: game.key,
        finished: game.finished,
        winners: game.winners == null? [] : game.winners,
        paused: game.paused == null? false : game.paused,
        createTime: game.createTime,
        startTime: game.startTime,
        label: game.label,
        owner: game.owner,
        players: game.players.map(function(player) {
          return { name: player.name,
            key: player.key,
            hasTurn: player == game.players[game.whosTurn]};
        })
      };
    }));
});

app.get("/game", function(req, res) {
  res.sendfile(__dirname + '/client/make-game.html');
});

app.get("/deleteGame/:gameKey", gameHandler(function(game, req, res) {
  if (!game.finished) {
    if (adminUsers.includes(req.username) || req.username == game.owner) {
      game.nuke();
    }
  }
  res.redirect("/games.html");
}));

app.post("/pauseGame/:gameKey", playerHandler(function(player, game, req, res) {
  game.pauseGame(player);
  res.redirect("back"); // Refresh the screen
}));

app.post("/resumeGame/:gameKey", playerHandler(function(player, game, req, res) {
  game.resumeGame(player);
  res.redirect("back"); // Refresh the screen
}));

app.post("/game", function(req, res) {
  var players = [];
  [1, 2, 3, 4].forEach(function (x) {
    var name = req.body['name' + x];
    //console.log('name', name, 'params', req.params);
    if (name) {
      players.push({ name: name,
        key: makeKey() });
    }
  });

  if (players.length < 2) {
    throw 'at least two players must participate in a game';
  }

  var game = Game.create(req.body.language || 'English', players, req.username);

  res.redirect("/games.html");
});

app.get("/admin/dbSize", adminHandler(function(req, res) {
  var stats = fs.statSync(db.path);
  var sizeInMB = (stats["size"] / (1024 * 1024)).toFixed(2);
  res.send({
    name: db.path,
    size: sizeInMB + " MiB"
  });
}));

app.post("/admin/spongeDB", adminHandler(function(req, res) {
  var games = db.all();
  var unFinishedGames = games.filter((game) => (!(game.finished)));
  var ufgl = unFinishedGames.length
  if (ufgl == 1) {
    res.send({msg: "Cannot sponge while there is an unfinished game"});
  } else if (ufgl > 1) {
    res.send({msg: "Cannot sponge while there are " + ufgl + " unfininshed games"});
  }
  else {
    db.sponge();
    res.send({msg: "Done"})
  }
}));

app.get("/game/:gameKey/:playerKey", gameHandler(function (game, req, res) {
  res.cookie(req.params.gameKey, req.params.playerKey, { path: '/', maxAge: (30 * 24 * 60 * 60 * 1000) });
  res.redirect("/game/" + req.params.gameKey);
}));

app.get("/game/:gameKey", gameHandler(function (game, req, res, next) {
  var thisPlayer = game.lookupPlayer(req, true);
  req.negotiate({
    'application/json': function () {
      var response = { 
        key: game.key,
        board: game.board,
        turns: game.turns,
        paused: game.paused,
        pausedBy: game.pausedBy,
        pausedWhy: game.pausedWhy,
        pauseTime: game.pauseTime,
        pauseDuration: game.pauseDuration,
        finished: game.finished,
        language: game.language,
        whosTurn: game.whosTurn,
        chatHistory: game.chatHistory,
        duration: game.duration,
        startTime: game.startTime,
        remainingTileCounts: game.remainingTileCounts(),
        legalLetters: game.letterBag.legalLetters,
        players: [] }
      for (var i = 0; i < game.players.length; i++) {
        var player = game.players[i];
        response.players.push({ name: player.name,
          score: player.score,
          duration: player.duration,
          rack: ((player == thisPlayer) ? player.rack : null) });
      }
      if (game.ended()) {
        response.endMessage = game.endMessage;
      }
      res.send(icebox.freeze(response));
    },
    'html': function () {
      res.sendFile(__dirname + '/client/game.html');
    }
  });
}));

app.post("/game/:gameKey", playerHandler(function(player, game, req, res) {
  var body = icebox.thaw(req.body);
  // console.log('put', game.key, 'player', player.name, 'command', body.command, 'arguments', req.body.arguments);
  var tilesAndTurn;
  switch (req.body.command) {
    case 'makeMove':
      game.ensurePlayerAndGame(player);
      tilesAndTurn = game.makeMove(player, body.arguments);
      break;
    case 'pass':
      game.ensurePlayerAndGame(player);
      tilesAndTurn = game.pass(player);
      break;
    case 'swap':
      game.ensurePlayerAndGame(player);
      tilesAndTurn = game.swapTiles(player, body.arguments);
      break;
    case 'challenge':
    case 'takeBack':
      tilesAndTurn = game.challengeOrTakeBackMove(req.body.command, player);
      break;
    case 'newGame':
      game.createFollowonGame(player, req.username);
      break;
    default:
      throw 'unrecognized game PUT command: ' + body.command;
  }
  if (tilesAndTurn) {
    var tiles = tilesAndTurn[0];
    var turn = tilesAndTurn[1];
    var result = game.finishTurn(player, tiles, turn);
    res.send(icebox.freeze(result));
  }
}));

var server = app.listen(config.port)
var io = io.listen(server);

io.sockets.on('connection', function (socket) {
  socket
    .on('join', function(data) {
      var socket = this;
      var game = Game.load(data.gameKey);
      if (!game) {
        console.log("game " + data.gameKey + " not found");
      } else {
        var player;
        game.players.map(function(player_) {
          if (player_.key == data.playerKey) {
            player = player_;
          } else {
            if (_.find(game.connections, function(connection) { return connection.player == player_ })) {
              socket.emit('join', player_.index);
            }
          }
        });
        if (data.playerKey && !player) {
          console.log('player ' + data.playerKey + ' not found');
        }
        game.newConnection(socket, player);
      }
    })
    .on('message', function(message) {
      if (this.game.chatHistory == null) {
        this.game.chatHistory = [];
      }
      this.game.chatHistory.push(message);
      this.game.notifyListeners('message', message);
    });
});

/*
var repl = repl.start({
  prompt: "scrabble> ",
  input: process.stdin,
  output: process.stdout
});

repl.context.db = db;
repl.context.Game = Game;
repl.context.DB = DB;
repl.context.config = config;
*/
