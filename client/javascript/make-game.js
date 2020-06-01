$(document).ready(function() {
    var req = populateUserlist();
    req.success( function(resp) { 
      window.setInterval(populateUserlist, 10 * 1000);
      $('input').attr('autocomplete', 'off');
      $('input.name')
          .autocomplete({
              source: window.userlistKeys
          })
      $('form').on('submit', function(event) {
          var valid = true;
          var playerCount = 0;
          var firstEmptyPath;
          var playerNames = [];
          for (var index = 0; index < 4; index++) {
              var namePath = 'input[name=name' + index +']';
              var name = $(namePath).val();
              if (name) {
                  if (!(name in window.userlist)) {
                    alert("No such user: " + name)
                    return false;
                  }
                  playerCount++;
                  if (_.contains(playerNames, name)) {
                      return false;
                  }
                  playerNames.push(name);
              }
          }
          return playerCount >= 2;
      });
      $('input').first().focus();
    })
});
