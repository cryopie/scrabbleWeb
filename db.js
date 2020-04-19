var fs = require('fs');
var dirty = require('dirty');
var util = require('util');
var childprocess = require('child_process');
var icebox = require('./client/javascript/icebox.js');
var EventEmitter = require('events').EventEmitter;

// //////////////////////////////////////////////////////////////////////

function DB(path) {
    this.prototypeMap = {};
    EventEmitter.call(this);
    //console.log('opening database', path);
    this.path = path;
    this.dirty = dirty(path);
    var db = this;
    this.dirty.on('load', function () { db.emit('load', 0); });
}

util.inherits(DB, EventEmitter);

DB.prototype.registerObject = function(constructor) {
    this.prototypeMap[constructor.name] = constructor;
}

DB.prototype.get = function(key) {
    return icebox.thaw(this.dirty.get(key), this.prototypeMap);
}

DB.prototype.set = function(key, object) {
    this.dirty.set(key, icebox.freeze(object));
}

DB.prototype.nuke = function(key) {
    this.dirty.rm(key);
}

DB.prototype.sponge = function() {
    var db = this;
    var filename = this.path + ".temporary";
    if (fs.existsSync(filename)) {
        throw 'sponge cannot overwrite existing file ' + filename;
    }
    var sponged = dirty(filename);
    sponged.on('load', function() {
        db.dirty.forEach(function(key, value) {
          if (value != null) {
            sponged.set(key, value);
          }
        });
    });
    sponged.on('drain', function() {
        newf = db.path + ".old." + Date.now();
        fs.renameSync(db.path, newf);
        childprocess.execSync("gzip '" + newf + "'");
        fs.renameSync(filename, db.path);
        db.dirty = dirty(db.path);
        console.log('DB Sponging finished');
    });
}

DB.prototype.all = function() {
    var retval = [];
    this.dirty.forEach(function(key, value) {
      if (value != null) {
        retval.push(value);
      }
    });
    return retval;
}

exports.DB = DB;
