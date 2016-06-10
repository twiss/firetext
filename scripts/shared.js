firetext.shared = {
	collabVersion: 1,
	getAll: function() {
		var shared = JSON.parse(localStorage['firetext.shared'] || '{}');
		return Object.keys(shared).map(function(path) {
			return firetext.io.split(path.substr(path.indexOf('/'))).concat('', path.substr(0, path.indexOf('/')));
		});
	},
	get: function(path) {
		return JSON.parse(localStorage['firetext.shared'] || '{}')[path];
	},
	getOptions: function(path) {
		var attrs = this.get(path);
		if(attrs) {
			if(attrs['publish-ACL'] && attrs['publish-ACL'] !== 'private') {
				var iter = attrs['publish-use-password'] ? attrs['publish-iter'] : 101;
				var password = attrs['publish-use-password'] ? attrs['publish-password'] : '';
				var salt = attrs['publish-salt'];
			} else {
				var iter = attrs['collab-use-password'] ? attrs['collab-iter'] : 101;
				var password = attrs['collab-use-password'] ? attrs['collab-password'] : '';
				var salt = attrs['collab-salt'];
			}
			var key = sjcl.misc.cachedPbkdf2(password, {iter: iter, salt: sjcl.codec.base64.toBits(salt)}).key;
			var private_key = key.slice(0, 128/32); // First half
			var shared_key = key.slice(128/32); // Second half
			var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
			if(attrs['collab-ACL'] && attrs['collab-ACL'] !== 'private') {
				authkey += ':' + sjcl.codec.hex.fromBits(
					sjcl.misc.cachedPbkdf2(
						attrs['collab-use-password'] ? attrs['collab-password'] : '', {
							iter: attrs['collab-use-password'] ? attrs['collab-iter'] : 101,
							salt: sjcl.codec.base64.toBits(attrs['collab-salt'])
						}
					).key.slice(128/32)
				).toUpperCase();
			}
			return {
				ACL: attrs['collab-ACL'] && attrs['collab-ACL'] !== 'private' ? attrs['collab-ACL'] : attrs['publish-ACL'],
				S3Prefix: attrs.S3Prefix,
				object: attrs.object,
				password: private_key,
				objectAuthkey: authkey,
				iter: iter,
				salt: salt,
				demo: attrs.demo,
			};
		}
		return {};
	},
	set: function(path, attrs) {
		var shared = JSON.parse(localStorage['firetext.shared'] || '{}');
		shared[path] = attrs;
		localStorage['firetext.shared'] = JSON.stringify(shared);
	},
	updateCollab: function(path) {
		var attrs = this.get(path);
		if(attrs && attrs['collab-ACL'] !== 'private') {
			socket.path = attrs.S3Prefix + '/' + attrs.object;
			socket.attrs = attrs;
			socket.connect();
			socket.emit('open', {path: socket.path});
			editorMessageProxy.postMessage({command: 'collab-enable'});
		} else {
			socket.path = socket.attrs = null;
			socket.disconnect();
			editorMessageProxy.postMessage({command: 'collab-disable'});
		}
	},
	getCollabLink: function(attrs) {
		return airborn.top_location.origin + '/run#firetext:s=' + encodeURIComponent(this.collabEncrypt(attrs, JSON.stringify(attrs))) + (attrs['collab-use-password'] ? '&p=1' : '');
	},
	getPublishLink: function(attrs) {
		return airborn.top_location.origin + '/pub#?f=' + attrs.S3Prefix + '/' + attrs.object + (attrs['publish-use-password'] ? '&p=1' : '');
	},
	collabEncrypt: function(attrs, str) {
		var iter = attrs['collab-use-password'] ? attrs['collab-iter'] : 101;
		var password = attrs['collab-use-password'] ? attrs['collab-password'] : '';
		return sjcl.encrypt(password, str, {iter: iter, salt: sjcl.codec.base64.toBits(attrs['collab-salt'])});
	},
	collabDecrypt: sjcl.decrypt,
};

var hash_args = {};
if(airborn.top_location.hash) {
	airborn.top_location.hash.slice(1).split('&').forEach(function(part) {
		var parts = part.split('=');
		hash_args[parts[0]] = decodeURIComponent(parts[1]);
	});
}

function initSharedDocuments() {
	if(hash_args.s) {
		if(hash_args.p) {
			var newDoc = false;
			if(firetext.shared.getAll().some(function(path) {
				var props = firetext.shared.get(path[4] + path.slice(0, 3).join(''));
				try {
					newDoc = openSharedDocument(props['collab-password'], true);
					return true;
				} catch(e) {}
			})) {
				if(newDoc) {
					regions.nav('welcome');
					return true;
				}
			} else {
				regions.nav('welcome');
				regions.nav('enter-password');
				return true;
			}
		} else {
			if(openSharedDocument('')) {
				regions.nav('welcome');
				return true;
			}
		}
	}
}

function openSharedDocument(password, dontNotify) {
	var props;
	try {
		props = firetext.shared.collabDecrypt(password, hash_args.s);
	} catch(e) {
		if(!dontNotify) {
			if(e instanceof sjcl.exception.corrupt) {
				firetext.notify(navigator.mozL10n.get('password-incorrect'));
			} else {
				firetext.notify(navigator.mozL10n.get('unknown-error') + ': ' + e.message);
			}
		}
		throw e;
	}
	props = JSON.parse(props);
	if(props['collab-version'] > 1) {
		firetext.notify(navigator.mozL10n.get('cant-collab-too-old'), '<a href="' + airborn.top_location.origin + '/update" target="_blank">' + navigator.mozL10n.get('click-to-update').replace(/</g, '&lt;') + '</a>', 10000);
		throw new Error('Document is collab-version ' + props['collab-version'] + ', this Firetext is collab-version ' + firetext.shared.collabVersion);
	}
	var path = props.path.replace('internal/', 'internal-' + props.S3Prefix + '/');
	var newDoc = !firetext.shared.get(path);
	firetext.shared.set(path, props);
	if(newDoc) {
		setTimeout(function() {
			var parts = firetext.io.split(props.path.replace('internal', ''));
			loadToEditor(parts[0], parts[1], parts[2], 'internal-' + props.S3Prefix);
		});
	}
	return newDoc;
}

function generateNewPassword() {
	var words = [].concat.apply([], Object.keys(navigator.mozL10n.ctx.locales).map(function(lang) {
		return navigator.mozL10n.ctx.locales[lang];
	}).filter(function(locale) {
		return locale.isReady;
	}).map(function(locale) {
		return [].concat.apply([], Object.keys(locale.entries).map(function(key) {
			return locale.entries[key];
		}).filter(function(entry) {
			return typeof entry === 'string';
		}).map(function(entry) {
			return entry.toLowerCase().replace(/[^a-z -]/g, '').split(' ');
		}));
	})).filter(Boolean).sort().filter(function(elem, index, arr) {
		return index == arr.length - 1 || arr[index + 1] != elem
	});
	return Array.apply(null, Array(5)).map(function() {
		return words[Math.floor(Math.random() * words.length)];
	}).join(' ');
}