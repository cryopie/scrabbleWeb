function lsg(key) {
    return localStorage.getItem(key);
}

function lss(key, val) {
    return localStorage.setItem(key, val);
}

function populateUserlist() {
    // Populates window.userlist, window.userlistKeys, window.myname
    // Fill up the userName span
    var thead = THEAD(null,
      TR(null,
        TH({'colspan': "4", 'id': "userListHdr"}, "List of users")
      ),
      TR(null,
        TH(null, 'Username'),
        TH(null, 'Last seen'),
        TH({'style': "display: none;"}, 'Last seen date'),
        TH(null, 'IP')
      )
    );
    return $.getJSON('/userlist', function(data) {
      window.userlist = data;
      window.userlistKeys = Object.keys(data);
      var tbody = TBODY(null);
      Object.keys(data).forEach(function(username) {
        userdata = data[username];
        if (userdata.me) {
            window.myname = username;
        }
        tbody.append(TR(null,
            TD(userdata.me ? {'id': "me"} : null, username),
            TD(null, dateDiffNow(new Date(userdata.lastseen))),
            TD({Style: "display: none"}, new Date(userdata.lastseen).toLocaleString()),
            TD(null, userdata.lastip)
          ))
      })
      $("#userList").empty();
      $("#userList").append(thead);
      $('#userList').append(tbody);
      $("#userList").tablesorter({
        widthFixed: true,
        debug: false,
        sortList: [[2, "desc"]]
      });
      $("#userList").trigger('updateAll');
      if (window.userlist[window.myname].isAdmin) {
        $("#spongeDB").html("Sponge DB");
        $("#spongeDB").addClass("buttE").removeClass("buttD");
        $("#userName").html("&nbsp; | &nbsp;" +  window.myname + " (admin)");
      } else {
	$("#userName").text(window.myname);
      }
      $("#spongeDB").hover(function() {
          $.getJSON("/admin/dbSize", function(data) {
            $("#spongeDB").html("Sponge DB (" + data.size + ")");
        });
      });
      $("#spongeDB").click(function() {
        $.post('/admin/spongeDB', function(data) {
          $.blockUI({message: "<h3>" + data.msg + "</h3>"});
          setTimeout(function() {
            $.unblockUI();
          }, 3000);
        })
      });

    });
}

function sortUserlist() {
}

function dateDiffNow(date) {
  var diff = Date.now() - date;
  var ds = diff / 1000
  var dm = ds / 60;
  var dh = dm / 60;
  var dd = dh / 24;
  if (ds < 10)
    return "now"
  else if (ds < 60)
    return Math.floor(dm) + "s ago"
  else if (dm < 60)
    return Math.floor(dm) + "m ago"
  else if (dh < 24)
    return Math.floor(dh) + "h ago"
  else
    return Math.floor(dd) + "d ago"
}

function humanDuration(milliseconds) {
  if (milliseconds == null || Number.isNaN(milliseconds) || milliseconds == -1) {
    return "n/a"
  }
  var s = Math.round(milliseconds / 1000);
  var m = Math.floor(s / 60);
  
  return m + "m " + (s % 60) + "s"
}
