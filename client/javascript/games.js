$(document).ready(function() {
  setTitle();
  registerLocalStorageToggle("#finishedGames", "fininshed games", "yes");
  var req = populateUserlist();
  req.success(function(resp){ 
    window.setInterval(populateUserlist, 5000);
    populateGamesList();
  });
});

// Registers an 'elem' (HTML and Local storage), sets elem text to 'msg', and defaults it to 'def'
function registerLocalStorageToggle(elem, msg, def) {
  // Set defaults
  if (lsg(elem) == null) {
    lss(elem, def);
  }
  $(elem).text(lsg(elem) == "yes" ? "Hide " + msg : "Show " + msg);
  // Set the handler
  $(elem).click(function(e) {  // Toggle
    hiddenGames = lsg(elem) || def;
    lss(elem, (lsg(elem) == "yes" ? "no": "yes"));
    $(elem).text(lsg(elem) == "yes" ? "Hide " + msg : "Show " + msg);
    populateGamesList();
  })
};

function setTitle() {
  $.get('/title', function(data) {
    if (data.length > 0) {
      $("#title").text(data);
    }
  });
};

function populateGamesList() {
  var thead = THEAD(null,
    TR(null, 
      TH({id: "gameListHdr"}, "List of Games")
    ),
    TR({id: "gameListHdrProper"},
      TH(null, 'Name'),
      TH(null, 'Owner'),
      TH(null, 'Created'),
      TH({class: "parser-false"}, 'Players'),
      function() {
        var th_state = TH({'class': 'tooltip'}, 'State');
        th_state.append(SPAN({'class': 'tooltiptext'}, "R: Running, P: Paused, F: Finished" ));
        return th_state;
      }(),
      TH({'class': "parser-false"}, 'Actions')
  ));

  params = ["showFinishedGames=" + lsg("#finishedGames")]
  var url = '/games?' + params.join('&');
  $.getJSON(url, function(data) {
    var tbody = TBODY(null);
    data.forEach(function (game, index) {
        tbody.append(
          TR({'class': (game.finished ? "finishedGame " : "" + game.paused ? "pausedGame " : "")},
            TD(null, 
              A({'class': 'linkE', 
                 'href': '/game/' + game.key + '/' + game.players
                      .filter(function(player) { return (player.name == window.myname)})
                      .map(function(player) { return player.key ; })
                }, game.label)
            ),
            TD(null, game.owner),
            TD(null, new Date(game.createTime).toLocaleString()),
            TD(null, game.players.map(function(player) { 
              return appendChildNodes(
                (window.myname == player.name || window.userlist[window.myname].isAdmin) ? 
                A({'href': '/game/' + game.key + '/' + player.key,
                   'class': 'linkE ' + (player.hasTurn ? 'hasTurn' : '')
                  }, player.name) : 
                A({'href': '#',
                   'class': 'linkD ' + (player.hasTurn ? 'hasTurn' : '')
                  }, player.name)
              )}
            )),
            TD(null,
              (game.finished ? "F": (game.paused ? "P" : "R"))
            ),
            function() {
              var td_actions = TD(null);
              if (!game.finished && (game.owner == window.myname || window.userlist[window.myname].isAdmin)) {
                  td_actions.append(A({class: 'linkE', href: '/deleteGame/' + game.key}, "Delete"));
              }
              return td_actions;
            }()
          ))
      })
    $("#gameList").empty();
    $("#gameList").append(thead);
    $("#gameList").append(tbody);
    // Fix the colspan of the first THEAD row (to span all columns)
    $("#gameListHdr").attr("colspan", $("#gameListHdrProper").children().length);
    $("#gameList").tablesorter({
      widthFixed: true, 
      debug: false,
      sortList: [[2, "desc"]]
    });
  });
}
