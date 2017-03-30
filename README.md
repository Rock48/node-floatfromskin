# node-floatfromskin
A node.js implementation of the FloatFromSkin server. I wasn't happy with the default server they tell you to use; it's slow, buggy, and I thought it could be improved.

This application will work standalone or with the [FloatFromSkin](https://chrome.google.com/webstore/detail/float-from-skin/nlheooelajnkbnpgjojileplpjhkcham) chrome extension. In the settings, simply point the ip address to `localhost:8000`

## General Usage
The code comes with a sample config file that you should enter your information into and then rename to `config.json` Any bot that you do not include a shared secret for may require a 2FA code to be entered. Once running, you can paste inspect links into the console to get the floats or use the chrome extension to automatically get market floats. Any messages sent to the bots will be replied to with an automated message saying that they are a bot.

Once downloaded, you must first `npm install` to get dependencies.

Run the application with `node app.js`.

## API
If you want to run this as a float server for your own application, then it's simple to get the floats for your items. Connect to this server via websocket and send it inspect links. It will reply in the form `F<assetid>:<wear>` or with some kind of error message.