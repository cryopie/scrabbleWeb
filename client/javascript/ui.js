function triggerEvent(event, args) {
  //    console.log('triggerEvent', event, args);
  $(document).trigger(event, args);
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
      return _.reduce(array.slice(1, length - 1), function (accu, word) { return accu + ", " + word }, array[0]) + " and " + array[length - 1];
  }
}

var PrototypeMap = { Board: Board, Tile: Tile, Square: Square, Rack: Rack };
var PlayerColors = {0: "#C63228", 1: "#1E9433", 2: "#1E3794", 3: "#941E88"};

function UI(game) {
  // constructor

  var splitUrl = document.URL.match(/.*\/([0-9a-f]+)$/);
  if (splitUrl) {
    this.gameKey = splitUrl[1];
    this.playerKey = $.cookie(this.gameKey);
  } else {
    console.log('cannot parse url');
  }

  var ui = this;

  $.get('/game/' + this.gameKey, function (gameData, err) {
    gameData = thaw(gameData, PrototypeMap);
    console.log('gameData', gameData);

    ui.swapRack = new Rack(7);
    ui.swapRack.tileCount = 0;
    ui.board = gameData.board;
    ui.board.tileCount = 0;
    ui.legalLetters = gameData.legalLetters;
    ui.players = gameData.players;
    ui.keyboardPlacements = [];
    ui.remainingTileCounts  = gameData.remainingTileCounts;
    ui.duration = gameData.duration;
    ui.pauseDuration = gameData.pauseDuration;
    ui.startTime = gameData.startTime;
    ui.finished = gameData.finished;
    ui.paused = gameData.paused;
    ui.gametimelimit = gameData.gametimelimit;
    ui.maxplayerDuration = ui.gametimelimit / ui.players.length;

    $("#nameOfTheGame").text(gameData.label);
    if (ui.gametimelimit > 0) {
      $("#nameOfTheGame").text(gameData.label + " (" + humanDuration(ui.gametimelimit) + ")")
    }

    var playerNumber = 0;
    $('#scoreboard')
      .append(TABLE(null,
        gameData.players.map(function(player) {
          if (player.rack) {
            ui.rack = player.rack;
            ui.playerNumber = playerNumber;
            ui.thisPlayer = player;
            ui.rack.tileCount = _.reduce(player.rack.squares,
              function(accu, square) {
                if (square.tile) {
                  accu++;
                }
                return accu;
              },
              0);
          }
          playerNumber++;
          return TR({ 'class': 'player' + (playerNumber - 1) }, /* ieh */
            player.nameElement = TD({ 'class': 'name'}, player.rack ? "You" : player.name),
            TD({ 'class': 'remainingTiles' }, ''),
            TD({ 'class': 'status offline' }, '\u25cf'),
            player.scoreElement = TD({ 'class': 'score' }, player.score),
            player.durationElement = TD({ 'class': 'duration' }, ""),
            player.remainingTime = TD({ 'class': 'remainingTime' }, "")
          );
        }))
      )
      .append(DIV({ id: 'letterbagStatus' }));

    ui.drawBoard();
    if (ui.rack) {
      ui.drawRack();
      ui.drawSwapRack();
    }

    // Update chat history
    if (gameData.chatHistory != null) {
      gameData.chatHistory.forEach(function(message) {
        onChatMessage(message, false);
      })
    }

    // Start timers
    ui.turnTime = 0;
    ui.gameTime = (ui.duration == null ? 0 : ui.duration);
    if (!ui.finished) { // This is not a finished game
      if (ui.startTime > 0) { // Game has started
        prevTime = (gameData.turns.length == 0 ? ui.startTime : gameData.turns[gameData.turns.length - 1].endtime);
        ui.turnTime = (Date.now() - prevTime);
        ui.turnTime -= (ui.pauseDuration == null ? 0 : ui.pauseDuration);
        // If this is a paused game. subtract current pause time (not yet in pauseDuration)
        if (ui.paused) {
          ui.turnTime -= (Date.now() - gameData.pauseTime);
        }
        ui.gameTime += ui.turnTime;
      } else { // Game not yet started
        ui.gameTime = 0;
        ui.startTime = 0;
      }
    }
    ui.runClock();
    $("#pauseGame").click(ui.pauseGame);

    function onChatMessage(message, playSound) {
      var player_names = ui.players.map(function(player) { return player.name;})
      var color = PlayerColors[player_names.indexOf(message.name)] || "black";
      $('#chatLog')
        .append(DIV(null,
          SPAN({'class': 'name', 'style': 'color: '+color}, message.name),
          ': ',
          message.text))
        .animate({ scrollTop: $('#chatLog').prop('scrollHeight') }, 2);
      if (message.name != ui.thisPlayer.name) {
        ui.notify(message.name + " says", message.text);
      }
    }

    function scrollLogToEnd(speed) {
      $('#log').animate({ scrollTop: $('#log').prop('scrollHeight') }, speed);
    }

    function appendTurnToLog(turn, suppressScroll) {
      player = ui.players[turn.player];
      var div = DIV({ 'class': 'moveScore' },
        DIV({ 'class': 'score' },
          [player.name, "Score: " + turn.score, humanDuration(turn.duration)].join(" | ")
        )
      );
      switch (turn.type) {
        case 'move':
          turn.move.words.forEach(function (word) {
            $(div).append(DIV({ 'class': 'moveDetail' },
              SPAN({ 'class': 'word' }, word.word),
              SPAN({ 'class': 'score' }, word.score)));
          });
          if (turn.move.allTilesBonus) {
            $(div).append(DIV({ 'class': 'moveDetail' },
              SPAN({ 'class': 'word' }, "Bingo bonus"),
              SPAN({ 'class': 'score' }, 50)));
          }
          break;
        case 'pass':
          $(div).append(DIV({ 'class': 'moveDetail' }, "Passed"));
          break;
        case 'swap':
          $(div).append(DIV({ 'class': 'moveDetail' }, "Swapped " + turn.count + " tile" + ((turn.count > 1) ? "s" : "")));
          break;
        case 'challenge':
          $(div).append(DIV({ 'class': 'moveDetail' }, "Challenged previous move"));
          break;
        case 'takeBack':
          $(div).append(DIV({ 'class': 'moveDetail' }, "Took back previous move"));
          break;
        default:
          $(div).append(DIV({ 'class': 'moveDetail' }, "unknown move type " + turn.type));
      }
      $('#log').append(div);
    }

    function processMoveScore(turn) {
      player = ui.players[turn.player];
      player.score += turn.score;
      $(player.scoreElement).text(player.score);
    }

    function updateClockAndDuration(turn, playerDuration, gameDuration) {
      ui.turnTime = 0;
      ui.players[turn.player].duration = playerDuration;
      ui.gameTime = gameDuration;
    }

    function displayEndMessage(endMessage) {
      var winners;
      for (var i in ui.players) {
        var player = ui.players[i];
        var endPlayer = endMessage.players[i];
        player.score = endPlayer.score;
        player.tallyScore = endPlayer.tallyScore;
        player.rack = endPlayer.rack;
        if (player.tallyScore > 0) {
          $('#log').append(DIV({ 'class': 'gameEndScore' },
            player.name + ' gained ' + player.tallyScore + ' points from racks of the other players'));
        } else {
          $('#log').append(DIV({ 'class': 'gameEndScore' },
            player.name + ' lost ' + -player.tallyScore + ' points for their rack containing the letters '
            + _.without(player.rack.squares.map(function (square) {
              if (square.tile) {
                return square.tile.letter;
              }
            }), undefined)));
        }
        $(player.scoreElement).text(player.score);
        if (!winners || player.score > winners[0].score) {
          winners = [ player ];
        } else if (player.score == winners[0].score) {
          winners.push(player);
        }
      }
      var youHaveWon = _.contains(winners, ui.thisPlayer);
      $('#whosturn').empty();
      $('#log')
        .append(DIV({ 'class': 'gameEnded' },
          'Game has ended, '
          + joinProse(winners.map(function (player) {
            return youHaveWon ? 'you' : player.name
          }))
          + (((winners.length == 1) && !youHaveWon) ? ' has ' : ' have ') + 'won'));
    }

    function placeTurnTiles(turn) {
      for (var i in turn.placements) {
        var placement = turn.placements[i];
        var tile = new Tile(placement.letter, placement.score);
        var square = ui.board.squares[placement.x][placement.y];
        square.placeTile(tile, true);
        ui.blinkSquare(square, 4);
      }
    }

    function displayWhosTurn(playerNumber) {
      if (playerNumber == ui.playerNumber) {
        $('#whosturn').empty().text("Your turn");
        $('#turnControls').css('display', 'block');
      } else if (typeof playerNumber == 'number') {
        var name = ui.players[playerNumber].name;
        $('#whosturn').empty().text(name + "'" + ((name.charAt(name.length - 1) == 's') ? '' : 's') + " turn");
        $('#turnControls').css('display', 'none');
      } else if (ui.finished) {
        $('#whosturn').empty().text("Game Finished");
        $('#turnControls').css('display', 'none');
      } else {
        $('#whosturn').empty();
        $('#turnControls').css('display', 'none');
      }
    }

    $('#log').append(DIV({ 'class': 'gameStart' },
      gameData.language + " game '" + gameData.label + "' started"
    ));
    gameData.turns.map(appendTurnToLog);

    if (gameData.endMessage) {
      displayEndMessage(gameData.endMessage);
    }

    scrollLogToEnd(0);

    var yourTurn = gameData.whosTurn == ui.playerNumber;
    ui.whosTurn = gameData.whosTurn;
    displayWhosTurn(gameData.whosTurn);
    ui.boardLocked(!yourTurn);

    ui.updateGameStatus();

    var lastTurn = gameData.turns.length && gameData.turns[gameData.turns.length - 1];

    if (lastTurn && (lastTurn.type == 'move')) {
      if (yourTurn) {
        ui.addChallengeButton();
      } else if (lastTurn.player == ui.playerNumber) {
        // Disable the "Take back move" button
        // ui.addTakeBackMoveButton();
      }
    }

    var transports = ['websocket', 'flashsocket', 'htmlfile', 'xhr-multipart', 'xhr-polling', 'jsonp-polling'];

    ui.socket = io.connect(null, { transports: transports });
    ui.socket
      .on('connect', function(data) {
        console.log('socket connected');
        if (ui.wasConnected) {
          ui.cancelNotification();
          window.location = window.location;
        } else {
          ui.wasConnected = true;
          ui.socket.emit('join', { gameKey: ui.gameKey,
            playerKey: ui.playerKey });
        }
      })
      .on('disconnect', function(data) {
        console.log('socket disconnect');
        $.blockUI({ message: '<h1>Server unavailable, please wait</h1>' });
      })
      .on('turn', function (data) {
        turn = data.turn;
        console.log('turn', turn);
        appendTurnToLog(turn);
        scrollLogToEnd(300);
        processMoveScore(turn);
        updateClockAndDuration(turn, data.playerDuration, data.gameDuration); 
        // If this has been a move by another player, place tiles on board
        if (turn.type == 'move' && turn.player != ui.playerNumber) {
          placeTurnTiles(turn);
        }
        if (turn.type == 'challenge' || turn.type == 'takeBack') {
          var tilesTakenBack = [];
          turn.placements.map(function(placement) {
            var square = ui.board.squares[placement.x][placement.y];
            if (square.tile.isBlank()) {
              square.tile.letter = ' ';
            }
            tilesTakenBack.unshift(square.tile);
            square.placeTile(null);
          });
          if (turn.player == ui.playerNumber) {
            var lettersToReturn = new Bag(turn.returnLetters);
            ui.rack.squares.map(function(square) {
              if (square.tile && lettersToReturn.contains(square.tile.letter)) {
                lettersToReturn.remove(square.tile.letter);
                square.placeTile(null);
                square.placeTile(tilesTakenBack.pop());
              }
            });
            // Return any tiles to rack that have not been
            // replaced by tiles from the letterBag
            // (i.e. when it run empty)
            ui.rack.squares.map(function(square) {
              if (!square.tile && tilesTakenBack.length) {
                square.placeTile(tilesTakenBack.pop());
              }
            });
            ui.refreshRack();
            if (turn.type == 'challenge') {
              ui.notify('Challenged!',
                ui.players[turn.challenger].name + ' has challenged your move.  You have lost the '
                + (-turn.score) + ' points you have scored and the tiles you had placed are back on your rack');
            }
          }
          if (turn.type == 'takeBack') {
            ui.notify('Move retracted',
              ui.players[turn.challenger].name + ' has taken back his/her move.');
          }
        }
        ui.remainingTileCounts = turn.remainingTileCounts;
        if (turn.whosTurn == ui.playerNumber) {
          ui.playAudio("yourturn");
        } 
        ui.whosTurn = turn.whosTurn;
        ui.boardLocked(turn.whosTurn != ui.playerNumber);
        ui.removeMoveEditButtons();
        if (typeof turn.whosTurn == 'number' && turn.type != 'challenge') {
          displayWhosTurn(turn.whosTurn);
          if (turn.type == 'move' && turn.player == ui.playerNumber) {
            // Disable take back move
            //ui.addTakeBackMoveButton();
          }
          if (turn.whosTurn == ui.playerNumber && turn.type != 'takeBack') {
            ui.notify('Your turn!', ui.players[turn.player].name + ' has made a move and now it is your turn.');
            if (turn.type == 'move') {
              ui.addChallengeButton();
            }
          }
        }
        ui.updateGameStatus();
      })
      .on('gameEnded', function (endMessage) {
        if (!ui.finished) { // Game just finished. Reload
          location.reload();
        }
        endMessage = thaw(endMessage, PrototypeMap);
        displayEndMessage(endMessage);
        ui.notify('Game over!', 'Your game is over...');
      })
      .on('message', function (message) {
        onChatMessage(message, true);
      })
      .on('join', function(playerNumber) {
        $('tr.player' + playerNumber + ' td.status')
          .removeClass('offline')
          .addClass('online');
      })
      .on('reload', function(data) {
          location.reload(); 
      })
      .on('leave', function(playerNumber) {
        $('tr.player' + playerNumber + ' td.status')
          .removeClass('online')
          .addClass('offline');
      });

    $(document)
      .bind('SquareChanged', ui.eventCallback(ui.updateSquare))
      .bind('Refresh', ui.eventCallback(ui.refresh))
      .bind('RefreshRack', ui.eventCallback(ui.refreshRack))
      .bind('RefreshBoard', ui.eventCallback(ui.refreshBoard));

    // Load wordlists, dictionaries
    ui.loadWordLists(gameData.language);

    // Pause, resume, exit buttons
    $("#exitPaused").click(function() { 
        location.href="/"; 
    });
    $("#pauseGame").click(function() { 
      $.post('/pauseGame/' + gameData.key , function(data) {
        console.log("I paused game");
      });
    });

    if (gameData.pausedBy.includes(ui.thisPlayer.name)) {
      $("#resumeOrPause").text("Resume");
      $("#resumeOrPause").click(function() { 
        $.post('/resumeGame/' + gameData.key , function(data) {
          console.log("I resumed game");
        });
      });
    } else {
      $("#resumeOrPause").text("Pause");
      $("#resumeOrPause").click(function() { 
        $.post('/pauseGame/' + gameData.key , function(data) {
          location.reload(); 
        });
      });
    }
    // Block screen if paused 
    if (ui.paused) {
      msg = "Game paused by: [" + gameData.pausedBy.join(", ") + "]<br/>";
      msg += (gameData.pausedWhy == null ? "" : gameData.pausedWhy + "<br/>");
      $("#questionText").html(msg);
      $("#chat").detach().appendTo("#question");
      $.blockUI({message: $("#question"), 
        css: { width: '300px', padding: "2em 2em 2em 2em"},
        overlayCSS: {opacity: 0.90}
      });
    }
    ui.playAudio("pageload");
  }); // end $.get("/game/:gameKey")

  // Default key presses
  $('input[name=message]')
    .bind('focus', function() {
      ui.clearCursor();
    })
    .bind('change', function() {
      var message = $.trim($(this).val());
      if (message.length > 0) {
        ui.socket.emit('message', { name: ui.thisPlayer.name, text: message });
      }
      $(this).val('');
    });

  $(document).on('keydown', function (event) {  
    if (ui.cursor) { return; } // If cursor is focused, we don't handle it
    if (event.target.id != 'messageInputBox') {
      if (event.key == " ") {
        $("#messageInputBox").focus();
      } else if (event.key == "s") {
        ui.Shuffle();
      }
    }
  });

  var button = BUTTON({ id: 'turnButton', action: 'pass' }, 'Pass')
  $(button).bind('click', ui.eventCallback(ui.makeMove));
  $('#turnButtons')
    .append(button)
    .append(BUTTON({ id: 'dummyInput' }, ""));

  $('#dummyInput')
    .on('keypress', function(event) {
      var letter = String.fromCharCode(event.charCode).toUpperCase();
      if (ui.cursor && ui.legalLetters.indexOf(letter) != -1) {
        var rackSquare = ui.rack.findLetterSquare(letter, true);
        if (rackSquare) {
          if (rackSquare.tile.isBlank()) {
            rackSquare.tile.letter = letter;
          }
          ui.keyboardPlacements.push([rackSquare, ui.cursor.square, ui.cursor.direction]);
          ui.moveTile(rackSquare, ui.cursor.square);
          var newCursorSquare;
          if (ui.cursor.direction == 'horizontal') {
            for (var x = ui.cursor.square.x; x < 15; x++) {
              var boardSquare = ui.board.squares[x][ui.cursor.square.y];
              if (!boardSquare.tile) {
                newCursorSquare = boardSquare;
                break;
              }
            }
          } else {
            for (var y = ui.cursor.square.y; y < 15; y++) {
              var boardSquare = ui.board.squares[ui.cursor.square.x][y];
              if (!boardSquare.tile) {
                newCursorSquare = boardSquare;
                break;
              }
            }
          }
          if (newCursorSquare) {
            ui.setCursor(newCursorSquare);
          } else {
            ui.deleteCursor();
          }
        }
      }
    })
    .on('keydown', function(event) {
      function handled() {
        event.stopPropagation();
        event.preventDefault();
      }

      function move(dx, dy) {
        var x = ui.cursor.square.x;
        var y = ui.cursor.square.y;
        if (ui.cursor) {
          if (dx > 0) {
            for (x++; x < 15 && ui.board.squares[x][y].tile; x++);
          }
          if (dx < 0) {
            for (x--; x >= 0 && ui.board.squares[x][y].tile; x--);
          }
          if (dy > 0) {
            for (y++; y < 15 && ui.board.squares[x][y].tile; y++);
          }
          if (dy < 0) {
            for (y--; y >= 0 && ui.board.squares[x][y].tile; y--);
          }
          if (x >= 0 && x < 15
            && y >= 0 && y < 15
            && (x != ui.cursor.square.x || y != ui.cursor.square.y)) {
            var oldCursorSquare = ui.cursor.square;
            ui.cursor.square = ui.board.squares[x][y];
            ui.updateBoardSquare(oldCursorSquare);
            ui.updateBoardSquare(ui.cursor.square);
          }
        }
        handled();
      }

      function turnCursor() {
        if (ui.cursor) {
          ui.cursor.direction = (ui.cursor.direction == 'horizontal') ? 'vertical' : 'horizontal';
          ui.updateBoardSquare(ui.cursor.square);
        }
        handled();
      }

      function deleteLast() {
        if (ui.keyboardPlacements.length) {
          var lastPlacement = ui.keyboardPlacements.pop();
          var rackSquare = lastPlacement[0];
          var boardSquare = lastPlacement[1];
          var cursorDirection = lastPlacement[2];
          if (!rackSquare.tile && boardSquare.tile) {
            ui.moveTile(boardSquare, rackSquare);
            ui.setCursor(boardSquare, cursorDirection);
          } else {
            ui.keyboardPlacements = [];         // user has moved stuff around, forget keyboard entry
          }
        }
        handled();
      }

      switch (event.keyCode) {
        case $.ui.keyCode.UP:
          move(0, -1);
          break;
        case $.ui.keyCode.DOWN:
          move(0, 1);
          break;
        case $.ui.keyCode.LEFT:
          move(-1, 0);
          break;
        case $.ui.keyCode.RIGHT:
          move(1, 0);
          break;
        case $.ui.keyCode.SPACE:
          turnCursor();
          break;
        case $.ui.keyCode.BACKSPACE:
        case $.ui.keyCode.DELETE:
          deleteLast();
          break;
        case $.ui.keyCode.TAB:
          handled();
          break;
      }
    });
}

UI.prototype.runClock = function() {
  $("#gameTime").text("Game: " + humanDuration(ui.gameTime));
  $("#turnTime").text("Turn: " + humanDuration(ui.turnTime));
  for (i = 0; i < ui.players.length; i++) {
    // Set turn, and duration
    var player = ui.players[i];
    var playerDuration = player.duration + (i == ui.whosTurn ? ui.turnTime : 0);
    if (ui.gametimelimit > 0) { 
      var remainingTime = (ui.gametimelimit / ui.players.length) - playerDuration;
      // console.log("i = " + i + " Remaining Time: " + humanDuration(remainingTime));
      if (remainingTime < 0) { remainingTime = 0; }
      if (remainingTime == 0) {
        if (i == ui.playerNumber && i == ui.whosTurn && !ui.paused && !ui.finished) {
          ui.socket.emit('message', { name: "SYSTEM", text: "Auto-passed " + player.name + "'s turn (time elapsed)"});
          ui.pass();
        }
      }
      $(player.remainingTime).text(humanDuration(remainingTime));
    }
    $(player.durationElement).text(humanDuration(playerDuration));
    $(player.nameElement).css({
      'color': PlayerColors[i],
      'font-weight': (i == ui.whosTurn? '700' : 'normal')
    })
    $(player.nameElement).html((i == ui.whosTurn ? "> " : "") + player.name);
    // We have a max time for player
  }
  if (ui.paused || ui.finished) { return; }
  ui.gameTime += 1000;
  ui.turnTime += 1000;
  setTimeout(ui.runClock, 1000);
}

UI.prototype.displayRemainingTileCounts = function() {
  var counts = this.remainingTileCounts;
  if (counts.letterBag > 0) {
    $('#letterbagStatus')
      .empty()
      .append(DIV(null, SPAN({ id: 'remainingTileCount' }, counts.letterBag),
        " remaining tiles"));
    $('#scoreboard td.remainingTiles').empty();
  } else {
    $('#letterbagStatus')
      .empty()
      .append(DIV(null, "The letterbag is empty"));
    var countElements = $('#scoreboard td.remainingTiles');
    for (var i = 0; i < counts.players.length; i++) {
      var count = counts.players[i];
      $(countElements[i])
        .empty()
        .append('(' + count + ')');
    }
  }
  if (counts.letterBag < 7) {
    $('#swapRack').hide();
  } else {
    $('#swapRack').show();
  }
};

UI.prototype.eventCallback = function(f) {
  var ui = this;
  return function() {
    var args = Array.prototype.slice.call(arguments);
    args.shift();                                   // remove event
    if (typeof f == 'string') {
      f = ui[f];
    }
    f.apply(ui, args);
  }
};

UI.prototype.idToSquare = function(id) {
  var match = id.match(/(Board|Rack)_(\d+)x?(\d*)/);
  if (match) {
    if (match[1] == 'Board') {
      return this.board.squares[match[2]][match[3]];
    } else {
      return this.rack.squares[match[2]];
    }
  } else {
    throw "cannot parse id " + id;
  }
};

UI.prototype.updateSquare = function(square) {
  if (square.owner == this.rack
    || square.owner == this.swapRack) {
    this.updateRackSquare(square);
  } else if (square.owner == this.board) {
    this.updateBoardSquare(square);
  } else {
    console.log('could not identify owner of square', square);
  }
};

UI.prototype.blinkSquare = function(square, nBlinks) {
  var stepDuration = 1000;      // millisecond for each fade-in/fade-out
  var stepCount = nBlinks * 2;  // one step each for fade-in/fade-out
  var runningCount = 0;
  function step() {
    $("#" + square.id).fadeToggle(stepDuration, "swing", function() {
        if (++runningCount <= stepCount) { step(); } 
        else { $("#" + square.id).toggle(true);  }
    });
  };
  step();
}

UI.prototype.clearCursor = function() {
  var ui = this;
  var cursor = ui.cursor;
  if (cursor) {
    delete ui.cursor;
    ui.updateBoardSquare(cursor.square);
  }
};

UI.prototype.updateBoardSquare = function(square) {
  var div = DIV({ id: square.id });
  var ui = this;            // we're creating a bunch of callbacks below that close over the UI object

  if (square.tile) {
    $(div).addClass('Tile');
    if (square.tileLocked) {
      $(div).addClass('Locked');
    } else {
      $(div).addClass('Temp');
    }
    if (square.tile.isBlank()) {
      $(div).addClass('BlankLetter');
    }

    if (!square.tileLocked) {
      $(div).click(
        function () {
          if (ui.currentlySelectedSquare) {
            if (ui.currentlySelectedSquare == square) {
              ui.selectSquare(null);
              return;
            }
          }
          ui.selectSquare(square);
        }
      );

      var doneOnce = false;

      $(div).draggable({
        revert: "invalid",
        opacity: 1,
        helper: "clone",
        start: function(event, jui) {
          ui.selectSquare(null);
          $(this).css({ opacity: 0.5 });
          $(jui.helper)
            .animate({'font-size' : '120%'}, 300)
            .addClass("dragBorder");
        },

        drag: function(event, jui) {
          if (!doneOnce) {
            $(jui.helper).addClass("dragBorder");
            doneOnce = true;
          }
        },
        stop: function(event, jui) {
          $(this).css({ opacity: 1 });
        }
      });
      $(div).droppable({ // Replace a board-unlocked-tile with a rack-tile
        hoverClass: "dropActive",
        drop: function(event, jui) {
          ui.deleteCursor();
          fromSquare = ui.idToSquare($(jui.draggable).attr("id"));
          ui.switchTiles(fromSquare, square);
        }
      });
    }
    if (square.tile.letter && square.tile.letter === "_") {
      square.tile.letter = "";
    }
    $(div).append(A(null,
      SPAN({ 'class': 'Letter' }, square.tile.letter ? square.tile.letter : ''),
      SPAN({ 'class': 'Score' }, square.tile.score ? square.tile.score : '0')));
  } else {
    if (!ui.boardLocked()) {
      $(div)
        .click(function () {
          if (ui.currentlySelectedSquare) {
            ui.moveTile(ui.currentlySelectedSquare, square);
            ui.selectSquare(null);
          } else {
            function placeCursor() {
              ui.cursor = { square: square,
                direction: 'horizontal' };
            }
            if (ui.cursor) {
              if (ui.cursor.square == square) {
                // clicked on cursor to change direction
                if (ui.cursor.direction == 'horizontal') {
                  ui.cursor.direction = 'vertical';
                } else {
                  delete ui.cursor;
                }
              } else {
                // clicked on other square to move cursor
                ui.clearCursor();
                placeCursor();
              }
            } else {
              placeCursor();
            }
            ui.updateSquare(square);
          }
        })
        .droppable({
          hoverClass: "dropActive",
          drop: function(event, jui) {
            ui.deleteCursor();
            ui.moveTile(ui.idToSquare($(jui.draggable).attr("id")), square);
          }
        });
    }

    var text = ' ';
    if (ui.cursor && ui.cursor.square == square) {
      text = (ui.cursor.direction == 'horizontal') ? '\u21d2' : '\u21d3';
      $(div).addClass('Cursor');
      $('#dummyInput').focus();
    } else {
      switch (square.type) {
        case 'DoubleWord':
          if (square.x == 7 && square.y == 7) {
            text = '\u2605';
          } else {
            text = "DOUBLE WORD SCORE";
          }
          break;
        case 'TripleWord':
          text = "TRIPLE WORD SCORE";
          break;
        case 'DoubleLetter':
          text = "DOUBLE LETTER SCORE";
          break;
        case 'TripleLetter':
          text = "TRIPLE LETTER SCORE";
      }
    }
    $(div)
      .addClass('Empty')
      .append(A(null, text));
  }

  $('#' + square.id)
    .parent()
    .empty()
    .append(div);
};

UI.prototype.drawBoard = function() {
  var board = this.board;

  $('#board').append(TABLE(null,
    _.range(board.Dimension).map(function (y) {
      return TR(null,
        _.range(board.Dimension).map(function (x) {
          var square = board.squares[x][y];
          var id = 'Board_' + x + "x" + y;
          square.id = id;
          var tdClass = square.type;
          if (x == 7 && y == 7) {
            tdClass += ' StartField';
          } else if (square.type != 'Normal') {
            tdClass += ' SpecialField';
          }
          return TD({ 'class': tdClass },
            DIV({ id: id },
              A()));
        }));
    })));
  this.refreshBoard();
};

UI.prototype.slideRackTiles = function(fromSquare, toSquare) {
  // Slide rack tiles, and move fromSquare to toSquare
  var sqs = ui.rack.squares;
  var blankIds = [];
  var to = -1;
  var from = -1;
  var fromTile = fromSquare.tile;
  for (i = 0; i < sqs.length; i++) {
    if (!(sqs[i].tile)) { blankIds.push(i);  }
    if (sqs[i] == toSquare) { to = i; }
    if (sqs[i] == fromSquare) { from = i; }
  }
  if (blankIds.includes(to)) {
    return
  }
  // Find the blankId closest to 'to'
  var mindist = Infinity;
  var closestBlankId = -1;
  for (i = 0; i < sqs.length; i++) {
    if (blankIds.includes(i)) {
      dist = Math.abs(i - to);
      if (dist < mindist) {
        closestBlankId = i;
        mindist = dist;
      }
    }
  }
  fromSquare.placeTile(null); // Remove the tile from fromSquare
  if (closestBlankId > to) { // Slide right
    for (i = closestBlankId; i > to; i--) {
      if ((i-1) != from) { // Ignore the fromSquare 
        ui.moveTile(sqs[i-1], sqs[i]);
      }
    }
  } else { // Slide left
    for (i = closestBlankId; i < to; i++) {
      if ((i+1) != from) { // Ignore the fromSquare
        ui.moveTile(sqs[i+1], sqs[i]);
      }
    }
  }
  toSquare.placeTile(fromTile); // Place the tile in toSquare
}

UI.prototype.updateRackSquare = function(square) {
  var id = square.id;
  var div = document.createElement('div');
  $('#' + id)
    .parent()
    .empty()
    .append(div);

  div.setAttribute('id', id);

  var a = document.createElement('a');
  div.appendChild(a);

  var ui = this; // we're creating a bunch of callbacks below that close over the UI object

  if (square.tile) {
    $(div).addClass('Tile');
    if (square.tile.isBlank()) {
      $(div).addClass('BlankLetter');
    }
    $(div)
      .addClass('Temp')
      .click(
        function () {
          if (ui.currentlySelectedSquare) {
            if (ui.currentlySelectedSquare == square) {
              ui.selectSquare(null);
              return;
            }
          }
          ui.selectSquare(square);
        }
      );

    var doneOnce = false;

    $(div).draggable({
      revert: "invalid",
      opacity: 1,
      helper: "clone",
      start: function(event, jui) {
        ui.selectSquare(null);
        $(this).css({ opacity: 0.5 });
        $(jui.helper)
          .animate({'font-size' : '120%'}, 300)
          .addClass("dragBorder");
      },

      drag: function(event, jui) {
        if (!doneOnce) {
          $(jui.helper).addClass("dragBorder");
          doneOnce = true;
        }
      },
      stop: function(event, jui) {
        $(this).css({ opacity: 1 });
      }
    });

    $(div).droppable({
      hoverClass: "dropActive",
      drop: function(event, jui) {
        ui.deleteCursor();
        fromSquare = ui.idToSquare($(jui.draggable).attr("id"));
        ui.slideRackTiles(fromSquare, square);
      }
    });

    a.appendChild(SPAN({ 'class': 'Letter'  },
      square.tile.letter ? square.tile.letter : ''));
    a.appendChild(SPAN({ 'class': 'Score' },
      square.tile.score ? square.tile.score : ''));
  } else {
    div.setAttribute('class', 'Empty');

    $(div).click(
      function () {
        if (ui.currentlySelectedSquare) {
          ui.moveTile(ui.currentlySelectedSquare, square);
          ui.selectSquare(null);
        }
      }
    );

    $(div).droppable({
      hoverClass: "dropActive",
      drop: function(event, jui) {
        ui.deleteCursor();
        ui.moveTile(ui.idToSquare($(jui.draggable).attr("id")), square);
      }
    });
  }
};

UI.prototype.drawRack = function() {
  var rack = this.rack;

  $('#rack')
    .append(DIV({ id: 'rackButtons' },
      BUTTON({ id: 'Shuffle' }, "Shuffle"),
      BR(),
      BUTTON({ id: 'TakeBackTiles' }, "TakeBackTiles")),
      TABLE(null,
        TR(null,
          _.range(8).map(function (x) {
            var id = 'Rack_' + x;
            rack.squares[x].id = id;
            return TD({ 'class': 'Normal' },
              DIV({ id: id }, A()));
          }))));
  var ui = this;
  ['Shuffle', 'TakeBackTiles'].forEach(function (action) {
    $('#' + action).bind('click', ui.eventCallback(action));
  });
  forEach(range(8), function (x) {
    ui.updateRackSquare(rack.squares[x]);
  });
};

UI.prototype.drawSwapRack = function() {
  var swapRack = this.swapRack;
  $('#swapRack')
    .append(TABLE(null,
      TR(null,
        _.range(7).map(function (x) {
          var id = 'SwapRack_' + x;
          swapRack.squares[x].id = id;
          return TD({ 'class': 'Normal' },
            DIV({ id: id }, A()));
        }))));
  forEach(range(7), function (x) {
    ui.updateRackSquare(swapRack.squares[x]);
  });
};

UI.prototype.refreshRack = function() {
  var rack = this.rack;
  for (var x = 0; x < rack.squares.length; x++) {
    this.updateRackSquare(rack.squares[x]);
  }
};

UI.prototype.refreshBoard = function() {
  var board = this.board;
  for (var y = 0; y < board.Dimension; y++) {
    for (var x = 0; x < board.Dimension; x++) {
      this.updateBoardSquare(board.squares[x][y]);
    }
  }
};

UI.prototype.refresh = function () {
  this.refreshRack();
  this.refreshBoard();
};

UI.prototype.selectSquare = function(square) {

  if (this.currentlySelectedSquare) {
    $('#' + this.currentlySelectedSquare.id).removeClass('Selected');
  }

  this.currentlySelectedSquare = square;

  if (this.currentlySelectedSquare) {
    $('#' + this.currentlySelectedSquare.id).addClass('Selected');
  }

  $('#board td').removeClass('Targeted');

  // selecting the target first does not yet work.
  if (square && !square.tile) {
    console.log('SelectSquare - ' + square.x + '/' + square.y);
    $('#' + 'Board_' + square.x + "x" + square.y)
      .addClass('Targeted');
  }
};

UI.prototype.moveTile = function(fromSquare, toSquare) {
  // fromSquare must have a tile. toSquare must be empty.
  var tile = fromSquare.tile;
  var ui = this;
  fromSquare.placeTile(null);
  fromSquare.owner.tileCount--;
  if (tile.isBlank() && !tile.letter || (tile.letter == ' ')) {
    if (fromSquare.owner != this.board && toSquare.owner == this.board) {
      var blankLetterRequesterButton = $("#blankLetterRequester button");
      var blankLetterRequesterSkip = $("#blankLetterRequesterSkip button");
      function setLetter(letter) {
        tile.letter = letter;
        $.unblockUI();
        ui.updateSquare(toSquare);
        $('#dummyInput').focus();
        blankLetterRequesterSkip.off('click');
        blankLetterRequesterButton.off('keypress');
      }
      blankLetterRequesterButton.on('keypress', function (event) {
        var letter = String.fromCharCode(event.charCode);
        if (letter != '') {
          letter = letter.toUpperCase();
          if (ui.legalLetters.indexOf(letter) != -1) {
            setLetter(letter);
          }
        }
      });
      blankLetterRequesterSkip.on('click', function (){
        setLetter("_")
      });
      $.blockUI({ message: $('#blankLetterRequester') });
    } else if (toSquare.owner == ui.rack || toSquare.owner == ui.swapRack) {
      tile.letter = ' ';
    }
  }
  toSquare.placeTile(tile);
  toSquare.owner.tileCount++;
  if (!this.boardLocked() && !ui.paused) {
    setTimeout(function () { ui.updateGameStatus() }, 100);
  }
};

UI.prototype.switchTiles = function(fromSquare, toSquare) {
  // Both fromSquare and toSquare have tiles. Switch them.
  var toTile = toSquare.tile;
  toSquare.placeTile(null);
  toSquare.owner.tileCount--;
  ui.moveTile(fromSquare, toSquare);
  if (toTile.isBlank()) {
    toTile.letter = ' ';
  }
  fromSquare.placeTile(toTile);
  fromSquare.owner.tileCount++;
}

UI.prototype.updateGameStatus = function() {
  $('#move').empty();
  this.displayRemainingTileCounts();
  if (this.board.tileCount > 0) {
    this.setMoveAction('commitMove', 'Make move');
    var move = calculateMove(this.board.squares);
    if (move.error) {
      $('#move')
        .append(move.error);
      $('#turnButton').attr('disabled', 'disabled');
    } else {
      $('#move')
        .append(DIV(null, "score: " + move.score));
      move.words.forEach(function (word) {
        $('#move')
          .append(DIV(null, word.word + " " + word.score));
      });
      $('#turnButton').removeAttr('disabled');
    }
    $('#TakeBackTiles').css('visibility', 'inherit');
    $('#swapRack').hide();
  } else if (this.swapRack.tileCount > 0) {
    this.setMoveAction('swapTiles', 'Swap tiles');
    $('#board .ui-droppable').droppable('disable');
    $('#turnButton').removeAttr('disabled');
    $('#TakeBackTiles').css('visibility', 'inherit');
  } else {
    this.setMoveAction('pass', 'Pass');
    $('#board .ui-droppable').droppable('enable');
    $('#turnButton').removeAttr('disabled');
    $('#TakeBackTiles').css('visibility', 'hidden');
  }
};

UI.prototype.playAudio = function(id) {
  var audio = document.getElementById(id);

  if (audio.playing) {
    audio.pause();
  }

  audio.defaultPlaybackRate = 1;
  audio.volume = 1;

  try {
    audio.currentTime = 0;
    audio.play();
  }
  catch(e) {
    function currentTime() {
      audio.currentTime = 0;
      audio.removeEventListener("canplay", currentTime, true);
      audio.play();
    }
    audio.addEventListener("canplay", currentTime, true);
  }
};

UI.prototype.sendMoveToServer = function(command, args, success) {
  this.cancelNotification();
  $.ajax({
    type: 'POST',
    url: '/game/' + this.gameKey,
    contentType: 'application/json',
    data: JSON.stringify({ command: command,
      arguments: args }),
    success: success,
    error: function(jqXHR, textStatus, errorThrown) {
      console.log('PUT request returned error: ' + textStatus + ' (' + errorThrown + ')');
      location.reload("/");
    }
  });
};

UI.prototype.boardLocked = function(newVal) {
  if (arguments.length > 0) {
    if (newVal) {
      $('#turnButton').attr('disabled', 'disabled');
    } else {
      $('#turnButton').removeAttr('disabled');
    }
    this.board.locked = newVal;
    this.refreshBoard();
  }
  return this.board.locked;
};

UI.prototype.endMove = function() {
  this.removeMoveEditButtons();
  $('#move').empty();
  this.boardLocked(true);
};

UI.prototype.processMoveResponse = function(data) {
  console.log('move response:', data);
  var ui = this;
  data = thaw(data, PrototypeMap);
  if (!data.newTiles) {
    console.log('expected new tiles, got ' + data);
  }
  ui.rack.squares.forEach(function (square) {
    if (data.newTiles.length) {
      if (!square.tile) {
        square.placeTile(data.newTiles.pop());
        ui.rack.tileCount++;
        ui.updateRackSquare(square);
      }
    }
  });
};

UI.prototype.commitMove = function() {
  try {
    var ui = this;
    ui.keyboardPlacements = [];
    var move = calculateMove(this.board.squares);
    if (move.error) {
      alert(move.error);
      return;
    }
    this.endMove();
    if (move.tilesPlaced.length == 7) {
      ui.playAudio("applause");
    }
    for (var i = 0; i < move.tilesPlaced.length; i++) {
      var tilePlaced = move.tilesPlaced[i];
      var square = ui.board.squares[tilePlaced.x][tilePlaced.y];
      square.tileLocked = true;
      ui.updateBoardSquare(square);
    }
    ui.board.tileCount = 0;
    ui.sendMoveToServer('makeMove',
      move.tilesPlaced,
      bind(this.processMoveResponse, ui));

    ui.enableNotifications();
  }
  catch (e) {
    alert('error in commitMove: ' + e);
  }
};

UI.prototype.addLastMoveActionButton = function(action, label) {
  var ui = this;
  var button = BUTTON({ id: action }, label);
  $(button).click(function() {
    ui[action]();
  });
  $('#log div.moveScore div.score').last().append(button);
};

UI.prototype.addChallengeButton = function() {
  this.addLastMoveActionButton('challenge', 'Challenge');
};

UI.prototype.addTakeBackMoveButton = function() {
  this.addLastMoveActionButton('takeBackMove', 'Take back move');
};

UI.prototype.removeMoveEditButtons = function() {
  $('button#challenge').remove();
  $('button#takeBackMove').remove();
};

UI.prototype.challenge = function() {
  var ui = this;
  ui.TakeBackTiles();
  ui.endMove();
  ui.sendMoveToServer('challenge');
};

UI.prototype.takeBackMove = function() {
  var ui = this;
  ui.TakeBackTiles();
  ui.endMove();
  ui.sendMoveToServer('takeBack');
};

UI.prototype.pass = function() {
  var ui = this;
  ui.TakeBackTiles();
  ui.endMove();
  ui.sendMoveToServer('pass')
};

UI.prototype.swapTiles = function() {
  var ui = this;
  ui.endMove();
  var letters = ui.swapRack.letters();
  ui.swapRack.squares.forEach(function(square) {
    square.placeTile(null);
    ui.swapRack.tileCount--;
  });
  ui.sendMoveToServer('swap',
    letters,
    bind(this.processMoveResponse, ui));
};

UI.prototype.setMoveAction = function(action, title) {
  $('#turnButton')
    .attr('action', action)
    .empty()
    .append(title);
};

UI.prototype.makeMove = function() {
  var action = $('#turnButton').attr('action');
  // console.log('makeMove =>', action);
  this.deleteCursor();
  this[action]();
};

UI.prototype.deleteCursor = function() {
  if (ui.cursor) {
    var cursorSquare = ui.cursor.square;
    delete ui.cursor;
    ui.updateBoardSquare(cursorSquare);
  }
};

UI.prototype.setCursor = function(square, direction) {
  if (ui.cursor) {
    var oldCursorSquare = ui.cursor.square;
    ui.cursor.square = square;
    ui.updateBoardSquare(oldCursorSquare);
  } else {
    ui.cursor = { square: square,
      direction: (direction || 'horizontal') };
  }
  ui.updateBoardSquare(square);
};

UI.prototype.TakeBackTiles = function() {
  var ui = this;
  function putBackToRack(tile) {
    if (tile.isBlank()) {
      tile.letter = ' ';
    }
    var freeRackSquares = filter(function (square) { return !square.tile }, ui.rack.squares);
    var square = freeRackSquares.pop();
    square.tile = tile;
    ui.rack.tileCount++;
    ui.updateRackSquare(square);
  }

  ui.board.forAllSquares(function(boardSquare) {
    if (boardSquare.tile && !boardSquare.tileLocked) {
      putBackToRack(boardSquare.tile);
      boardSquare.tile = null;
      ui.board.tileCount--;
      ui.updateBoardSquare(boardSquare);
    }
  });
  ui.swapRack.squares.forEach(function(swapRackSquare) {
    if (swapRackSquare.tile) {
      putBackToRack(swapRackSquare.tile);
      swapRackSquare.tile = null;
      ui.swapRack.tileCount--;
      ui.updateRackSquare(swapRackSquare);
    }
  });
  this.deleteCursor();
  ui.updateGameStatus();
};

UI.prototype.Shuffle = function() {
  function random(i) {
    return Math.floor(Math.random() * i);
  }
  for (var i = 0; i < 16; i++) {
    var from = this.rack.squares[random(8)];
    var to = this.rack.squares[random(8)];
    var tmp = from.tile;
    from.tile = to.tile;
    to.tile = tmp;
  }
  this.refreshRack();
};

UI.prototype.enableNotifications = function() {
  // must be called in response to user action
  if (window.webkitNotifications) {
    console.log('notification permission:', window.webkitNotifications.checkPermission());
    if (window.webkitNotifications.checkPermission() != 0) {
      console.log('requesting notification permission');
      window.webkitNotifications.requestPermission();
    }
  }
};

UI.prototype.notify = function(title, text) {
  var ui = this;
  if (window.webkitNotifications) {
    this.cancelNotification();
    var notification = window.webkitNotifications.createNotification('favicon.ico', title, text);
    ui.notification = notification;
    $(notification)
      .on('click', function () {
        this.cancel();
      })
      .on('close', function () {
        delete ui.notification;
      });
    notification.show();
  }
};

UI.prototype.cancelNotification = function() {
  if (this.notification) {
    this.notification.cancel();
    delete this.notification;
  }
};

UI.prototype.loadWordLists = function(language) {
  var ncols = 5;
  if (language == "English") {
    var thead = THEAD(null,
      TR(null,
        TH({"colspan": 3},
          A({"class": "linkE", "href": 
            "https://scrabble.hasbro.com/en-us/tools#dictionary", "target": "_blank"}, "ScrabbleD")
        ),
        TH({"colspan": ncols - 3},
          A({"class": "linkE", "href": 
            "https://www.lexico.com/definition", "target": "_blank"}, "OED")
        )
      ),
      TR(null,
        TH({"colspan": ncols}, "Two letter words")
      )
    )
    var tbody = TBODY(null);
    var tr;
    colcount = 0;
    for (i = 0; i < wordlist_twoletters.length; i++) {
      word = wordlist_twoletters[i];
      if (colcount % ncols == 0) {
        tr = TR(null);
        tbody.append(tr);
      }
      tr.append(TD(null, word));
      colcount += 1;
    }
    $("#wordlists table").empty();
    $("#wordlists table").append(thead);
    $("#wordlists table").append(tbody);
  }
}
