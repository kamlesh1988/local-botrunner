var dispatcher = require('httpdispatcher');
var http = require('http');
var url = require('url');
var http = require('http');
var https = require('https');
var async = require('async');
var url = require('url');
var botRunner = require('./localBotRunner');
var utils = require('./BotUtils');

const PORT = process.env.PORT || 8081;

process.on("uncaughtException", function(err) {
    console.error("Caught exception:", err, err.stack);
});

function handleRequest(request, response) {
    try {
        console.log(request.url);
        dispatcher.dispatch(request, response);
    } catch (err) {
        console.log(err);
    }
}
var server;
var botenv = {};
botenv.botcontext = {};
botenv = botRunner.setupContext();

dispatcher.onGet("/botcallback", function(req, res) {
    var queryObject = url.parse(req.url, true).query;
    var event = setupEvent(queryObject);
    var context = botenv.botcontext;
    botRunner.executeFunction(context, event, res);
});

dispatcher.onError(function(req, res) {
    res.writeHead(501);
    res.end("ERROR : Something went wrong check bot logs for more details.");
});

function setupEvent(queryObject) {
    var botevent = {};
    if (queryObject.httpevent) {
        var httpevent = JSON.parse(queryObject.httpevent);
        Object.keys(httpevent).map(function(key) {
            var val = httpevent[key];
            botevent[key] = val;
        });
    } else {
        var userevent = queryObject;
        Object.keys(userevent).map(function(key) {
            var val = userevent[key];
            if (utils.isJson(val)) {
                val = utils.parseJson(val);
            }
            botevent[key] = val;
        });
        botevent.botname = userevent.botname;
        botevent.context = botevent['contextobj'];
        botevent.message = botevent['messageobj']['text'];
        botevent.sender = botevent['senderobj'];
    }
    console.log('Bot event : \n' + JSON.stringify(botevent));
    return botevent;
}

exports.init = function() {
    server = http.createServer(handleRequest);
    server.listen(PORT, function() {
        //Callback triggered when server is successfully listening. Hurray!
        console.log("Server listening on: http://localhost:%s", PORT);
    });
}
