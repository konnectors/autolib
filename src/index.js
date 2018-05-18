const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')

const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very usefull for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})

const baseUrl = 'https://moncompte.autolib.eu'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request({
    url: `${baseUrl}/account/bills`,
    headers: {
      // the english version is better to parse
      'Accept-Language': 'en-GB,en-US'
    }
  })
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  // here we use the saveBills function even if what we fetch are not bills, but this is the most
  // common case in connectors
  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields.folderPath, {
    // this is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['autolib']
  })
}

// this shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  const url = `${baseUrl}/account/login`
  return signin({
    url,
    formSelector: 'form',
    formData: { username, password },
    headers: {
      Referer: url // required
    },
    // the validate function will check if
    validate: (statusCode, $) => {
      // detect logout button to know if signed in
      // 2 logout buttons: mobile and desktop
      if ($(`a[href='/account/logout/']`).length === 2) {
        return true
      } else {
        // cozy-konnector-libs has its own logging function which format these logs with colors in
        // standalone and dev mode and as JSON in production mode
        log('error', $('.error').text())
        return false
      }
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/cozy/cozy-konnector-libs/blob/master/docs/api.md#savebills)
function parseDocuments($) {
  // you can find documentation about the scrape function here :
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const docs = scrape(
    $,
    {
      id: 'td:nth-child(1)',
      date: {
        sel: 'td:nth-child(2)',
        parse: str => new Date(str)
      },
      status: 'td:nth-child(3)',
      amount: {
        sel: 'td:nth-child(4)',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'a',
        attr: 'href',
        parse: href => `${baseUrl}${href}`
      }
    },
    'table.table-bills tbody tr'
  )
  return docs.map(
    doc =>
      doc.status === 'Paid' && {
        ...doc,
        currency: '€',
        vendor: 'autolib',
        filename: getFileName(doc.id, doc.date),
        metadata: {
          // it can be interesting that we add the date of import. This is not mandatory but may be
          // usefull for debugging or data migration
          importDate: new Date(),
          // document version, usefull for migration after change of document structure
          version: 1
        }
      }
  )
}

function getStringDate(date) {
  return `${('0' + date.getMonth()).slice(-2)}_${('0' + date.getDay()).slice(
    -2
  )}_${date.getFullYear()}`
}

// compute file name
function getFileName(id, date) {
  return `${getStringDate(date)}_${id}_autolib.pdf`
}

// convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.trim().replace('€', ''))
}
