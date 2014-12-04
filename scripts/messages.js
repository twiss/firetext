/*
* Message Proxy
* Copyright (C) Codexa Organization 2013.
*/

function MessageProxy(_port) {
	var port;
	var messageHandlers = {};
	var pub = this;

	this.registerMessageHandler = function registerMessageHandler(callback, /*optional*/ key, /*optional*/ useOnce) {
		// verify that callback is a function
		if(typeof callback !== "function") {
			throw new TypeError("callback must be a function");
		}
		// find unused key if not specified
		if (!key) {
			key = 0;
			while(messageHandlers[key]) { key++ };
		}
		// register handler
		messageHandlers[key] = {
			callback: callback,
			useOnce: !!useOnce
		};
		// return the used key
		return key;
	}

	this.unRegisterMessageHandler = function unRegisterMessageHandler(key) {
		messageHandlers[key] = undefined;
	}

	this.getPort = function getPort() {
		return port;
	}

	this.setPort = function setPort(_port) {
		port = _port;
		port.addEventListener("message", function (e) {
			// check for command
			if(!messageHandlers[e.data.command]) {
				throw new Error('No command registered: "' + e.data.command + '"');
			}
			// call correct callback
			messageHandlers[e.data.command].callback(e);
			// if command handler already removed return
			if(!messageHandlers[e.data.command]) { return }
			// if useOnce is specified, remove command handler
			if(messageHandlers[e.data.command].useOnce) {
				pub.unRegisterMessageHandler(e.data.command);
			}
		}, false);
	}

	this.setPort(_port);
};