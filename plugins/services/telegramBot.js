'use strict';

const TelegramBot = require('node-telegram-bot-api');

// replace the value below with the Telegram token you receive from @BotFather
const token = process.env.TELEGRAM_BOT_TOKEN//'YOUR_TELEGRAM_BOT_TOKEN';

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, {polling: true});

exports.plugin = {
    //pkg: require('./package.json'),
    name : 'telegramBot',    
    version : '1.0.0',
    register: async function (server, options) {
        // ---------------------------
        // Controller
        // ---------------------------
        bot.onText(/\/start/, (msg) => {
            console.log(msg)
        })

        bot.onText(/\/stop/, (msg) => {
            console.log('got stop cmd')
        })


        // ---------------------------
        // Send Function
        // ---------------------------
        //const chatId = '-706210879'
        const sendto = async function(msg) {
            //bot.sendMessage(chatId, msg)
        }
        // register method
        server.method('telegram.send', sendto);
      
    }
};