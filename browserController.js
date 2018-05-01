import puppeteer from 'puppeteer'
import moment from 'moment'
import {sendMessage, MESSAGE_TYPES} from './telegram'

let globalBrowser

export async function getBrowser(){
  if (!globalBrowser){
    const options = {headless: false}
    const browser = await puppeteer.launch(options)
    browser.on('disconnected', ()=>{
      globalBrowser = null
    })
    globalBrowser = browser
  }
  return globalBrowser
}

export async function closeBrowser(){
  await globalBrowser.close()
  globalBrowser = null
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
  return new Promise(async(resolve, reject)=>{
    const message = `בחר אזור:\n${menuTabs.map(tab=>tab.label).join('\n')}`
    const type = MESSAGE_TYPES.ZONE
    const label = await sendMessage({id, message, type})
    const relevantTab = menuTabs.find(tab=>tab.label===label)
    if (relevantTab){
      resolve(relevantTab.url)
    }else{
      resolve(undefined)
    }
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
  await page.waitForNavigation({waitUntil:'networkidle0'})
}

function getAdId(name){
  const res = /[\d_]+$/.exec(name)
  if (res){
    return res[0]
  }
  return null
}

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
      const result = await frame.evaluate(()=>{
        const el = document.querySelector('.innerDetails_table>tbody>tr:first-child>td:first-child>div>table>tbody>tr:first-child')
        return {text: el.innerText}
      })
      return result
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
