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

DB.prototype.reload = function() {
  this.dirty = dirty(this.path);
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
  this.dirty.set(key, {});
  this.reload();
}

DB.prototype.sponge = function() {
  var db = this;
  var filename = db.path + ".temporary";
  if (fs.existsSync(filename)) {
    return {message: "Failed. Temporary file still exists: " + filename + "Remove it."}
  }
  var sponged = dirty(filename);
  function drain() {
    db.dirty.close();
    var newf = db.path + ".old." + Date.now();
    fs.renameSync(db.path, newf);
    childprocess.execSync("gzip '" + newf + "'");
    fs.renameSync(filename, db.path);
    db.dirty = dirty(db.path);
    console.log('DB Sponging finished');
    // return Promise((resolve) => 
  };
  sponged.on('drain', drain);
  db.dirty.forEach(function(key, value) {
    if (value != null && Object.keys(value).length != 0) {
      sponged.set(key, value);
    }
  });
  return {message: "Sponging in progress"};
}

DB.prototype.all = function() {
  var retval = [];
  this.dirty.forEach(function(key, value) {
    if (value != null && Object.keys(value).length != 0) {
      retval.push(value);
    }
  });
  return retval;
}

exports.DB = DB;
