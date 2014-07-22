var express = require('express');
var path = require('path');
var favicon = require('static-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var app = express();
var http = require('http');
var server = http.Server(app);

var mongo = require('mongodb');
var ObjectId = mongo.ObjectID;
var db = require("mongoskin").db('mongodb://jaques:fidejaques114@kahana.mongohq.com:10015/scissors_db');

//  WebSockets
var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({server:server});

/*  Currently open sockets
*   {
*       userId:socket
*   }    
*/
var openSockets = {};

//  Websocket connection and logic
wss.on('connection', function(ws) {

    console.log("USER-LOGIN");

    //  Catch username from url
    var username = ws.upgradeReq.url.match(/(\w+)(?:\/*)$/i)[1];
    var userId;

    //  Get logged user's info
    db.collection("users").findOne({username:username},function(err,result){

        //  Set userId
        userId = result._id;
        
        //  Assign open socket
        openSockets[userId] = ws;
        console.log("new socket: "+userId);

        //  Send user's files to client
        result.files.forEach(function(id){
            db.collection("files").findOne({_id:id},function(err,file){
                
                ws.send(JSON.stringify({
                    type: "file",
                    content: file
                }));

                console.log("file sent to user "+username);
                console.log(file);

            });
        });
    });

    console.log("connected: " + username);
    console.log("current connections: " +Object.keys(openSockets));
    
    //  On message recieved behaviour
    ws.on('message', function(JSONdata) {
        
        console.log('received message from ' + username + ': ' + JSONdata);

        //  Parse JSON recieved
        var data = JSON.parse(JSONdata);

        //  Switch over data's type
        switch(data.type){

            case "new-file":

                console.log("\nNEW-FILE:");

                //  Find users to invite to file
                db.collection("users").find({username:{$in:data.content.users}}).toArray(function(err,results){
                    console.log(results);

                    //  Array of users' id's
                    var idArray = [];
                    
                    for(var i=0;i<results.length;++i){
                        idArray.push(results[i]._id);
                    }
                    
                    //  Insert new file
                    db.collection("files").insert({name:data.content.name, users:idArray, chat:[],using:null},function(err,item){
                        //  Remark: Only 1 file is created for sure, so
                        //          we can always call item[0]
                        console.log(item[0]._id);

                        //  Add new file's _id to users' file array
                        db.collection("users").update({_id:{$in:idArray}},{$push:{files:item[0]._id}},{multi:true},function(err,subitems){
                            console.log(subitems);
                        });

                        //  Send new file to its users' clients
                        for(var i=0;i<idArray.length;++i){
                            if(openSockets[idArray[i]]){
                                openSockets[idArray[i]].send(JSON.stringify({
                                    type: "file",
                                    content: item[0]
                                }));
                            }
                        }
                    });
                });
                break;

            case "chat-start":

                console.log("\nUSER "+username+" just entered chat "+data.content.id);


                db.collection("files").findOne({_id:new ObjectId(data.content.id)},function(err,file){
                    //console.log(file);
                    console.log("client's chat length: "+data.content.length);
                    console.log("server's chat length: "+file.chat.length);
                    var messagesDiff = -(file.chat.length - data.content.length);

                    //caso o chat do ficheiro esteja up-to-date
                    if(messagesDiff == 0){
                        ws.send(JSON.stringify({
                            type: "chat-start",
                            content: {
                                //id: data.content.id,
                                messagesToAdd:[]
                            }
                        }));
                    }         
                    //caso o chat do ficheiro não esteja up-to-date      
                    else{
                        ws.send(JSON.stringify({
                            type: "chat-start",
                            content: {
                                //id: data.content.id,
                                messagesToAdd:file.chat.slice(messagesDiff)
                            }
                        }));
                    }    
                });
                break;

            case "chat-message":
                
                console.log("\nUSER "+username+" just typed a new message to chat "+data.content.id)
                
                //  Adicionar messagem à db
                db.collection("files").update({_id:new ObjectId(data.content.id)},{$push:{chat:data.content.chat}},function(err,result){
                    
                    //  Redirect message to file's users
                    for(var i=0;i<data.content.users.length;++i){
                        if(data.content.users[i] in openSockets){
                            openSockets[data.content.users[i]].send(JSON.stringify({
                                type:"chat-message",
                                content:{
                                    chat: data.content.chat,
                                    id: data.content.id
                                }
                            }));
                        }
                    }

                });
                break;
        }
        
    });

    ws.on('close', function () {
        console.log("user "+userId+" just left");
        delete openSockets[userId];
    });
});


//Socket.io

/*
var io = require('socket.io')(server);

io.on("connection",function(socket){
    console.log("a user connected");
    socket.on("disconnect",function(){
        console.log("user disconnected");
    });
    socket.on("message",function(data){
        console.log(data);
    });
});
*/

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

//CORS middleware
var allowCrossDomain = function(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader("Access-Control-Allow-Headers", 'Content-Type, Authorization, Content-Length, X-Requested-With');
  next();
}

app.use(allowCrossDomain);

// Make our db accessible to our router
app.use(function(req,res,next){
    req.db = db;
    next();
});

app.use(favicon());
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

var routes = require('./routes/index');
var api = require("./routes/api");

app.use('/', routes);
app.use("/api",api);

/// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});



/// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

server.listen(3000,function(){
    var addr = server.address();
    console.log("listening at", addr.address + ":" + addr.port);
});
