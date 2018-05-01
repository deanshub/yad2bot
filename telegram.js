import config from 'config'
import TelegramBot from 'node-telegram-bot-api'
import * as browserController from './browserController'

const bot = new TelegramBot(config.TOKEN, {polling: true})

export const MESSAGE_TYPES = {
  ZONE: 1,
  SEARCH_DEF: 2,
  DONE: 3,
}

let chatState = {}
const SESSION_TIMEOUT = 3*60*1000
export async function sendMessage({id, message, type}){
  return new Promise((resolve, reject)=>{
    // setTimeout if response over 3 minutes then reject
    const timeoutId = setTimeout(()=>{
      if (chatState[id] && chatState[id].reject){
        chatState[id].reject(new Error('Session timeout'))
      }
    }, SESSION_TIMEOUT)

    chatState[id] = {
      resolve,
      reject,
      state: type,
      timeoutId,
    }
    bot.sendMessage(id, message)
    console.log(message);
    if (type===MESSAGE_TYPES.DONE){
      chatState[id] = null
    }
    // if (type===MESSAGE_TYPES.ZONE){
    //   resolve('נדל"ן')
    // }else if (type===MESSAGE_TYPES.SEARCH_DEF) {
    //   resolve('ישוב: נס ציונה\nסוג נכס: מגרשים')
    // }else {
    //   resolve(message)
    // }
  })
}

async function startMessage(msg, match){
  const id = msg.chat.id

  const browser = await browserController.getBrowser()
  const page = await browser.newPage()
  await page.goto('http://www.yad2.co.il/',{timeout:60000, waitUntil:'networkidle0'})
  const menuTabs = await browserController.getMenuTabs(page)
  const href = await browserController.sendTabsGetHref(id, menuTabs)
  await page.click(`#menu li a[href="${href}"]`)
  await page.waitFor('.search_block_main')

  // get search labels (also should be cached)
  const searchAttrs = await browserController.getSearchAttrs(page, href)
  // send the search labels to the user and wait for his response
  const searchTerm = await browserController.sendParamsGetTerm(id, searchAttrs)

  const searchValues = browserController.parseSearchTerm(searchAttrs, searchTerm)

  // type his response to the search inputs and click '.search_block_main .submit'
  // wait for the page to load
  await browserController.typeSearchAndSubmit(page, searchValues)

  // parse the first X results and send them to the user
  const numberOfResults = 5
  const results =  await browserController.getResults(page, numberOfResults)

  // console.log(results);
  const sendResultMessages = browserController.parseResults(results).map(message=>{
    const type = MESSAGE_TYPES.DONE
    return sendMessage({id, message, type})
  })
  await Promise.all(sendResultMessages)
  await page.close()

  // in case of captcha asking should send the image to the user and let him enter it
  // await page.screenshot({path: 'example.png'});

  // await browserController.closeBrowser()
}

bot.onText(/\/start/, startMessage)

bot.on('message', (msg) => {
  const chatId = msg.chat.id
  if (chatState[chatId] && chatState[chatId].resolve){
    console.log(msg.text);
    if (chatState[chatId].timeoutId){
      clearTimeout(chatState[chatId].timeoutId)
    }

    chatState[chatId].resolve(msg.text)
    delete chatState[chatId]
  }else{
    // do the /start
    startMessage(msg)
  }
})
