const ContentWork = require('./modules/ContentWork.js')
const Terminal = require('./modules/Terminal.js')

const config = require('./sync-cfg.js')
const contentWork = new ContentWork(config)

Terminal.inputMenu({
    header: 'SYNCHRONIZE FTP v1.0',
    items: {
        'Synchronize Local to FTP': () => contentWork.synchronizeToFtp(false),
        'Synchronize Local to FTP (use keeped remote data)': () => contentWork.synchronizeToFtp(true)
    },

    finalCallback: () => { process.exit(0) }
})