module.exports = {
            
    pathLocalFolder: '',
    pathRemoteFolder: '',

    fileKeepContent: 'keep-content.json',    

    confirmActions: true,
    excludeContent: [],

    ftpParams: {        
        connection: {
            host: '',
            port: 21,
            user: '',
            password: ''
        },

        numThreads: 5,

        limTryAction: 3,    
        limTryRequest: 3,

        timeOutTransfer: 5000,
        timeOutRequest: 2000
    },

    logParams: {
        rewrite: true,
        fileName: 'sync.log',

        addTimeToServiceOut: true,
        
        outInfo: true,
        outErrors: true,
        outWarnings: true
    }

}