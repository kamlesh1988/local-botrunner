var http = require('http');
var bot;
var url = require('url');
var http = require('http');
var https = require('https');
var async = require('async');
var url = require('url');
var utils = require('./BotUtils');

var botenv = {};
botenv.botcontext = {}
var db = {};

function setupContext() {
    // bot = require(process.cwd() + '/index');
    setupHttp();
    botenv.botcontext.async = require('async');
    setupDb();
    return botenv;
}

function getHandler() {
    if (!bot) {
        bot = require(process.cwd() + '/index');
    }
    return bot;
}

function setupDb() {
    var diskdb = require('diskdb');
    var fs = require('fs');

    var dir = process.cwd() + '/temp_db';
    console.log("Using db dir as ", dir);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, 0777);
    }
    diskdb.connect(dir, ['botdata']);

    db.get = function (params, done) {
        var doc = diskdb.botdata.findOne(params);
        if (doc) {
            done(null, doc.value);
        } else {
            done(null, {});
        }
    }

    db.put = function (key, value, done) {
        var dataToSave = diskdb.botdata.findOne(key);
        var newRecords = false;
        if (!dataToSave) {
            dataToSave = {};
            newRecords = true;
        }
        dataToSave.key = key.key;
        dataToSave.value = value;
        console.log("Tring to save dataToSave", dataToSave);
        var saveddata;
        if (newRecords) {
            saveddata = diskdb.botdata.save(dataToSave);
        } else {
            saveddata = diskdb.botdata.update(key, dataToSave);
        }
        console.log("saveddata ==> ", saveddata)
        return done(null, saveddata);
    }

    db.getAll = function (done) {
        var docs = diskdb.botdata.find();
        if (docs) {
            done(null, docs);
        } else {
            done(null, []);
        }
    }

    db.clearAll = function (done) {
        try {
            diskdb.botdata.remove();
            done();
        } catch (e) {
            done(e);
        }
    }
}

function setupHttp() {
    botenv.botcontext.http = require('http');
    botenv.botcontext.https = require('https');
    var simplehttp = {};

    botenv.botcontext.simplehttp = simplehttp;

    simplehttp.parseURL = function parseURL(href) {
        return url.parse(href);
    };

    simplehttp.makeGet = function makeGet(geturl, headers, callback) {
        var options = simplehttp.parseURL(geturl);
        var headerJson = {};
        if (headers) {
            headerJson = headers;
        }
        options.headers = headerJson;
        simplehttp.httpRequest(options, callback);
    };

    simplehttp.makePost = function makePost(geturl, formParams, headers, callback) {
        var options = simplehttp.parseURL(geturl);
        var headerJson = {
            'Content-Type': 'application/x-www-form-urlencoded'
        };
        if (headers) {
            headerJson = headers;
        }
        options.headers = headerJson;
        options.method = 'POST';
        options.body = formParams;
        simplehttp.httpRequest(options, callback);
    };

    simplehttp.httpRequest = function httpRequest(options, done) {
        botenv.botcontext.console.log('options for httpRequest : ' + JSON.stringify(options));
        var callback = function (response) {
            var body = '';
            response.on('data', function (d) {
                body += d;
            });
            response.on('end', function () {
                var event1 = botenv.botcontext.createEventCopy();
                event1.type = "httprequest";
                event1.geturl = options.href;
                event1.getresp = body;
                event1.options = options;
                event1.success = true;
                event1.statusCode = response.statusCode;
                event1.headers = response.headers;
                console.log('Response from HttpCall ' + JSON.stringify(event1.getresp));
                if (done) {
                    done(botenv.botcontext, event1);
                } else {
                    bot.onHttpResponse(botenv.botcontext, event1);
                }
            });
            response.on('error', function (e) {
                var event1 = botenv.botcontext.createEventCopy();
                event1.type = "httprequest";
                event1.geturl = options.href;
                event1.getresp = JSON.stringify(e);
                event1.success = false;
                if (done) {
                    done(botenv.botcontext, event1);
                } else {
                    bot.onHttpResponse(botenv.botcontext, event1);
                }
            });
        }
        var request;
        if ('https:' == options.protocol) {
            request = botenv.botcontext.https.request(options, callback)
        } else {
            request = botenv.botcontext.http.request(options, callback)
        }
        if (options.body)
            request.write(options.body);
        request.end();
    };

    botenv.botcontext.simplehttp = simplehttp;
}

function executeFunction(context, event, res) {
    // setupLogs(event.botname);
    setupSimpleDb(context, event);
    setupMisc(context, event, res);
    try {
        bot = getHandler();
    } catch (e) {
        botenv.botcontext.sendError(e);
        return;
    }
    context.simpledb.fetchCommonAndContinue(function () {
        try {
            if (event.request) {
                if (typeof bot.onHttpEndpoint == 'function') {
                    bot.onHttpEndpoint(context, event);
                } else {
                    context.sendError(error, true);
                }
            } else if (event.messageobj.type === "event") {
                bot.onEvent(context, event);
            } else if (event.messageobj.type === "location") {
                if (typeof bot.onLocation == 'function') {
                    bot.onLocation(context, event);
                } else {
                    bot.onMessage(context, event);
                }
            } else {
                bot.onMessage(context, event);
            }
        } catch (e) {
            console.error(e);
            botenv.botcontext.sendError(e);
        }
    });
}


function setupSimpleDb(botcontext, botevent) {
    var simpledb = {};
    var botkey = "bot:global";
    var roomkey = "";
    if (!botevent.request || (botevent.params && botevent.params.contextid)) {
        if (botevent.params && botevent.params.contextid) {
            roomkey = "room:" + botevent.params.contextid;
        } else {
            roomkey = "room:" + botevent.contextobj.contextid;
        }
    }
    var tableName = 'botdata';
    var botname = botevent.botname;
    botenv.botcontext.simpledb = {};
    var fetchCommonAndContinue = function (onContinue) {
        botenv.botcontext.async.parallel({
            botleveldata: function (callback) {
                fetchItem(botkey, callback);
            },
            roomleveldata: function (callback) {
                if (!botevent.request || (botevent.params && botevent.params.contextid)) {
                    fetchItem(roomkey, callback);
                } else {
                    botenv.botcontext.console.log('Dont set roomleveldata for http endpoint request');
                    callback(null, "");
                }
            }
        }, function (error, data) {
            botleveldata = data.botleveldata;
            roomleveldata = data.roomleveldata;
            if (!botleveldata) {
                botleveldata = {};
            } else {
                botleveldata = utils.parseJson(botleveldata);
                if (!botleveldata) {
                    botleveldata = {};
                }
            }
            if (!roomleveldata) {
                roomleveldata = {};
            } else {
                roomleveldata = utils.parseJson(roomleveldata);
                if (!roomleveldata) {
                    roomleveldata = {};
                }
            }
            botenv.botcontext.simpledb.botleveldata = botleveldata;
            botenv.botcontext.simpledb.roomleveldata = roomleveldata;
            console.log('Setting up botleveldata : ', botleveldata);
            console.log('Setting up roomleveldata : ', roomleveldata);
            onContinue();
        });
    }

    var saveCommonAndContinue = function (onContinue) {
        botenv.botcontext.async.parallel([function (callback) {
            console.log('Trying to save botleveldata : ', simpledb.botleveldata);
            saveItem(botkey, simpledb.botleveldata, callback);
        }, function (callback) {
            if (!botevent.request || (botevent.params && botevent.params.contextid)) {
                console.log('Trying to save roomleveldata : ', simpledb.roomleveldata);
                saveItem(roomkey, simpledb.roomleveldata, callback);
            } else {
                callback(null, {});
            }
        }], function (error, data) {
            if (error) {
                botenv.botcontext.console.log(error);
            }
            onContinue();
        });
    }

    var doGet = function (dbkey, dbCallback) {
        fetchItem(dbkey, function (err, data) {
            var event1 = botenv.botcontext.createEventCopy();
            event1.type = "dbget";
            event1.dbkey = dbkey;

            if (err) {
                event1.result = "failed";
                event1.cause = {};
                event1.cause.msg = "error";
                event1.cause.err = err;
            } else if (typeof data === "undefined") {
                event1.result = "failed";
                event1.cause = {};
                event1.cause.msg = "not found";
            } else {
                botenv.botcontext.console.log('Found Data for Key ' + dbkey + ' :-> ' + data);
                event1.dbval = data;
                event1.result = "success";
            }

            if (dbCallback) {
                dbCallback(botenv.botcontext, event1);
            } else {
                bot.onDbGet(botenv.botcontext, event1);
            }
        });
    };

    var doPut = function doPut(dbkey, dbvalue, dbCallback) {
        saveItem(dbkey, dbvalue, function (err, finalItem) {
            var event1 = botenv.botcontext.createEventCopy();
            event1.type = "dbput";
            event1.dbkey = dbkey;

            if (err) {
                event1.result = "failed";
                event1.cause = {};
                event1.cause.msg = "error";
                event1.cause.err = err;
            } else {
                event1.result = "success";
                event1.dbval = dbvalue;
                event1.finalItem = finalItem;
            }
            if (dbCallback) {
                dbCallback(botenv.botcontext, event1);
            } else {
                bot.onDbPut(botenv.botcontext, event1);
            }
        });
    };

    var saveItem = function (key, value, done) {
        db.put({
            "key": key
        }, value, function (err, data) {
            if (err) {
                botenv.botcontext.console.log(err); // an error occurred
                done(err, null);
            } else {
                botenv.botcontext.console.log('saved to db'); // successful
                // response
                done(null, data);
            }
        });
    };

    var fetchItem = function (key, done) {
        var params = {
            "key": key
        }

        botenv.botcontext.console.log('Params to fetch item :-> ' + key);
        db.get(params, function (err, data) {
            if (err) {
                botenv.botcontext.console.log(err);
                done(err, null); // an error occurred
            } else {
                if (data) {
                    var responseData = data;
                    done(null, responseData); // successful response
                } else {
                    done(null, {});
                }
            }
        });
    }

    var clearAll = function (done) {
        botenv.botcontext.simpledb.botleveldata = {};
        botenv.botcontext.simpledb.roomleveldata = {};
        db.clearAll(done);
    }

    var saveData = function (done) {
        botenv.botcontext.async.parallel([
            function (callback) {
                saveItem(botkey, simpledb.botleveldata, callback);
            },
            function (callback) {
                if (!botenv.isHttpRequest) {
                    saveItem(roomkey, simpledb.roomleveldata, callback);
                } else {
                    callback(null, {});
                }
            }
        ], function (error, data) {
            if (error) {
                botenv.botcontext.console.error(error);
            }
            if (done) done(error);
        });
    }

    simpledb.fetchCommonAndContinue = fetchCommonAndContinue;
    simpledb.saveCommonAndContinue = saveCommonAndContinue;
    simpledb.doGet = doGet;
    simpledb.doPut = doPut;
    simpledb.saveItem = saveItem;
    simpledb.fetchItem = fetchItem;
    simpledb.clearAll = clearAll;
    simpledb.saveData = saveData;
    simpledb.getAll = db.getAll;

    botenv.botcontext.simpledb = {};
    botenv.botcontext.simpledb = simpledb;
}

var error = {
    code: 404,
    message: "The requested resource was not found"
};

function setupMisc(botcontext, event, res) {
    botcontext.console = {};
    botcontext.console.log = console.log;

    botcontext.createEventCopy = function () {
        var event1 = {};
        Object.keys(event).map(function (key) {
            event1[key] = event[key];
        });
        return event1;
    }

    botcontext.sendResponse = function (respstr, type) {
        botcontext.simpledb.saveCommonAndContinue(function () {
            if (!type) {
                type = 'application/json';
            }
            if (utils.isJson(respstr) && !(utils.parseJson(respstr) instanceof Array)) {
                var resArr = [];
                resArr.push(respstr);
                respstr = utils.getStringForm(resArr);
            }
            var response = {"type": type, "body": respstr}
            if (event.request) {
                console.log('Response sent to user :-> ', response);
                res.end(JSON.stringify(response));
            } else {
                console.log('respstr sent to user :-> ', respstr);
                res.end(respstr);
            }
        });
    }

    botcontext.sendMessage = function (config, userContextObj, message) {
        if (config.apikey || botevent.apikey) {
            let url = 'http://gupshup.io/sm/api/bot/' + event.botname + '/msg';
            let headers = {
                'content-type': 'application/x-www-form-urlencoded',
                'apikey': config.apikey || botevent.apikey
            };
            let formData = 'context=' + typeof userContextObj === 'string' ? userContextObj : JSON.stringify(userContextObj) + '&message=' + typeof message === 'string' ? message : JSON.stringify(message) + '&bypass=false';
            context.simplehttp.makePost(url, formData, headers);
        } else {
            botcontext.console.log('Sorry no ApiKey found. Please provide API key in config json.');
        }
    };

    botcontext.sendError = function (err, f, type) {
        var errorJson = {};
        if (!type) {
            type = 'application/json';
        }
        errorJson.type = type;
        console.log('Sending Error to user :-> ', err);
        if (f) {
            errorJson.body = err.stack;
        } else {
            if (utils.isJson(err)) {
                errorJson.body = 'ERROR : ' + JSON.stringify(err.stack, null, '\t');
            } else {
                errorJson.body = 'ERROR : ' + err;
            }
        }
        if (event.request) {
            res.end(utils.getStringForm(errorJson));
        } else {
            res.end(utils.getStringForm(errorJson.body));
        }
    }

    botcontext.nlp = {};
    botcontext.nlp.sendMessageToWit = function (options) {
        var message = options.message; // Mandatory
        var witContext = options.witContext; // optinal
        if (!witContext) {
            witContext = {};
        }
        var callback = options.callback;
        if (!(callback && typeof callback == 'function')) {
            return botcontext.sendResponse("ERROR : type of options.callback should be function and its Mandatory");
        }
        var witToken = options.witToken;

        if (!witToken) {
            if (!botcontext.simpledb.botleveldata.config || !botcontext.simpledb.botleveldata.config.witToken) {
                return botcontext.sendResponse("ERROR : witToken not set. Please set witToken to options.witToken or context.simpledb.botleveldata.config.witToken");
            } else {
                witToken = botcontext.simpledb.botleveldata.config.witToken;
            }
        }
        var witurl = "https://api.wit.ai/message?q=" + encodeURIComponent(message) + "&context=" + encodeURIComponent(JSON.stringify(witContext));
        var headers = {"Authorization": "Bearer " + witToken};
        botcontext.simplehttp.makeGet(witurl, headers, function (context, event) {
            if (event.getresp) {
                var res = JSON.parse(event.getresp);
                callback(res);
            } else {
                callback({})
            }
        });
    }

    botcontext.nlp.sendMessageToApiAi = function (options) {
        var message = options.message; // Mandatory
        var sessionId = options.sessionId || ""; // optinal
        var callback = options.callback;
        if (!(callback && typeof callback == 'function')) {
            return botcontext.sendResponse("ERROR : type of options.callback should be function and its Mandatory");
        }
        var nlpToken = options.nlpToken;

        if (!nlpToken) {
            if (!botcontext.simpledb.botleveldata.config || !botcontext.simpledb.botleveldata.config.nlpToken) {
                return botcontext.sendResponse("ERROR : token not set. Please set Api.ai Token to options.nlpToken or context.simpledb.botleveldata.config.nlpToken");
            } else {
                nlpToken = botcontext.simpledb.botleveldata.config.nlpToken;
            }
        }
        var query = '?v=20150910&query=' + encodeURIComponent(message) + '&sessionId=' + sessionId + '&timezone=Asia/Calcutta&lang=en    '
        var apiurl = "https://api.api.ai/api/query" + query;
        var headers = {"Authorization": "Bearer " + nlpToken};
        botcontext.simplehttp.makeGet(apiurl, headers, function (context, event) {
            if (event.getresp) {
                callback(JSON.parse(event.getresp));
            } else {
                callback({})
            }
        });
    }

    botcontext.nlp.sendMessageToLuis = function (options) {
        var message = options.message; // Mandatory

        var callback = options.callback;
        if (!(callback && typeof callback == 'function')) {
            return botcontext.sendResponse("ERROR : type of options.callback should be function and its Mandatory");
        }

        // Validation for luis_app_id
        if (!options.luis_app_id) {
            if (botcontext.simpledb.botleveldata.config && botcontext.simpledb.botleveldata.config.luis_app_id) {
                option.luis_app_id = botcontext.simpledb.botleveldata.config.luis_app_id;
            } else {
                return botcontext.sendResponse("ERROR : luis_app_id is not set. Please set luis_app_id to options.luis_app_id or context.simpledb.botleveldata.config.luis_app_id");
            }
        }
        // Validation for luis_subscription_key
        if (!options.luis_subscription_key) {
            if (botcontext.simpledb.botleveldata.config && botcontext.simpledb.botleveldata.config.luis_subscription_key) {
                option.luis_subscription_key = botcontext.simpledb.botleveldata.config.luis_subscription_key;
            } else {
                return botcontext.sendResponse("ERROR : luis_subscription_key is not set. Please set luis_subscription_key to options or context.simpledb.botleveldata.config.luis_subscription_key");
            }
        }
        var query = "q=" + encodeURIComponent(message) + "&id=" + options.luis_app_id + "&subscription-key=" + options.luis_subscription_key;
        var luisUrl = "https://api.projectoxford.ai/luis/v1/application?" + query;
        var headers = {};
        botcontext.simplehttp.makeGet(luisUrl, headers, function (context, event) {
            if (event.getresp) {
                var res = JSON.parse(event.getresp);
                callback(res);
            } else {
                callback({})
            }
        });
    }


}

function setupLogs(botname) {
    var originalConsoleLog = console.log;
    var originalConsoleError = console.error;
    console.log = function () {
        args = [];
        args.push(' [' + botname + '] | ');
        // Note: arguments is part of the prototype
        for (var i = 0; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        originalConsoleLog.apply(console, args);
    };
    console.error = function () {
        args = [];
        args.push(' [' + botname + '] | Error : ');
        // Note: arguments is part of the prototype
        for (var i = 0; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        originalConsoleError.apply(console, args);
    };
}


module.exports = {
    setupContext: setupContext,
    executeFunction: executeFunction,
    setupMisc: setupMisc,
    setupSimpleDb: setupSimpleDb
}
