const SteamUser = require('steam-user');
const GlobalOffensive = require('globaloffensive');
const http = require('http');
const Config = require('./config.json');
const readline = require('readline');
const EventEmitter = require('events').EventEmitter;
const SteamTotp = require('steam-totp');
const ws = require('nodejs-websocket');

class Bot extends EventEmitter {
	constructor({username, password, twoFactorCode} = {}) {
		super();
		this.username = username;

		const client = new SteamUser({enablePicsCache: true});

		this.log("Attempting to log in...");
		client.logOn({
			accountName: username,
			password: password,
			twoFactorCode: twoFactorCode,
			promptSteamGuardCode: false
		});
		let loggedOnOnce = false;
		client.on('loggedOn', _ => {
			if(!loggedOnOnce) {
				this.emit("loggedOn");
				loggedOnOnce = true;
			}
			this.log(`Connected to Steam.`);
			client.setPersona(1);
		})

		client.on('friendMessage', (steamid, message) => {
			client.chatMessage(steamid, "This account is currently being used as an inspect float bot.")
		})
		
		this.csgoAlreadyConnected = false;
		this.isPlayingCSGO = false;
		client.on('appOwnershipCached', _ => {
			// if already connected to CSGO, then just return, also make sure this bot OWNS csgo
			if(this.csgoAlreadyConnected) return;
			if(!client.ownsApp(730)) return this.log("I don't own CSGO!");
			this.log("I own CSGO, connecting to GC");

			// connect to csgo
			this.csgoAlreadyConnected = true;
			let csgo = new GlobalOffensive(client);
			this.csgo = csgo;

			this.playCSGO();

			// emit that this bot is ready
			csgo.on('connectedToGC', _ => {
				this.log("Connected to CSGO")
				this.emit("ready");
			})
			
		})

		this.errorCount = 0;
	}

	playCSGO() {
		this.errorCount = 0;
		if(this.isPlayingCSGO) {
			client.gamesPlayed([]);
			setTimeout(_ => {
				client.gamesPlayed([730]);
			}, 3000);
		} else {
			client.gamesPlayed([730]);
		}
		this.isPlayingCSGO = true;
	}

	getFloat(args, retryCount) {
		let {sm, a, d} = args;
		// 2 second timeout... (we can assume error if it takes longer than this) It will auto-retry 3 times.
		let inspectTimeout = setTimeout(_ => {
			if(this.errorCount >= 30) { // 30 errors, maybe re-connect to GC
				this.log("Had 30 failures. I'm reconnecting to the game coordinator.");
				return this.playCSGO();	
			}
			if(retryCount > 2) {
				console.log(`Couldn't get float for ${a}`);
				floatEvents.emit(`itemfloat-${a}`, null);
				this.emit("ready");
			} else {
				console.log(`Retrying ${a}`);
				this.getFloat(args, ++retryCount || 1);
				this.errorCount++;
			}
		}, 2000); 

		// time that this was initated, so I can offset the "ready" callback
		let timeInitiated = Date.now();

		this.csgo.inspectItem(sm, a, d, item => {
			clearTimeout(inspectTimeout); // clear the error timeout

			let wear = (+item.paintwear).toFixed(8);
			// emit to all listeners that this item's float is ready
			cache[a] = wear
			floatEvents.emit(`itemfloat-${a}`, wear);

			setTimeout(_ => { // wait 1 second minus how long it took to get this item's float
				this.emit("ready");
			}, timeInitiated - Date.now() + 1000);
		});
	}

	log(str) {
		console.log(`[${this.username}] ${str}`)
	}
}

const floatEvents = new EventEmitter();

const cache = {};

const freeBots = [];

/**
 * @type {{sm: string, a: string, d: string}[]}
 */
const queue = [];

let rl;

//Start all the bots that have shared secrets and can generate their own 2fa codes
let bots = Config.bots.filter(data => data.shared_secret).map(data => {
	data.twoFactorCode = SteamTotp.generateAuthCode(data.shared_secret);
	let bot = new Bot(data);
	
	bot.on("ready", _ => {
		if(queue.length) { // there is stuff in the queue, this bot should be assigned to something.
			let nextItem = queue.pop();
			bot.getFloat(decodeInspectUrl(nextItem));
		} else {
			freeBots.unshift(bot); // theres nothing to be done, so put this bot into the free bots poool
		}
	})

	return bot;
})

let manualBots = Config.bots.filter(data => !data.shared_secret);

if(manualBots.length) { // need some info from the user
	console.log("One or more bots may need 2FA codes entered!")
	function startManualBot(i) {
		console.log(`If prompted, please enter the 2FA code for ${manualBots[i].username}`)
		let bot = new Bot(manualBots[i]);
		bot.on("loggedOn", _ => {
			bot.on("ready", _ => {
				if(queue.length) { // there is stuff in the queue, this bot should be assigned to something.
					let nextItem = queue.pop();
					bot.getFloat(decodeInspectUrl(nextItem));
				} else {
					freeBots.unshift(bot); // theres nothing to be done, so put this bot into the free bots poool
				}
			})
			bots.push(bot);
			
			if(i == manualBots.length-1) {
				console.log("You may now type inspect links!");
				rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout
				});
				rl.on('line', onStdIn);
			} else {
				setTimeout(_ => startManualBot(i + 1), 1500) // wait 1.5s for the other bot to print its shit.
			}
		});
	}
	startManualBot(0)
} else {
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	rl.on('line', onStdIn); // start the normal STDIN handler
}


bots.forEach(bot => {
})

function decodeInspectUrl(url) {
	let sm = (url.match(/S(\d*)/) || [])[1] ||
			 (url.match(/M(\d*)/) || [])[1] ||
			 (url.match(/SM(\d*)/)|| [])[1];
	let a =  (url.match(/A(\d*)/) || [])[1];
	let d =  (url.match(/D(\d*)/) || [])[1];
	return {sm:sm, a:a, d:d};
}
function getFloat(url) {
	return new Promise((resolve, reject) => {
		// get inspect link stuff
		let smad = decodeInspectUrl(url);
		let {sm, a, d} = smad;
		if(!sm || !a || !d) return reject("Invalid Inspect Link");

		if(cache[a]) return resolve(`${a}:${cache[a]}`);

		if(freeBots.length) { // there's a bot free, this makes it easy.
			let bot = freeBots.pop();
			bot.getFloat(smad);
		} else {
			let forQueue = `SM${sm}A${a}D${d}`;
			// if there's no free bots and this item is not already in the queue add it to the queue and hope.
			if(!~queue.indexOf(forQueue))
				queue.unshift(forQueue)
		}

		floatEvents.on(`itemfloat-${a}`, float => { // wait for this float to be gotten.
			if(float == null) return reject(`An error occurred getting asset id ${a}'s float.`);
			resolve(`${a}:${float}`);
		})
	})
}

/**
 * Called when the server gets an new input from STDIN
 * @param {string} input The inputted string
 */
function onStdIn(input) {
	let a = (input.match(/A(\d*)/) || [])[1];
	if(!a) return console.log("Invalid inspect link");

	console.log(`Item's asset ID: ${a}`)

	getFloat(input)
	.then(float => {
		console.log(`Float for asset id ${a}: ${float.split(':')[1]}`);
	})
	.catch(e => {
		console.log(e);
	})
}

const server = ws.createServer(conn => {
	conn.on("text", str => {
		getFloat(str)
		.then(float => {
			conn.sendText(`F${float}`);
		})
		.catch(e => {
			conn.send(e);
		})
	})
}).listen(8000);