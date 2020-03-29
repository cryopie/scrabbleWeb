function loadAddressBook() {
    var addressBook = [];
    if (localStorage.getItem('addressBook')) {
        addressBook = JSON.parse(localStorage.getItem('addressBook'));
    }
    return addressBook;
}

function saveAddressBook(addressBook) {
    localStorage.setItem('addressBook', JSON.stringify(addressBook));
}

function lookupName(adddressBook, name) {
    for (var i in adddressBook) {
        var entry = adddressBook[i];
        if (entry.name.toLowerCase() == name.toLowerCase()) {
            return entry;
        }
    }
    return null;
}

function setName(addressBook, name) {
    var entry = lookupName(addressBook, name);
    if (entry) {
        entry.name = name;
    } else {
        addressBook.push({ name: name });
    }
}

$(document).ready(function() {
    var addressBook = loadAddressBook();
    $('input').attr('autocomplete', 'off');
    $('input.name')
        .autocomplete({
            source: addressBook.map(function(entry) { return entry.name; })
        })
        .blur(function() {
            var entry = lookupName(addressBook, $(this).val());
        });
    
    $('form').on('submit', function(event) {
        var valid = true;
        var playerCount = 0;
        var firstEmptyPath;
        var playerNames = [];
        for (var index = 0; index < 4; index++) {
            var namePath = 'input[name=name' + index +']';
            var name = $(namePath).val();
            if (name) {
                setName(addressBook, name);
                playerCount++;
                if (_.contains(playerNames, name)) {
                    return false;
                }
                playerNames.push(name);
            }
        }
        saveAddressBook(addressBook);
        return playerCount >= 2;
    });
    $('input').first().focus();
});
