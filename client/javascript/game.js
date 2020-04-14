var ui = 0;

$(document).ready(function() {
    ui = new UI();
    loadWordLists();
});

function loadWordLists() {
  ncols = 5;
  var thead = THEAD(null, 
    TR(null, 
      TH({"colspan": 3}, 
        A({"class": "linkE", "href": "https://scrabble.hasbro.com/en-us/tools#dictionary", "target": "_blank"}, "ScrabbleD")
      ),
      TH({"colspan": ncols - 3},
        A({"class": "linkE", "href": "https://www.lexico.com/definition", "target": "_blank"}, "OED")
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
