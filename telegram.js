import config from 'config'
import TelegramBot from 'node-telegram-bot-api'
import * as browserController from './browserController'

const bot = new TelegramBot(config.TOKEN, {polling: true})

export const MESSAGE_TYPES = {
  ZONE: 1,
  SEARCH_DEF: 2,
  DONE: 3,
  CAPTCHA: 7,
}

const STATIC_INLINE_BUTTONS = [{
  text: 'תמונות',
  data: 'pictures',
},{
  text: 'טלפון',
  data: 'phone',
}]

let chatState = {}
const SESSION_TIMEOUT = 3*60*1000
export async function sendMessage({id, message, type, image, images, url, inlineButtons=[]}){
  return new Promise(async (resolve, reject)=>{
    if (chatState[id] && chatState[id].timeoutId){
      clearTimeout(chatState[id].timeoutId)
      chatState[id].timeoutId=null
    }
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

    let messageResponse
    if (message){
      const messageWithUrl = url?`${url}\n${message}`:message
      let options = {}
      const inlineButtonsParsed = inlineButtons.map(({text, data})=>{
        return {
          text,
          callback_data: data,
        }
      })
      if (inlineButtonsParsed.length>0){
        options.reply_markup = {
          inline_keyboard: [inlineButtonsParsed],
        }
      }
      messageResponse = await bot.sendMessage(id, messageWithUrl, options)
    }
    if (image) {
      let options = {}
      if (messageResponse){
        options.reply_to_message_id=messageResponse.message_id
      }
      bot.sendPhoto(id, image, options)
    }
    if (images) {
      let options = {}
      if (messageResponse){
        options.reply_to_message_id=messageResponse.message_id
      }
      bot.sendMediaGroup(id, images, options)
    }
    // console.log(message)

    if (type===MESSAGE_TYPES.DONE){
      clearTimeout(timeoutId)
      chatState[id] = null
    }
  })
}

async function startMessage(msg){
  const id = msg.chat.id
  const page = await browserController.getPage()

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
  const sendResultMessages = results.map(({image,text, url})=>{
    const type = MESSAGE_TYPES.DONE

    return sendMessage({id, message:text, image, url, type, inlineButtons:STATIC_INLINE_BUTTONS})
  })

  // console.log(results);
  // const sendResultMessages = browserController.parseResults(results).map(message=>{
  //   const type = MESSAGE_TYPES.DONE
  //   return sendMessage({id, message, type})
  // })
  await Promise.all(sendResultMessages)
  await page.close()

  // in case of captcha asking should send the image to the user and let him enter it
  // await page.screenshot({path: 'example.png'});

  // await browserController.closeBrowser()
}

bot.onText(/\/help/, (msg)=>{
  const id = msg.chat.id
  bot.sendMessage(id, 'חפש ביד2 על ידי הקשת הפקודה\n/start')
})
bot.onText(/\/start/, startMessage)

bot.on('message', (msg) => {
  if (/\/start/.test(msg.text)){
    return null
  }
  const chatId = msg.chat.id
  console.log(msg.text);
  if (chatState[chatId] && chatState[chatId].resolve){
    if (chatState[chatId].timeoutId){
      clearTimeout(chatState[chatId].timeoutId)
      chatState[chatId].timeoutId = null
    }

    chatState[chatId].resolve(msg.text)
    delete chatState[chatId]
  }else{
    // do the /start
    startMessage(msg).catch(console.error)
  }
})

bot.on('callback_query', async (callbackQuery)=>{
  const fromId = callbackQuery.from.id

  if (callbackQuery.data==='phone'){
    const url = callbackQuery.message.text.split('\n')[0]
    const page = await browserController.getPage()
    const phoneNumberText = await browserController.getPhoneNumber(page, url, fromId)

    bot.sendMessage(fromId, phoneNumberText, {reply_to_message_id: callbackQuery.message.message_id })
    page.close()
  }else if (callbackQuery.data==='pictures'){
    const url = callbackQuery.message.text.split('\n')[0]
    const regexRes = /=([\d]+)&/.exec(url)
    if (regexRes && regexRes[1]){
      const page = await browserController.getPage()
      const picturesUrl = await browserController.getPictures(page, url, regexRes[1])
      picturesUrl.forEach(url=>{
        bot.sendMessage(fromId, url, {reply_to_message_id: callbackQuery.message.message_id })
      })
      page.close()
    }
  }
})
