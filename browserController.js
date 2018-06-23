import puppeteer from 'puppeteer'
import moment from 'moment'
import {sendMessage, MESSAGE_TYPES} from './telegram'

let globalBrowser = { state: null, value: null}

async function getBrowser(){
  if (globalBrowser.state===null){
    globalBrowser.state = 'Pending'
    const options = {headless: false, timeout: 2*60*1000}
    const browser = await puppeteer.launch(options)
    browser.on('disconnected', ()=>{
      globalBrowser.state = null
      globalBrowser.value = null
    })
    globalBrowser.state = 'Fullfiled'
    globalBrowser.value = browser
  }
  return globalBrowser.value
}

export async function closeBrowser(){
  await globalBrowser.value.close()
  globalBrowser.value = null
  globalBrowser.state = null
}

export async function getPage(){
  const browser = await getBrowser()
  const page = await browser.newPage()
  setTimeout(()=>{
    if (page && page.close){
      page.close()
    }
  },10*60*1000)
  await page.setViewport({
    width: 1024,
    height: 768,
  })
  return page
}

let menuTabsCache = {
  value: undefined,
  lastUpdated: undefined,
}
export async function getMenuTabs(page){
  return new Promise(async (resolve, reject)=>{
    if (menuTabsCache.lastUpdated && moment().subtract(3, 'days').isBefore(menuTabsCache.lastUpdated)){
      resolve(menuTabsCache.value)
    }else{
      const menuTabs = await page.evaluate(()=>{
        return Array.from(document.querySelectorAll('#menu li a'))
          .map(el=>{
            return{
              label: el.innerText.trim(),
              url: el.getAttribute('href'),
            }
          })
      })
      menuTabsCache.lastUpdated = moment().toString()
      menuTabsCache.value = menuTabs
      resolve(menuTabsCache.value)
    }
  })
}

export async function sendTabsGetHref(id, menuTabs){
  return new Promise(async(resolve)=>{
    const message = `בחר אזור:\n${menuTabs.map(tab=>tab.label).join('\n')}`
    const type = MESSAGE_TYPES.ZONE
    const label = (await sendMessage({id, message, type})).trim()
    const relevantTab = menuTabs.find(tab=>tab.label===label)
    if (relevantTab){
      return resolve(relevantTab.url)
    }else{
      const cleanLabel = label.replace(/["'!]/g,'')
      console.log(cleanLabel);
      const relevantTab2 = menuTabs.find(tab=>tab.label.replace(/["'!]/g,'')===cleanLabel)
      if (relevantTab2){
        return resolve(relevantTab2.url)
      }
    }
    return resolve(undefined)
  })
}

function clientSideGetSearchAttrs(searchValues){
  const searchAttrsArr = Array.from(document.querySelectorAll('.search_block_main input,select'))
    .filter(el=>getComputedStyle(el).display!=='none')
    .map(el=>{
      return {
        element: el,
        label: el.parentElement.innerText.trim(),
        tagName: el.tagName,
        type: el.type,
      }
    })
    .filter(attr=>attr.label.length>0&&attr.label.length<30)

  let searchLabels = searchAttrsArr.reduce((res, cur)=>{
    res[cur.label] = cur
    return res
  }, {})

  if (searchValues){
    searchValues.forEach(searchValue=>{
      const searchLabel = searchLabels[searchValue.label]
      if (searchLabel){
        if (searchValue.tagName==='SELECT'){
          const option = Array.from(searchLabel.element.children).find(el=>el.innerText===searchValue.value)
          if (option){
            searchLabel.element.value = option.getAttribute('value')
          }
        }else{
          searchLabel.element.value = searchValue.value
        }
      }
    })
    document.querySelector('.search_block_main .submit').click()
  }

  return Object.values(searchLabels)
}

let searchAttrsCache = {
  // url: {
  //   value:,
  //   lastUpdated:,
  // }
}
export async function getSearchAttrs(page, href){
  return new Promise(async (resolve, reject)=>{
    if (searchAttrsCache[href] && moment().subtract(3, 'days').isBefore(searchAttrsCache[href].lastUpdated)){
      resolve(searchAttrsCache[href].value)
    }else{
      const searchAttrs = await page.evaluate(clientSideGetSearchAttrs)

      searchAttrsCache[href] = {
        lastUpdated: moment().toString(),
        value: searchAttrs,
      }
      resolve(searchAttrsCache[href].value)
    }
  })
}

export async function sendParamsGetTerm(id, searchAttrs){
  return new Promise(async (resolve, reject)=>{
    const message = `הוסף פרמטרים לחיפוש:\n${searchAttrs.map(attr=>attr.label).join('\n')}`
    const type = MESSAGE_TYPES.SEARCH_DEF
    const searchTerm = await sendMessage({id, message, type})
    resolve(searchTerm)
  })
}

export function parseSearchTerm(searchAttrs, searchTerm){
  const arr = searchTerm.split(/\n|,/g).map(line=>line.split(':').map(attr=>attr.trim()))
  let searchParams = []
  arr.forEach(line=>{
    const searchAttr = searchAttrs.find(searchAttr=>searchAttr.label===line[0])
    searchParams.push({...searchAttr, value: line[1]})
  })
  return searchParams
}

export async function typeSearchAndSubmit(page, searchValues){
  await page.evaluate(clientSideGetSearchAttrs, searchValues)
  await page.waitForNavigation({waitUntil:'networkidle2'})
}

function getAdId(name){
  const res = /[\d_]+$/.exec(name)
  if (res){
    return res[0]
  }
  return null
}


const fbUrlRegex = /window\.open\('.+\?u=([^']+)'/

export async function getResults(page, numberOfResults){
  return new Promise(async (resolve, reject)=>{
    const adsIds = await page.evaluate((numberOfResults)=>{
      const answerRows = Array.from(document.querySelectorAll('.main_table tr[id]'))
        .filter(el=>!/strip/i.test(el.getAttribute('id')))
        .slice(0, numberOfResults*2)

      let ads = []
      answerRows.forEach((el, index)=>{
        if (index%2===0){
          el.children[4].click()
          const res = /[\d_]+$/.exec(el.getAttribute('id'))
          if (res){
            ads.push(res[0])
          }
        }
      })
      return ads
    }, numberOfResults)

    await page.waitFor(5000)

    const frames = page.frames().filter((frame)=>{
      const id = getAdId(frame.name())
      return adsIds.includes(id)
    })

    const answers = await Promise.all(frames.map(async (frame)=>{
      const result = await frame.$('.innerDetails_table>tbody>tr:first-child>td:first-child>div>table>tbody>tr:first-child')
      const textHandle = await result.getProperty('innerText')
      const text = await textHandle.jsonValue()

      const onClickText = await frame.evaluate(()=>{
        const fbShareButton = document.querySelectorAll('.facebook')[0]
        return fbShareButton.onclick.toString()
      })
      const fbRegexUrl = fbUrlRegex.exec(onClickText)
      let url
      if (fbRegexUrl&& fbRegexUrl[1]){
        url = decodeURIComponent(fbRegexUrl[1])
      }


      // const image = await result.screenshot()
      // return {image, text}
      return {text, url}
      // const result = await frame.evaluate(()=>{
      //   const el = document.querySelector('.innerDetails_table>tbody>tr:first-child>td:first-child>div>table>tbody>tr:first-child')
      //   return {text: el.innerText}
      // })
      // return result
    }))

    resolve(answers)
  })
}

export function parseResults(results){
  return results.map(result=>{
    let resultStr =''
    for (let prop in result) {
      resultStr+=`${prop}: ${result[prop]}\n`
    }
    return resultStr
  })
}

export async function getPhoneNumber(page, url, id){
  await page.goto(url,{timeout:60000, waitUntil:'networkidle0'})
  await page.click('#toShowPhone>a')
  await page.waitFor(1000)

  const frame = page.frames().filter((frame)=>{
    return frame.name()==='captch_frame'
  })[0]

  // if captcha send image
  if (frame){
    const captcha = await frame.$('.captchaContainer')
    const imgCapthca = await captcha.screenshot()
    // get text
    const captchaText = await sendMessage({
      id,
      image:imgCapthca,
      meesage: 'מה כתוב בתמונה',
      type: MESSAGE_TYPES.CAPTCHA,
    })
    // type in the box
    await frame.type('#captcha_input', captchaText)
    // click the submit
    await frame.click('.captchaSubmit')
    await page.waitFor(1000)
  }

  const text = await page.evaluate(()=>{
    return document.querySelector('img[alt="צור קשר"]').parentElement.parentElement.innerText
  })
  text.split('\n').map(line=>line.split(':'))
    .filter(line=>line.length>1)
    .map(line=>line.map(detail=>detail.trim()).join(': '))
    .join('\n')
  return text
}

export async function getPictures(page, url, id){
  // const url = `http://www.yad2.co.il/Nadlan/ViewImage.php?CatID=2&SubCatID=1&RecordID=${id}`
  await page.goto(url,{timeout:60000, waitUntil:'networkidle0'})
  const imgsPageUrl = await page.evaluate((id)=>{
    return `http://www.yad2.co.il/Nadlan/ViewImage.php?CatID=${window.newSettings.CatID}&SubCatID=${window.newSettings.SubCatID}&RecordID=${id}`
  },id)
  await page.goto(imgsPageUrl,{timeout:60000, waitUntil:'networkidle0'})
  const imgUrls = await page.evaluate(()=>{
    let imgs = new Set()
    function getCurrentImgsUrl(){
      return Array.from(document.querySelectorAll('.imgDiv img')).map(img=>img.getAttribute('src'))
    }
    getCurrentImgsUrl().forEach(url=>imgs.add(url))
    const downArrow = document.querySelector('[scroll_dir="down"]')
    while (!Array.from(downArrow.classList).includes('s_opacity')){
      downArrow.click()
      getCurrentImgsUrl().forEach(url=>imgs.add(url))
    }
    return Array.from(imgs.keys()).join('~')
  })

  return imgUrls.split('~').map(url=>url.replace('/s/','/o/').replace('-s.jpg','.jpg'))
}
