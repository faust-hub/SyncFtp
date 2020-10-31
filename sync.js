const ContentWork = require('./modules/ContentWork.js')
const Terminal = require('./modules/Terminal.js')

const config = require('./sync-cfg.js')
const contentWork = new ContentWork(config)

Terminal.inputMenu({
    header: 'SYNCHRONIZE FTP v1.0',
    items: [
        {
            name: 'Synchronize Local to FTP', 
            run: async () => await contentWork.synchronizeToFtp(false)
        },
        {
            name: 'Synchronize Local to FTP (use keeped remote data)',
            run: async () => {
                if (await Terminal.inputConfirm('If you changed manually remote content, next actions will be incorrect\nAre you sure you want to continue [Y/N]?', ['Y', 'N']) === 'Y')
                    await contentWork.synchronizeToFtp(true)
            }
        }
    ],

    finalCallback: () => { process.exit(0) }
})