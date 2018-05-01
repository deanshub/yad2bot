import telegram from './telegram'

// (async () => {
//   const options = {headless: false}
//   const browser = await puppeteer.launch(options)
//   const page = await browser.newPage()
//   await page.goto('http://www.yad2.co.il/',{timeout:60000, waitUntil:'networkidle0'})
//   const id = 1
//   // function of cached values of '#menu li' options
//   const menuTabs = await getMenuTabs(page)
//   // send options to the user and wait for his response
//   const href = await sendTabsGetHref(id, menuTabs)
//   // click on his response (by href `#menu li a[href="${href}"]`)
//   await page.click(`#menu li a[href="${href}"]`)
//   await page.waitFor('.search_block_main')
//
//   // get search labels (also should be cached)
//   const searchAttrs = await getSearchAttrs(page, href)
//
//   // send the search labels to the user and wait for his response
//   const searchTerm = await sendParamsGetTerm(id, searchAttrs)
//
//   const searchValues = parseSearchTerm(searchAttrs, searchTerm)
//
//   // type his response to the search inputs and click '.search_block_main .submit'
//   // wait for the page to load
//   await typeSearchAndSubmit(page, searchValues)
//
//   // parse the first X results and send them to the user
//   const numberOfResults = 5
//   const results =  await getResults(page, numberOfResults)
//
//   console.log(results);
//   sendMessage(id, parseResults(results).join('\n'))
//
//   // in case of captcha asking should send the image to the user and let him enter it
//
//   // await page.screenshot({path: 'example.png'});
//
//   await browser.close()
// })()
